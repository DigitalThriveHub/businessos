import { createHmac } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { StripeGatewayService } from './stripe-gateway.service';

describe('StripeGatewayService', () => {
  const values: Record<string, string | number> = {
    STRIPE_SECRET_KEY: 'sk_test_gate_f',
    STRIPE_PLATFORM_ACCOUNT_ID: 'acct_platform123',
    STRIPE_WEBHOOK_SECRET: 'whsec_gate_f_webhook_secret',
    WEB_APP_URL: 'https://businessos.example/',
    INTEGRATION_WEBHOOK_TOLERANCE_SECONDS: 300,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    }),
  } as unknown as ConfigService;
  let service: StripeGatewayService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_787_398_400_000);
    service = new StripeGatewayService(config);
  });

  afterEach(() => jest.restoreAllMocks());

  it('verifies an authentic Stripe signature and parses the event', () => {
    const timestamp = '1787398400';
    const body = Buffer.from(
      JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }),
    );
    const digest = createHmac('sha256', String(values.STRIPE_WEBHOOK_SECRET))
      .update(timestamp)
      .update('.')
      .update(body)
      .digest('hex');

    expect(
      service.verifyWebhook(body, `t=${timestamp},v1=${digest}`),
    ).toMatchObject({ id: 'evt_1' });
  });

  it('rejects stale, malformed and tampered Stripe evidence', () => {
    const body = Buffer.from('{}');
    expect(() =>
      service.verifyWebhook(body, `t=1787397000,v1=${'0'.repeat(64)}`),
    ).toThrow('outside tolerance');
    expect(() =>
      service.verifyWebhook(body, `t=1787398400,v1=${'0'.repeat(64)}`),
    ).toThrow(BadRequestException);
    expect(() => service.verifyWebhook(undefined, 't=1,v1=0')).toThrow(
      BadRequestException,
    );
  });

  it('creates a server-side Checkout session with idempotency and Connect isolation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'cs_test_gatef123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_gatef123',
          expires_at: 1_787_400_200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      service.createCheckoutSession({
        checkoutId: '11111111-1111-4111-8111-111111111111',
        stripeAccountId: 'acct_tenant123',
        invoiceNumber: 'INV-00000001',
        customerEmail: 'client@example.test',
        amountMinor: 12_000n,
        currencyCode: 'GBP',
      }),
    ).resolves.toMatchObject({
      id: 'cs_test_gatef123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_gatef123',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/checkout/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key':
            'businessos-checkout/11111111-1111-4111-8111-111111111111',
          'Stripe-Account': 'acct_tenant123',
        }),
      }),
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const form = new URLSearchParams(String(request?.body));
    expect(form.get('expires_at')).toBe('1787402000');
  });

  it('rejects an untrusted provider redirect URL', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'cs_test_gatef123',
          url: 'https://evil.example/collect',
          expires_at: 1_787_400_200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      service.createCheckoutSession({
        checkoutId: '11111111-1111-4111-8111-111111111111',
        stripeAccountId: 'acct_platform123',
        invoiceNumber: 'INV-1',
        customerEmail: null,
        amountMinor: 100n,
        currencyCode: 'GBP',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('fails closed when provider credentials are missing', async () => {
    const missing = new StripeGatewayService({
      get: jest.fn(),
    } as unknown as ConfigService);
    await expect(
      missing.createCheckoutSession({
        checkoutId: '11111111-1111-4111-8111-111111111111',
        stripeAccountId: 'acct_platform123',
        invoiceNumber: 'INV-1',
        customerEmail: null,
        amountMinor: 100n,
        currencyCode: 'GBP',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
