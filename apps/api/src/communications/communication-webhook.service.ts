import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import {
  EmailService,
  type ResendWebhookHeaders,
} from '../notifications/email.service';

type RecordValue = Record<string, unknown>;

type DeliveryEventType =
  'ACCEPTED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED';

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EVENT_MAP = new Map<string, DeliveryEventType>([
  ['email.sent', 'ACCEPTED'],
  ['email.delivered', 'DELIVERED'],
  ['email.bounced', 'BOUNCED'],
  ['email.complained', 'COMPLAINED'],
  ['email.failed', 'FAILED'],
  ['email.suppressed', 'FAILED'],
]);

@Injectable()
export class CommunicationWebhookService {
  private readonly logger = new Logger(CommunicationWebhookService.name);

  constructor(
    private readonly email: EmailService,
    private readonly database: PrismaService,
  ) {}

  async handleResend(
    rawPayload: Buffer | undefined,
    headers: ResendWebhookHeaders,
  ): Promise<{ accepted: boolean }> {
    if (!rawPayload || rawPayload.length === 0 || rawPayload.length > 100_000) {
      throw new BadRequestException('The webhook payload is invalid.');
    }

    let verified: unknown;
    try {
      verified = this.email.verifyResendWebhook(
        rawPayload.toString('utf8'),
        headers,
      );
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logger.warn(
        `Rejected Resend webhook; errorType=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      throw new BadRequestException('The webhook signature is invalid.');
    }

    if (!isRecord(verified) || !isRecord(verified.data)) {
      throw new BadRequestException('The webhook payload is invalid.');
    }

    const eventName = verified.type;
    const providerMessageId = verified.data.email_id;
    const eventType =
      typeof eventName === 'string' ? EVENT_MAP.get(eventName) : undefined;

    if (!eventType) {
      return { accepted: true };
    }

    if (
      typeof providerMessageId !== 'string' ||
      providerMessageId.length === 0 ||
      providerMessageId.length > 240
    ) {
      throw new BadRequestException('The webhook payload is invalid.');
    }

    const occurredAt =
      typeof verified.created_at === 'string' &&
      Number.isFinite(Date.parse(verified.created_at))
        ? new Date(verified.created_at)
        : new Date();

    const minimalEvidence = JSON.stringify({
      eventType: eventName,
      providerMessageId,
    });

    await this.database.$queryRaw`
      SELECT *
      FROM private.record_communication_delivery_event(
        'resend',
        ${headers.id},
        ${providerMessageId},
        ${eventType}::public.communication_delivery_event_type,
        ${occurredAt},
        ${minimalEvidence}::jsonb
      )
    `;

    return { accepted: true };
  }
}
