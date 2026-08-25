import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { DocumentScannerModule } from '../document-scanner/document-scanner.module';
import { CaseOperationsController } from './case-operations.controller';
import { CaseOperationsService } from './case-operations.service';

@Module({
  imports: [DatabaseModule, AuthModule, DocumentScannerModule],
  controllers: [CaseOperationsController],
  providers: [CaseOperationsService],
  exports: [CaseOperationsService],
})
export class CaseOperationsModule {}
