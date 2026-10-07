import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InfrastructureService } from './infrastructure.service';

@Injectable()
export class DocumentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentsService.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly infra: InfrastructureService,
  ) {}

  findAll() {
    return this.prisma.document.findMany({
      take: 100,
      omit: { text: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findOne(id: string) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }

  async upload(file?: Express.Multer.File) {
    if (!file || file.size === 0) throw new BadRequestException('A non-empty file is required.');
    // Multipart filename parameters default to Latin-1 in Multer/Busboy, while
    // browsers send UTF-8. Preserve genuine Latin-1 names and already decoded names.
    const rawName = file.originalname;
    const decoded = /^[\u0000-\u00ff]*$/.test(rawName)
      ? new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(rawName, 'latin1'))
      : rawName;
    const fileName = (decoded.includes('\ufffd') ? rawName : decoded)
      .split(/[\\/]/)
      .pop()
      ?.normalize('NFC')
      .trim();
    if (!fileName || fileName.length > 255 || /[\x00-\x1f\x7f]/.test(fileName)) {
      throw new BadRequestException('Invalid file name.');
    }
    const objectKey = `originals/${randomUUID()}`;
    try {
      await this.infra.ensureBucket();
      await this.infra.storage.putObject(this.infra.bucket, objectKey, file.buffer, file.size, {
        'Content-Type': 'application/octet-stream',
      });
    } catch {
      throw new ServiceUnavailableException('File storage is unavailable. Retry the upload.');
    }
    let document;
    try {
      document = await this.prisma.document.create({
        data: {
          title: fileName,
          fileName,
          mimeType: file.mimetype,
          size: file.size,
          objectKey,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          status: 'uploaded',
        },
      });
    } catch {
      await this.infra.storage.removeObject(this.infra.bucket, objectKey).catch(() => {
        this.logger.error(`Unreferenced object requires cleanup: ${objectKey}`);
      });
      throw new ServiceUnavailableException('Metadata could not be saved. Retry the upload.');
    }
    // The committed row is the durable outbox. Redis outages never discard uploads.
    await this.dispatchPending();
    return (await this.prisma.document.findUnique({ where: { id: document.id } })) ?? document;
  }

  async dispatchPending() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const pending = await this.prisma.document.findMany({
        where: { queuedAt: null },
        omit: { text: true },
        take: 100,
        orderBy: { createdAt: 'asc' },
      });
      for (const document of pending) {
        await this.infra.queue.add(
          'extract-text',
          { documentId: document.id, objectKey: document.objectKey },
          {
            jobId: document.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
        await this.prisma.document.update({
          where: { id: document.id },
          data: { queuedAt: new Date() },
        });
      }
    } catch {
      this.logger.warn('Queue dispatch deferred; persisted uploads will be retried.');
    } finally {
      this.dispatching = false;
    }
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.dispatchPending(), 5000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
