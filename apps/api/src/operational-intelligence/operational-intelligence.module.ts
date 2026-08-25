import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { DocumentScannerModule } from '../document-scanner/document-scanner.module';
import { DocumentIntelligenceProviderService } from './document-intelligence-provider.service';
import { DocumentIntelligenceWorkerService } from './document-intelligence-worker.service';
import { OperationalIntelligenceConfig } from './operational-intelligence.config';
import { OperationalIntelligenceController } from './operational-intelligence.controller';
import { OperationalIntelligenceService } from './operational-intelligence.service';

@Module({
  imports: [DatabaseModule, DocumentScannerModule],
  controllers: [OperationalIntelligenceController],
  providers: [
    {
      provide: OperationalIntelligenceConfig,
      useFactory: () => new OperationalIntelligenceConfig(process.env),
    },
    OperationalIntelligenceService,
    DocumentIntelligenceProviderService,
    DocumentIntelligenceWorkerService,
  ],
  exports: [OperationalIntelligenceConfig],
})
export class OperationalIntelligenceModule {}
