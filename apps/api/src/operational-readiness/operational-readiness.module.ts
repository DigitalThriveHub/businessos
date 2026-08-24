import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OperationalReadinessController } from './operational-readiness.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [OperationalReadinessController],
})
export class OperationalReadinessModule {}
