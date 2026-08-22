import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AutomationControlController } from './automation-control.controller';
import { AutomationControlService } from './automation-control.service';
import { AutomationWorkerConfig } from './automation-worker.config';
import { AutomationWorkerService } from './automation-worker.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AutomationControlController],
  providers: [
    AutomationControlService,
    {
      provide: AutomationWorkerConfig,
      useFactory: () => new AutomationWorkerConfig(process.env),
    },
    AutomationWorkerService,
  ],
  exports: [AutomationControlService],
})
export class AutomationControlModule {}
