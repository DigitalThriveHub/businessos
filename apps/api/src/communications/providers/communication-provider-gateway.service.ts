import { Injectable } from '@nestjs/common';

import { EmailService } from '../../notifications/email.service';
import { GoogleWorkspaceProvider } from './google-workspace-provider.service';
import { MicrosoftGraphProvider } from './microsoft-graph-provider.service';
import type {
  CalendarProviderInput,
  CalendarProviderReceipt,
  DeliveryJob,
  ProviderDeliveryReceipt,
  ProviderRuntimeContext,
  ProviderSyncResult,
} from './provider.types';
import { ProviderOperationError } from './provider.types';
import { WhatsAppCloudProvider } from './whatsapp-cloud-provider.service';

@Injectable()
export class CommunicationProviderGateway {
  constructor(
    private readonly email: EmailService,
    private readonly microsoft: MicrosoftGraphProvider,
    private readonly google: GoogleWorkspaceProvider,
    private readonly whatsapp: WhatsAppCloudProvider,
  ) {}

  async send(job: DeliveryJob): Promise<ProviderDeliveryReceipt> {
    switch (job.provider) {
      case 'RESEND': {
        const receipt = await this.email.sendTransactionalMessage({
          messageId: job.messageId,
          recipientEmails: job.recipientAddresses,
          subject: job.subject ?? 'Secure message from BusinessOS',
          bodyText: job.bodyText,
          idempotencyKey: job.idempotencyKey,
        });
        return { provider: receipt.provider, messageId: receipt.messageId };
      }
      case 'MICROSOFT_365':
        return this.microsoft.send(job);
      case 'GOOGLE_WORKSPACE':
        return this.google.send(job);
      case 'WHATSAPP_BUSINESS':
        return this.whatsapp.send(job);
    }
  }

  async health(context: ProviderRuntimeContext): Promise<void> {
    switch (context.provider) {
      case 'MICROSOFT_365':
        return this.microsoft.health(context);
      case 'GOOGLE_WORKSPACE':
        return this.google.health(context);
      case 'WHATSAPP_BUSINESS':
        return this.whatsapp.health(context);
    }
  }

  createCalendarEvent(
    context: ProviderRuntimeContext,
    input: CalendarProviderInput,
  ): Promise<CalendarProviderReceipt> {
    switch (context.provider) {
      case 'MICROSOFT_365':
        return this.microsoft.createCalendarEvent(context, input);
      case 'GOOGLE_WORKSPACE':
        return this.google.createCalendarEvent(context, input);
      case 'WHATSAPP_BUSINESS':
        throw new ProviderOperationError(
          'CALENDAR_PROVIDER_UNSUPPORTED',
          'WhatsApp does not provide the configured calendar capability.',
          false,
        );
    }
  }

  cancelCalendarEvent(
    context: ProviderRuntimeContext,
    providerEventId: string,
  ): Promise<void> {
    switch (context.provider) {
      case 'MICROSOFT_365':
        return this.microsoft.cancelCalendarEvent(context, providerEventId);
      case 'GOOGLE_WORKSPACE':
        return this.google.cancelCalendarEvent(context, providerEventId);
      case 'WHATSAPP_BUSINESS':
        throw new ProviderOperationError(
          'CALENDAR_PROVIDER_UNSUPPORTED',
          'WhatsApp does not provide the configured calendar capability.',
          false,
        );
    }
  }

  sync(context: ProviderRuntimeContext): Promise<ProviderSyncResult> {
    switch (context.provider) {
      case 'MICROSOFT_365':
        return this.microsoft.sync(context);
      case 'GOOGLE_WORKSPACE':
        return this.google.sync(context);
      case 'WHATSAPP_BUSINESS':
        throw new ProviderOperationError(
          'MAILBOX_SYNC_UNSUPPORTED',
          'WhatsApp messages are received through signed webhooks.',
          false,
        );
    }
  }
}
