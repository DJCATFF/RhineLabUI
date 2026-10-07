import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { InfrastructureService } from '../documents/infrastructure.service';
import { ExtractionService } from './extraction.service';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
  ],
  providers: [InfrastructureService, ExtractionService, WorkerService],
})
export class WorkerModule {}
