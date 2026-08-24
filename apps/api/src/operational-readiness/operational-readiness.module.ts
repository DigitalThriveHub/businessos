import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OperationalReadinessController } from './operational-readiness.controller';
import { OperationalReadinessService } from './operational-readiness.service';

@Module({
  imports: [DatabaseModule],
  controllers: [OperationalReadinessController],
  providers: [OperationalReadinessService],
})
export class OperationalReadinessModule {}
