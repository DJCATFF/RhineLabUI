import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { ExtractionService } from './extraction.service';

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private worker?: Worker;
  private connection?: Redis;
  private timer?: NodeJS.Timeout;
  private reconciling = false;
  private stopping?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly extraction: ExtractionService,
  ) {}

  onModuleInit() {
    // Blocking BullMQ consumers require unlimited per-request retries.
    this.connection = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.connection.on('error', () => {});
    this.worker = new Worker('documents', (job) => this.extraction.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', () => this.logger.warn('Worker connection unavailable; reconnecting.'));
    this.worker.on('failed', (job) =>
      this.logger.warn(`Extraction attempt failed for ${job?.id ?? 'unknown'}.`),
    );
    const reconcile = async () => {
      if (this.reconciling) return;
      this.reconciling = true;
      try {
        await this.extraction.reconcileFailures();
      } catch {
        this.logger.warn('Failure status reconciliation deferred.');
      } finally {
        this.reconciling = false;
      }
    };
    this.timer = setInterval(() => void reconcile(), 30000);
    this.timer.unref();
    void reconcile();
  }

  stop() {
    this.stopping ??= (async () => {
      clearInterval(this.timer);
      await this.worker?.close();
      this.connection?.disconnect();
    })();
    return this.stopping;
  }

  onModuleDestroy() {
    return this.stop();
  }
}
