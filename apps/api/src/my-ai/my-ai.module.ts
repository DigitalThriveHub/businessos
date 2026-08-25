import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AutomationControlModule } from '../automation-control/automation-control.module';
import { DatabaseModule } from '../database/database.module';
import { MyAiController } from './my-ai.controller';
import { MyAiService } from './my-ai.service';
import { OpenAiGatewayService } from './openai-gateway.service';

@Module({
  imports: [DatabaseModule, AuthModule, AutomationControlModule],
  controllers: [MyAiController],
  providers: [MyAiService, OpenAiGatewayService],
})
export class MyAiModule {}
