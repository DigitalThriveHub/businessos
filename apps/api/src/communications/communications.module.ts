import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunicationDeliveryWorkerConfig } from './communication-delivery-worker.config';
import { CommunicationDeliveryWorkerService } from './communication-delivery-worker.service';
import { CommunicationWebhookController } from './communication-webhook.controller';
import { CommunicationWebhookService } from './communication-webhook.service';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { GateLOperationsService } from './gate-l-operations.service';
import { PortalInvitationTokenService } from './portal-invitation-token.service';
import { ProviderWebhookController } from './provider-webhook.controller';
import { ProviderWebhookService } from './provider-webhook.service';
import { ProviderSyncWorkerConfig } from './provider-sync-worker.config';
import { ProviderSyncWorkerService } from './provider-sync-worker.service';
import { CommunicationProviderGateway } from './providers/communication-provider-gateway.service';
import { GoogleWorkspaceProvider } from './providers/google-workspace-provider.service';
import { MicrosoftGraphProvider } from './providers/microsoft-graph-provider.service';
import { ProviderSecretResolver } from './providers/provider-secret-resolver.service';
import { WhatsAppCloudProvider } from './providers/whatsapp-cloud-provider.service';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [
    CommunicationsController,
    CommunicationWebhookController,
    ProviderWebhookController,
  ],
  providers: [
    CommunicationsService,
    GateLOperationsService,
    ProviderWebhookService,
    ProviderSecretResolver,
    MicrosoftGraphProvider,
    GoogleWorkspaceProvider,
    WhatsAppCloudProvider,
    CommunicationProviderGateway,
    {
      provide: ProviderSyncWorkerConfig,
      useFactory: () => new ProviderSyncWorkerConfig(process.env),
    },
    ProviderSyncWorkerService,
    PortalInvitationTokenService,
    {
      provide: CommunicationDeliveryWorkerConfig,
      useFactory: () => new CommunicationDeliveryWorkerConfig(process.env),
    },
    CommunicationDeliveryWorkerService,
    CommunicationWebhookService,
  ],
  exports: [PortalInvitationTokenService, GateLOperationsService],
})
export class CommunicationsModule {}
