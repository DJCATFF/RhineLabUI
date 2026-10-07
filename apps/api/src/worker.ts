import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { WorkerService } from './worker/worker.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    // Drain the consumer before Nest disconnects Prisma and infrastructure providers.
    await app.get(WorkerService).stop();
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
