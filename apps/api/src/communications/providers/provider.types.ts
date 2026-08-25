export type LiveProvider =
  'MICROSOFT_365' | 'GOOGLE_WORKSPACE' | 'WHATSAPP_BUSINESS';

export interface ProviderRuntimeContext {
  organisationId: string;
  connectionId: string;
  provider: LiveProvider;
  secretReference: string;
  capabilities: string[];
  mailboxAddress: string | null;
  phoneNumber: string | null;
  syncCursor: string | null;
  state: string;
  webhookPublicId: string;
}

export interface DeliveryJob {
  messageId: string;
  organisationId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  connectionId: string | null;
  provider: LiveProvider | 'RESEND';
  secretReference: string | null;
  mailboxAddress: string | null;
  phoneNumber: string | null;
  recipientAddresses: string[];
  subject: string | null;
  bodyText: string;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
}

export interface ProviderDeliveryReceipt {
  provider: string;
  messageId: string;
}

export interface CalendarProviderInput {
  eventId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  attendeeAddresses: string[];
  reminderMinutesBefore: number | null;
  idempotencyKey: string;
}

export interface CalendarProviderReceipt {
  providerEventId: string;
  joinUrl: string | null;
}

export interface InboundProviderMessage {
  externalEventId: string;
  providerMessageId: string;
  providerThreadId: string;
  sender: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  occurredAt: Date;
}

export interface ProviderSyncResult {
  messages: InboundProviderMessage[];
  nextCursor: string;
}

export class ProviderOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderOperationError';
  }
}
