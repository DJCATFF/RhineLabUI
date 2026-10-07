import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Client } from 'minio';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

@Injectable()
export class InfrastructureService implements OnModuleDestroy {
  readonly storage: Client;
  readonly redis: Redis;
  readonly queue: Queue;
  readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.storage = new Client({
      endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: Number(config.get('MINIO_PORT', 9000)),
      useSSL: config.get('MINIO_USE_SSL', 'false') === 'true',
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
    this.storage.setRequestOptions({
      agent:
        config.get('MINIO_USE_SSL', 'false') === 'true'
          ? new HttpsAgent({ timeout: 5000 })
          : new HttpAgent({ timeout: 5000 }),
    });
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableOfflineQueue: false,
    });
    this.redis.on('error', () => {});
    this.queue = new Queue('documents', { connection: this.redis });
    this.queue.on('error', () => {});
  }

  async ensureBucket() {
    if (await this.storage.bucketExists(this.bucket)) return;
    try {
      await this.storage.makeBucket(this.bucket);
    } catch (error) {
      if (!(await this.storage.bucketExists(this.bucket))) throw error;
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.redis.disconnect();
  }
}
