import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CaseManagementController } from './case-management.controller';
import { CaseManagementService } from './case-management.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CaseManagementController],
  providers: [CaseManagementService],
  exports: [CaseManagementService],
})
export class CaseManagementModule {}
