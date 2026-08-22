import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunicationDeliveryWorkerConfig } from './communication-delivery-worker.config';
import { CommunicationDeliveryWorkerService } from './communication-delivery-worker.service';
import { CommunicationWebhookController } from './communication-webhook.controller';
import { CommunicationWebhookService } from './communication-webhook.service';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { PortalInvitationTokenService } from './portal-invitation-token.service';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [CommunicationsController, CommunicationWebhookController],
  providers: [
    CommunicationsService,
    PortalInvitationTokenService,
    {
      provide: CommunicationDeliveryWorkerConfig,
      useFactory: () => new CommunicationDeliveryWorkerConfig(process.env),
    },
    CommunicationDeliveryWorkerService,
    CommunicationWebhookService,
  ],
  exports: [PortalInvitationTokenService],
})
export class CommunicationsModule {}
