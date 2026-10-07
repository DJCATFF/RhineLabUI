import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { InfrastructureService } from '../documents/infrastructure.service';

const MAX_INPUT = 20 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;

@Injectable()
export class ExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly infra: InfrastructureService,
    private readonly config: ConfigService,
  ) {}

  async reconcileFailures() {
    // Includes jobs exhausted by repeated process crashes, outside our processor catch.
    for (let start = 0; ; start += 100) {
      const jobs = await this.infra.queue.getFailed(start, start + 99);
      for (const job of jobs) {
        if (typeof job.data?.documentId !== 'string') continue;
        await this.prisma.document.updateMany({
          where: {
            id: job.data.documentId,
            status: { in: ['uploaded', 'processing', 'retrying'] },
          },
          data: {
            status: 'failed',
            extractionError: 'Extraction job exhausted; inspect worker and retry the failed job',
          },
        });
      }
      if (jobs.length < 100) break;
    }
  }

  async process(job: Job<{ documentId: string }>) {
    if (job.name !== 'extract-text' || typeof job.data?.documentId !== 'string') {
      throw new Error('Invalid extraction job');
    }
    const document = await this.prisma.document.findUnique({ where: { id: job.data.documentId } });
    // A crash after the database commit but before queue acknowledgement is safe.
    if (!document || document.status === 'ready') return;
    const claimed = await this.prisma.document.updateMany({
      where: { id: document.id, status: { not: 'ready' } },
      data: { status: 'processing', extractionError: null, extractionAttempts: { increment: 1 } },
    });
    if (!claimed.count) return;
    try {
      const signal = AbortSignal.timeout(60000);
      // Object keys come only from the database, never from queued payloads.
      const stream = await this.infra.storage.getObject(this.infra.bucket, document.objectKey);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of addAbortSignal(signal, stream)) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_INPUT) throw new Error('Original exceeds extraction limit');
        chunks.push(bytes);
      }
      const input = Buffer.concat(chunks);
      if (
        size !== document.size ||
        createHash('sha256').update(input).digest('hex') !== document.sha256
      ) {
        throw new Error('Original integrity check failed');
      }
      const response = await fetch(
        `${this.config.getOrThrow<string>('TIKA_URL').replace(/\/$/, '')}/tika`,
        {
          method: 'PUT',
          headers: { Accept: 'text/plain', 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(input),
          signal,
          redirect: 'error',
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Tika returned HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      const output: Buffer[] = [];
      let length = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_TEXT) throw new Error('Extracted text exceeds 2 MiB limit');
            output.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
      const text = Buffer.concat(output)
        .toString('utf8')
        .replace(/\u0000/g, '');
      await this.prisma.document.update({
        where: { id: document.id },
        data: { text, status: 'ready', extractionError: null, extractedAt: new Date() },
      });
    } catch (error) {
      // Never expose response bodies, connection strings or original text in errors.
      const message =
        error instanceof Error &&
        /^(Tika returned HTTP \d+|Original (exceeds extraction limit|integrity check failed)|Extracted text exceeds 2 MiB limit)$/.test(
          error.message,
        )
          ? error.message
          : 'Extraction unavailable or timed out';
      await this.prisma.document.updateMany({
        where: { id: document.id, status: { not: 'ready' } },
        data: {
          status: job.attemptsMade + 1 < (job.opts.attempts ?? 1) ? 'retrying' : 'failed',
          extractionError: message,
        },
      });
      throw new Error(message);
    }
  }
}
