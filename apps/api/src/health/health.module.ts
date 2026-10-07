import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [DocumentsModule],
  controllers: [HealthController],
})
export class HealthModule {}
