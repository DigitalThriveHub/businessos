import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { ComplianceAssuranceController } from './compliance-assurance.controller';
import { ComplianceAssuranceService } from './compliance-assurance.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ComplianceAssuranceController],
  providers: [ComplianceAssuranceService],
  exports: [ComplianceAssuranceService],
})
export class ComplianceAssuranceModule {}
