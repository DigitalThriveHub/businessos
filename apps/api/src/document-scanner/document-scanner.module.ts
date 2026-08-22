import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { ClamAvClientService } from './clamav-client.service';
import { DocumentScanWorkerService } from './document-scan-worker.service';
import { DocumentScannerConfig } from './document-scanner.config';
import { SupabasePrivateStorageService } from './supabase-storage.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: DocumentScannerConfig,
      useFactory: () => new DocumentScannerConfig(process.env),
    },
    SupabasePrivateStorageService,
    ClamAvClientService,
    DocumentScanWorkerService,
  ],
  exports: [DocumentScannerConfig],
})
export class DocumentScannerModule {}