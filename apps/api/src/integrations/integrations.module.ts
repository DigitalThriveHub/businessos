import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import {
  ExternalIntakeWebhookController,
  IntegrationsController,
  PublicIntakeFormsController,
} from './integrations.controller';
import { IntegrationSigningService } from './integration-signing.service';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    IntegrationsController,
    ExternalIntakeWebhookController,
    PublicIntakeFormsController,
  ],
  providers: [IntegrationsService, IntegrationSigningService],
  exports: [IntegrationSigningService],
})
export class IntegrationsModule {}
