import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { StripeCheckoutSession } from './payments.types';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class StripeGatewayService {
  constructor(private readonly config: ConfigService) {}

  async createCheckoutSession(input: {
    checkoutId: string;
    stripeAccountId: string;
    invoiceNumber: string;
    customerEmail: string | null;
    amountMinor: bigint;
    currencyCode: string;
  }): Promise<StripeCheckoutSession> {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    const platformAccount = this.config.get<string>(
      'STRIPE_PLATFORM_ACCOUNT_ID',
    );
    if (!secretKey || !platformAccount) {
      throw new ServiceUnavailableException(
        'Online card payments are not configured.',
      );
    }

    const webAppUrl = this.config.getOrThrow<string>('WEB_APP_URL');
    // Stripe requires Checkout expiry to be at least 30 minutes after its own
    // session-creation time. Request one hour so network latency cannot move
    // the value below the provider's lower bound.
    const requestedAt = Math.floor(Date.now() / 1_000);
    const expiresAt = requestedAt + 60 * 60;
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${webAppUrl}portal?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${webAppUrl}portal?payment=cancelled`,
      client_reference_id: input.checkoutId,
      expires_at: String(expiresAt),
      'metadata[businessos_checkout_id]': input.checkoutId,
      'payment_intent_data[metadata][businessos_checkout_id]': input.checkoutId,
      'line_items[0][price_data][currency]': input.currencyCode.toLowerCase(),
      'line_items[0][price_data][product_data][name]': `Invoice ${input.invoiceNumber}`,
      'line_items[0][price_data][unit_amount]': input.amountMinor.toString(),
      'line_items[0][quantity]': '1',
    });
    if (input.customerEmail) form.set('customer_email', input.customerEmail);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `businessos-checkout/${input.checkoutId}`,
    };
    if (input.stripeAccountId !== platformAccount) {
      headers['Stripe-Account'] = input.stripeAccountId;
    }
    const apiVersion = this.config.get<string>('STRIPE_API_VERSION');
    if (apiVersion) headers['Stripe-Version'] = apiVersion;

    let response: Response;
    try {
      response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers,
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayException(
        'The payment provider could not be reached. No payment was taken.',
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body)) {
      throw new BadGatewayException(
        'The payment provider rejected the checkout request. No payment was taken.',
      );
    }

    const id = body.id;
    const url = body.url;
    const providerExpiry = body.expires_at;
    if (
      typeof id !== 'string' ||
      !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(id) ||
      typeof url !== 'string' ||
      url.length > 2_048 ||
      typeof providerExpiry !== 'number' ||
      !Number.isSafeInteger(providerExpiry) ||
      providerExpiry <= requestedAt + 60 ||
      providerExpiry > requestedAt + 24 * 60 * 60 + 300
    ) {
      throw new BadGatewayException(
        'The payment provider returned an invalid checkout response.',
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadGatewayException(
        'The payment provider returned an invalid checkout URL.',
      );
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname !== 'checkout.stripe.com'
    ) {
      throw new BadGatewayException(
        'The payment provider returned an untrusted checkout URL.',
      );
    }

    return { id, url, expiresAt: new Date(providerExpiry * 1_000) };
  }

  verifyWebhook(
    rawBody: Buffer | undefined,
    signatureHeader: string,
  ): JsonRecord {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new ServiceUnavailableException(
        'The Stripe webhook service is not configured.',
      );
    }
    if (!rawBody || rawBody.length === 0 || rawBody.length > 1_048_576) {
      throw new BadRequestException('The Stripe webhook payload is invalid.');
    }

    const values = new Map<string, string[]>();
    for (const part of signatureHeader.split(',')) {
      const [key, value] = part.split('=', 2);
      if (!key || !value) continue;
      const entries = values.get(key) ?? [];
      entries.push(value);
      values.set(key, entries);
    }
    const timestamp = values.get('t')?.[0];
    const signatures = values.get('v1') ?? [];
    if (!timestamp || !/^\d{10}$/.test(timestamp) || signatures.length === 0) {
      throw new BadRequestException('The Stripe webhook signature is invalid.');
    }

    const observed = Number(timestamp);
    const tolerance = this.config.get<number>(
      'INTEGRATION_WEBHOOK_TOLERANCE_SECONDS',
      300,
    );
    if (
      !Number.isSafeInteger(observed) ||
      Math.abs(Math.floor(Date.now() / 1_000) - observed) > tolerance
    ) {
      throw new BadRequestException(
        'The Stripe webhook timestamp is outside tolerance.',
      );
    }

    const expected = createHmac('sha256', webhookSecret)
      .update(timestamp, 'utf8')
      .update('.', 'utf8')
      .update(rawBody)
      .digest();
    const valid = signatures.some((signature) => {
      if (!/^[0-9a-f]{64}$/.test(signature)) return false;
      const supplied = Buffer.from(signature, 'hex');
      return (
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected)
      );
    });
    if (!valid) {
      throw new BadRequestException('The Stripe webhook signature is invalid.');
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('The Stripe webhook payload is invalid.');
    }
    if (!isRecord(event)) {
      throw new BadRequestException('The Stripe webhook payload is invalid.');
    }
    return event;
  }
}
