import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
