import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { InfrastructureService } from './infrastructure.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, InfrastructureService],
  exports: [InfrastructureService],
})
export class DocumentsModule {}
