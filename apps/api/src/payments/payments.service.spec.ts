import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../database/prisma.service';
import type { RlsTransactionService } from '../database/rls-transaction.service';
import { PaymentsService } from './payments.service';
import type { StripeGatewayService } from './stripe-gateway.service';

const USER = {
  sub: '11111111-1111-4111-8111-111111111111',
  aal: 'aal2',
};

describe('PaymentsService', () => {
  const transaction = { $queryRaw: jest.fn() };
  const database = { $queryRaw: jest.fn() };
  const rls = {
    run: jest.fn(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    ),
  };
  const stripe = {
    createCheckoutSession: jest.fn(),
    verifyWebhook: jest.fn(),
  };
  const config = {
    get: jest.fn().mockReturnValue('acct_platform123'),
  };
  let service: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    rls.run.mockImplementation(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    );
    service = new PaymentsService(
      config as unknown as ConfigService,
      database as unknown as PrismaService,
      rls as unknown as RlsTransactionService,
      stripe as unknown as StripeGatewayService,
    );
  });

  it('creates and attaches a Stripe session for an authorised portal invoice', async () => {
    const expiresAt = new Date('2026-08-22T12:30:00.000Z');
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          checkoutId: '22222222-2222-4222-8222-222222222222',
          organisationId: '33333333-3333-4333-8333-333333333333',
          connectionId: '44444444-4444-4444-8444-444444444444',
          stripeAccountId: 'acct_platform123',
          invoiceId: '55555555-5555-4555-8555-555555555555',
          invoiceNumber: 'INV-00000001',
          clientId: '66666666-6666-4666-8666-666666666666',
          customerEmail: 'client@example.test',
          amountMinor: 12_000n,
          currencyCode: 'GBP',
          status: 'PENDING_PROVIDER',
          checkoutUrl: null,
          expiresAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          checkoutId: '22222222-2222-4222-8222-222222222222',
          status: 'OPEN',
          checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
          expiresAt,
        },
      ]);
    stripe.createCheckoutSession.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      expiresAt,
    });

    await expect(
      service.createPortalCheckout(
        '55555555-5555-4555-8555-555555555555',
        { idempotencyKey: 'portal-checkout/invoice-1' },
        USER as never,
      ),
    ).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      expiresAt,
      status: 'OPEN',
    });
    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(rls.run).toHaveBeenCalledWith(
      { userId: USER.sub, aal: 'AAL2' },
      expect.any(Function),
    );
  });

  it('acknowledges unsupported authentic Stripe events without database writes', async () => {
    stripe.verifyWebhook.mockReturnValue({
      id: 'evt_1',
      type: 'customer.created',
      created: 1_787_398_400,
      data: { object: {} },
    });

    await expect(
      service.handleStripeWebhook(Buffer.from('{}'), 'signature'),
    ).resolves.toEqual({ accepted: true });
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects incomplete checkout settlement evidence', async () => {
    stripe.verifyWebhook.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: 1_787_398_400,
      data: { object: { id: 'cs_test_1', payment_status: 'paid' } },
    });

    await expect(
      service.handleStripeWebhook(Buffer.from('{}'), 'signature'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it('passes verified settlement evidence to the atomic database function', async () => {
    stripe.verifyWebhook.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      account: 'acct_tenant123',
      created: 1_787_398_400,
      data: {
        object: {
          id: 'cs_test_1',
          payment_intent: 'pi_1',
          payment_status: 'paid',
          amount_total: 12_000,
          currency: 'gbp',
        },
      },
    });
    database.$queryRaw.mockResolvedValue([
      { accepted: true, duplicate: false, checkoutStatus: 'COMPLETED' },
    ]);

    await expect(
      service.handleStripeWebhook(Buffer.from('{}'), 'signature'),
    ).resolves.toEqual({ accepted: true });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
