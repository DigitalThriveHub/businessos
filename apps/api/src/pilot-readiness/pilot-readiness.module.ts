import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PilotReadinessController } from './pilot-readiness.controller';
import { PilotReadinessService } from './pilot-readiness.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PilotReadinessController],
  providers: [PilotReadinessService],
})
export class PilotReadinessModule {}
