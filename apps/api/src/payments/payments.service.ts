import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  resolveAssuranceLevel,
  type VerifiedUserJwtPayload,
} from '../auth/verified-jwt-payload';
import { PrismaService } from '../database/prisma.service';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { CreatePortalCheckoutDto } from './dto/payments.dto';
import type {
  PreparedCheckoutRow,
  StripeWebhookResultRow,
} from './payments.types';
import { StripeGatewayService } from './stripe-gateway.service';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 6) return undefined;
  for (const key of ['originalCode', 'sqlState', 'sqlstate']) {
    const value = error[key];
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }
  for (const key of [
    'cause',
    'meta',
    'driverAdapterError',
    'originalError',
    'error',
  ]) {
    const code = postgresCode(error[key], depth + 1);
    if (code) return code;
  }
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly database: PrismaService,
    private readonly rls: RlsTransactionService,
    private readonly stripe: StripeGatewayService,
  ) {}

  createPortalCheckout(
    invoiceId: string,
    dto: CreatePortalCheckoutDto,
    user: VerifiedUserJwtPayload,
  ): Promise<{ checkoutUrl: string; expiresAt: Date; status: 'OPEN' }> {
    return this.runSafely('checkout.create', async () => {
      const [prepared] = await this.rls.run(
        this.portalContext(user),
        (transaction) =>
          transaction.$queryRaw<PreparedCheckoutRow[]>`
          SELECT checkout_id AS "checkoutId",
            organisation_id AS "organisationId",
            connection_id AS "connectionId",
            stripe_account_id AS "stripeAccountId",
            invoice_id AS "invoiceId", invoice_number AS "invoiceNumber",
            client_id AS "clientId", customer_email AS "customerEmail",
            amount_minor AS "amountMinor", currency_code AS "currencyCode",
            status, checkout_url AS "checkoutUrl", expires_at AS "expiresAt"
          FROM private.prepare_client_portal_checkout(
            ${invoiceId}::uuid, ${dto.idempotencyKey}
          )
        `,
      );
      if (!prepared) throw new NotFoundException('The invoice was not found.');

      if (
        prepared.status === 'OPEN' &&
        prepared.checkoutUrl &&
        prepared.expiresAt &&
        prepared.expiresAt.getTime() > Date.now()
      ) {
        return {
          checkoutUrl: prepared.checkoutUrl,
          expiresAt: prepared.expiresAt,
          status: 'OPEN' as const,
        };
      }
      if (prepared.status !== 'PENDING_PROVIDER') {
        throw new ConflictException(
          'This payment checkout is no longer available.',
        );
      }

      try {
        const session = await this.stripe.createCheckoutSession({
          checkoutId: prepared.checkoutId,
          stripeAccountId: prepared.stripeAccountId,
          invoiceNumber: prepared.invoiceNumber,
          customerEmail: prepared.customerEmail,
          amountMinor: prepared.amountMinor,
          currencyCode: prepared.currencyCode,
        });

        const [attached] = await this.rls.run(
          this.portalContext(user),
          (transaction) =>
            transaction.$queryRaw<
              Array<{
                checkoutId: string;
                status: 'OPEN';
                checkoutUrl: string;
                expiresAt: Date;
              }>
            >`
            SELECT checkout_id AS "checkoutId", status,
              checkout_url AS "checkoutUrl", expires_at AS "expiresAt"
            FROM private.attach_stripe_checkout_session(
              ${prepared.checkoutId}::uuid, ${session.id}, ${session.url},
              ${session.expiresAt}
            )
          `,
        );
        if (!attached) {
          throw new InternalServerErrorException(
            'The checkout session could not be attached.',
          );
        }
        return {
          checkoutUrl: attached.checkoutUrl,
          expiresAt: attached.expiresAt,
          status: 'OPEN' as const,
        };
      } catch (error: unknown) {
        await this.rls
          .run(
            this.portalContext(user),
            (transaction) =>
              transaction.$queryRaw`
              SELECT private.fail_payment_checkout(
                ${prepared.checkoutId}::uuid, 'PROVIDER_CREATE_FAILED'
              )
            `,
          )
          .catch(() => undefined);
        throw error;
      }
    });
  }

  async handleStripeWebhook(
    rawBody: Buffer | undefined,
    signature: string,
  ): Promise<{ accepted: boolean }> {
    const event = this.stripe.verifyWebhook(rawBody, signature);
    const eventId = event.id;
    const eventType = event.type;
    const created = event.created;
    const data = event.data;
    if (
      typeof eventId !== 'string' ||
      eventId.length > 240 ||
      typeof eventType !== 'string' ||
      eventType.length > 160 ||
      typeof created !== 'number' ||
      !Number.isSafeInteger(created) ||
      !isRecord(data) ||
      !isRecord(data.object)
    ) {
      throw new BadRequestException('The Stripe webhook payload is invalid.');
    }

    const supported = new Set([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
    ]);
    if (!supported.has(eventType)) return { accepted: true };

    const session = data.object;
    const sessionId = session.id;
    const paymentIntent = session.payment_intent;
    const paymentStatus = session.payment_status;
    const amountTotal = session.amount_total;
    const currency = session.currency;
    const stripeAccount =
      typeof event.account === 'string'
        ? event.account
        : this.config.get<string>('STRIPE_PLATFORM_ACCOUNT_ID');
    if (
      !stripeAccount ||
      typeof sessionId !== 'string' ||
      typeof paymentStatus !== 'string' ||
      typeof amountTotal !== 'number' ||
      !Number.isSafeInteger(amountTotal) ||
      amountTotal < 0 ||
      typeof currency !== 'string' ||
      !/^[a-z]{3}$/.test(currency) ||
      (paymentIntent !== null &&
        paymentIntent !== undefined &&
        typeof paymentIntent !== 'string')
    ) {
      throw new BadRequestException('The Stripe checkout evidence is invalid.');
    }

    const payloadHash = createHash('sha256').update(rawBody!).digest('hex');
    const [result] = await this.database.$queryRaw<StripeWebhookResultRow[]>`
      SELECT accepted, duplicate, checkout_status AS "checkoutStatus"
      FROM private.process_stripe_checkout_event(
        ${eventId}, ${eventType}, ${stripeAccount}, ${sessionId},
        ${typeof paymentIntent === 'string' ? paymentIntent : ''},
        ${paymentStatus}, ${BigInt(amountTotal)}, ${currency},
        ${new Date(created * 1_000)}, ${payloadHash}
      )
    `;
    if (!result?.accepted) {
      throw new InternalServerErrorException(
        'The Stripe event could not be processed safely.',
      );
    }
    return { accepted: true };
  }

  private portalContext(user: VerifiedUserJwtPayload) {
    return { userId: user.sub, aal: resolveAssuranceLevel(user) } as const;
  }

  private async runSafely<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      )
        throw error;
      const code = postgresCode(error);
      if (code === '42501')
        throw new ForbiddenException(
          'This account cannot pay the requested invoice.',
        );
      if (['P0002', '02000'].includes(code ?? ''))
        throw new NotFoundException('The invoice was not found.');
      if (['23505', '40001', '55000'].includes(code ?? ''))
        throw new ConflictException(
          'The payment state changed. Refresh and try again.',
        );
      if (['22023', '23514', '23503'].includes(code ?? ''))
        throw new BadRequestException('The payment request is invalid.');

      this.logger.error(
        `Payment operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The secure payment service is temporarily unavailable.',
      );
    }
  }
}
