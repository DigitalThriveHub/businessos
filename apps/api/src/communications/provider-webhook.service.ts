import { createHash, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { GateLOperationsService } from './gate-l-operations.service';
import { GoogleWorkspaceProvider } from './providers/google-workspace-provider.service';
import { MicrosoftGraphProvider } from './providers/microsoft-graph-provider.service';
import type { ProviderRuntimeContext } from './providers/provider.types';
import { WhatsAppCloudProvider } from './providers/whatsapp-cloud-provider.service';

type ReceiptRow = {
  receiptId: string;
  duplicate: boolean;
  correlationId: string;
};
type ExternalCommunicationRow = {
  conversationId: string;
  messageId: string;
  duplicate: boolean;
};

function constantTimeEqual(left: string, right: string): boolean {
  const first = Buffer.from(left, 'utf8');
  const second = Buffer.from(right, 'utf8');
  return first.length === second.length && timingSafeEqual(first, second);
}

@Injectable()
export class ProviderWebhookService {
  constructor(
    private readonly database: PrismaService,
    private readonly gateL: GateLOperationsService,
    private readonly microsoft: MicrosoftGraphProvider,
    private readonly google: GoogleWorkspaceProvider,
    private readonly whatsapp: WhatsAppCloudProvider,
  ) {}

  async verifyWhatsApp(
    webhookPublicId: string,
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): Promise<string> {
    if (
      mode !== 'subscribe' ||
      !token ||
      !challenge ||
      challenge.length > 512
    ) {
      throw new BadRequestException(
        'The WhatsApp webhook verification request is invalid.',
      );
    }
    const context = await this.context(webhookPublicId, 'WHATSAPP_BUSINESS');
    if (!this.whatsapp.verifyToken(context, token)) {
      throw new ForbiddenException('WhatsApp webhook verification failed.');
    }
    return challenge;
  }

  async receiveWhatsApp(input: {
    webhookPublicId: string;
    rawBody: Buffer | undefined;
    signature: string | undefined;
    payload: unknown;
  }): Promise<{ accepted: true; processed: number; duplicates: number }> {
    const context = await this.context(
      input.webhookPublicId,
      'WHATSAPP_BUSINESS',
    );
    const rawBody = this.requireRawBody(input.rawBody);
    if (!this.whatsapp.verifySignature(context, rawBody, input.signature)) {
      throw new ForbiddenException(
        'WhatsApp webhook signature verification failed.',
      );
    }
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const values = this.whatsAppValues(input.payload);
    let processed = 0;
    let duplicates = 0;

    for (const value of values) {
      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        const receipt = await this.recordReceipt(
          context.connectionId,
          `message:${message.id}`,
          'whatsapp.message.received',
          payloadHash,
          this.whatsAppTime(message.timestamp),
        );
        if (receipt.duplicate) {
          duplicates += 1;
          continue;
        }
        try {
          const bodyText = this.whatsAppText(message);
          if (!bodyText) {
            await this.completeReceipt(receipt.receiptId, 'IGNORED', null);
            continue;
          }
          const sender = message.from.startsWith('+')
            ? message.from
            : `+${message.from}`;
          const [recorded] = await this.database.$queryRaw<
            ExternalCommunicationRow[]
          >`
            SELECT conversation_id AS "conversationId", message_id AS "messageId", duplicate
            FROM private.record_external_communication(
              ${context.connectionId}::uuid, ${`message:${message.id}`}, ${payloadHash},
              'WHATSAPP'::public.business_communication_channel,
              ${message.id}, ${message.context?.id ?? message.id}, ${sender},
              ${[context.phoneNumber ?? 'unknown']}::text[],
              'WhatsApp conversation', ${bodyText}, ${this.whatsAppTime(message.timestamp)}::timestamptz
            )
          `;
          if (recorded) {
            await this.database.$queryRaw`
              SELECT private.attach_provider_communication(
                ${context.connectionId}::uuid,
                ${recorded.conversationId}::uuid,
                ${recorded.messageId}::uuid
              )
            `;
          }
          await this.completeReceipt(receipt.receiptId, 'PROCESSED', null);
          processed += 1;
        } catch {
          await this.completeReceipt(
            receipt.receiptId,
            'FAILED',
            'WHATSAPP_INGEST_FAILED',
          );
          throw new BadRequestException(
            'The WhatsApp event could not be recorded safely.',
          );
        }
      }

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const receipt = await this.recordReceipt(
          context.connectionId,
          `status:${status.id}:${status.status}:${status.timestamp ?? 'unknown'}`,
          `whatsapp.message.${status.status}`,
          payloadHash,
          this.whatsAppTime(status.timestamp),
        );
        if (receipt.duplicate) {
          duplicates += 1;
          continue;
        }
        const eventType = this.deliveryStatus(status.status);
        if (eventType) {
          await this.database.$queryRaw`
            SELECT * FROM private.record_communication_delivery_event(
              'whatsapp_business',
              ${`status:${status.id}:${status.status}:${status.timestamp ?? 'unknown'}`},
              ${status.id}, ${eventType}::public.communication_delivery_event_type,
              ${this.whatsAppTime(status.timestamp)}::timestamptz,
              ${JSON.stringify({ status: status.status })}::jsonb
            )
          `;
          processed += 1;
        }
        await this.completeReceipt(
          receipt.receiptId,
          eventType ? 'PROCESSED' : 'IGNORED',
          null,
        );
      }
    }
    return { accepted: true, processed, duplicates };
  }

  async receiveMicrosoft(input: {
    webhookPublicId: string;
    validationToken?: string;
    rawBody: Buffer | undefined;
    payload: unknown;
  }): Promise<{
    validation?: string;
    accepted?: true;
    processedMessages?: number;
  }> {
    if (input.validationToken !== undefined) {
      if (!input.validationToken || input.validationToken.length > 512) {
        throw new BadRequestException(
          'The Microsoft validation token is invalid.',
        );
      }
      await this.context(input.webhookPublicId, 'MICROSOFT_365');
      return { validation: input.validationToken };
    }
    const context = await this.context(input.webhookPublicId, 'MICROSOFT_365');
    const rawBody = this.requireRawBody(input.rawBody);
    const notifications = this.microsoftNotifications(input.payload);
    if (notifications.length === 0)
      throw new BadRequestException('The Microsoft notification is invalid.');
    const expectedState = this.microsoft.webhookClientState(context);
    if (
      notifications.some(
        (notification) =>
          !constantTimeEqual(notification.clientState ?? '', expectedState),
      )
    ) {
      throw new ForbiddenException(
        'Microsoft webhook client-state verification failed.',
      );
    }
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    let newReceipt = false;
    for (const notification of notifications) {
      const eventId =
        notification.id ??
        `${notification.subscriptionId ?? 'subscription'}:${notification.resource ?? 'resource'}`;
      const receipt = await this.recordReceipt(
        context.connectionId,
        `notification:${eventId}`,
        'microsoft.mailbox.changed',
        payloadHash,
        new Date(),
      );
      if (!receipt.duplicate) {
        newReceipt = true;
        await this.completeReceipt(receipt.receiptId, 'PROCESSED', null);
      }
    }
    const processedMessages = newReceipt
      ? await this.gateL.syncConnection(context.connectionId)
      : 0;
    return { accepted: true, processedMessages };
  }

  async receiveGoogle(input: {
    webhookPublicId: string;
    authorization: string | undefined;
    rawBody: Buffer | undefined;
    payload: unknown;
  }): Promise<{
    accepted: true;
    processedMessages: number;
    duplicate: boolean;
  }> {
    const context = await this.context(
      input.webhookPublicId,
      'GOOGLE_WORKSPACE',
    );
    await this.google.verifyPushToken(context, input.authorization);
    const rawBody = this.requireRawBody(input.rawBody);
    const envelope = this.googleEnvelope(input.payload);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const receipt = await this.recordReceipt(
      context.connectionId,
      `pubsub:${envelope.messageId}`,
      'google.mailbox.changed',
      payloadHash,
      envelope.publishTime ? new Date(envelope.publishTime) : new Date(),
    );
    if (receipt.duplicate)
      return { accepted: true, processedMessages: 0, duplicate: true };
    try {
      const processedMessages = await this.gateL.syncConnection(
        context.connectionId,
      );
      await this.completeReceipt(receipt.receiptId, 'PROCESSED', null);
      return { accepted: true, processedMessages, duplicate: false };
    } catch (error) {
      await this.completeReceipt(
        receipt.receiptId,
        'FAILED',
        'GOOGLE_SYNC_FAILED',
      );
      throw error;
    }
  }

  private async context(
    webhookPublicId: string,
    expectedProvider: ProviderRuntimeContext['provider'],
  ): Promise<ProviderRuntimeContext> {
    const context = await this.gateL.webhookContext(webhookPublicId);
    if (context.provider !== expectedProvider || context.state === 'DISABLED') {
      throw new NotFoundException('The provider webhook is unavailable.');
    }
    return context;
  }

  private requireRawBody(value: Buffer | undefined): Buffer {
    if (!value || value.length < 2 || value.length > 1_048_576) {
      throw new BadRequestException('The provider webhook body is invalid.');
    }
    return value;
  }

  private async recordReceipt(
    connectionId: string,
    eventId: string,
    eventType: string,
    payloadHash: string,
    occurredAt: Date,
  ): Promise<ReceiptRow> {
    const [receipt] = await this.database.$queryRaw<ReceiptRow[]>`
      SELECT receipt_id AS "receiptId", duplicate, correlation_id AS "correlationId"
      FROM private.record_provider_webhook_receipt(
        ${connectionId}::uuid, ${eventId}, ${eventType}, ${payloadHash}, ${occurredAt}::timestamptz
      )
    `;
    if (!receipt)
      throw new BadRequestException(
        'The provider receipt could not be recorded.',
      );
    return receipt;
  }

  private async completeReceipt(
    receiptId: string,
    status: 'PROCESSED' | 'FAILED' | 'IGNORED',
    errorCode: string | null,
  ): Promise<void> {
    await this.database.$queryRaw`
      SELECT private.complete_provider_webhook_receipt(
        ${receiptId}::uuid, ${status}::public.integration_event_status, ${errorCode}
      )
    `;
  }

  private whatsAppValues(payload: unknown): WhatsAppValue[] {
    if (!isObject(payload) || !Array.isArray(payload.entry)) return [];
    const values: WhatsAppValue[] = [];
    for (const entry of payload.entry) {
      if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        if (isObject(change) && isObject(change.value))
          values.push(change.value as WhatsAppValue);
      }
    }
    return values;
  }

  private whatsAppText(message: WhatsAppMessage): string | null {
    if (message.type === 'text' && message.text?.body)
      return message.text.body.trim().slice(0, 50_000);
    if (message.type === 'button' && message.button?.text)
      return message.button.text.trim().slice(0, 50_000);
    if (message.type === 'interactive') {
      return (
        (
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          ''
        )
          .trim()
          .slice(0, 50_000) || null
      );
    }
    return null;
  }

  private whatsAppTime(value: string | undefined): Date {
    const parsed = Number(value);
    const date = Number.isFinite(parsed) ? new Date(parsed * 1000) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private deliveryStatus(
    status: string,
  ): 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null {
    const mapped: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };
    return mapped[status.toLowerCase()] ?? null;
  }

  private microsoftNotifications(payload: unknown): MicrosoftNotification[] {
    if (!isObject(payload) || !Array.isArray(payload.value)) return [];
    return payload.value.filter(isObject) as MicrosoftNotification[];
  }

  private googleEnvelope(payload: unknown): {
    messageId: string;
    publishTime?: string;
  } {
    if (!isObject(payload) || !isObject(payload.message)) {
      throw new BadRequestException(
        'The Google notification envelope is invalid.',
      );
    }
    const messageId = payload.message.messageId;
    const publishTime = payload.message.publishTime;
    if (
      typeof messageId !== 'string' ||
      messageId.length < 1 ||
      messageId.length > 240
    ) {
      throw new BadRequestException(
        'The Google notification identifier is invalid.',
      );
    }
    return {
      messageId,
      ...(typeof publishTime === 'string' ? { publishTime } : {}),
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type WhatsAppMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  context?: { id?: string };
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};
type WhatsAppValue = {
  messages?: WhatsAppMessage[];
  statuses?: Array<{ id?: string; status?: string; timestamp?: string }>;
};
type MicrosoftNotification = {
  id?: string;
  subscriptionId?: string;
  resource?: string;
  clientState?: string;
};
