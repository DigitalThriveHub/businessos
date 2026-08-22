import { BadRequestException } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { FinanceService } from './finance.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('FinanceService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const rls = {
    run: jest.fn(async (_context, action) => action(transaction)),
  };
  let service: FinanceService;

  beforeEach(() => {
    jest.resetAllMocks();
    transaction.$executeRaw.mockResolvedValue(1);
    rls.run.mockImplementation(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    );
    service = new FinanceService(rls as unknown as RlsTransactionService);
  });

  it('returns the protected finance dashboard', async () => {
    const dashboard = { summary: { openCount: 0 } };
    transaction.$queryRaw.mockResolvedValue([{ dashboard }]);

    await expect(service.getDashboard(CONTEXT)).resolves.toEqual(dashboard);
    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: CONTEXT.userId,
        organisationId: CONTEXT.organisationId,
        aal: 'AAL2',
      },
      expect.any(Function),
    );
  });

  it('calculates VAT in minor units before inserting a draft', async () => {
    const payload = { id: '55555555-5555-4555-8555-555555555555' };
    transaction.$queryRaw.mockResolvedValue([{ document: payload }]);

    await expect(
      service.createDocument(
        {
          clientId: '66666666-6666-4666-8666-666666666666',
          documentType: 'INVOICE',
          currencyCode: 'GBP',
          lines: [
            {
              description: 'Advice',
              quantityMilli: 1500,
              unitAmountMinor: 10_000,
              taxCategory: 'STANDARD',
              vatRateBasisPoints: 2000,
            },
          ],
        },
        CONTEXT,
      ),
    ).resolves.toEqual(payload);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects VAT on an exempt line before touching the database', async () => {
    await expect(
      service.createDocument(
        {
          clientId: '66666666-6666-4666-8666-666666666666',
          documentType: 'INVOICE',
          currencyCode: 'GBP',
          lines: [
            {
              description: 'Exempt service',
              quantityMilli: 1000,
              unitAmountMinor: 10_000,
              taxCategory: 'EXEMPT',
              vatRateBasisPoints: 2000,
            },
          ],
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rls.run).not.toHaveBeenCalled();
  });

  it('rejects an unbalanced payment allocation before database execution', async () => {
    await expect(
      service.recordPayment(
        {
          clientId: '66666666-6666-4666-8666-666666666666',
          paymentType: 'RECEIPT',
          method: 'BANK_TRANSFER',
          currencyCode: 'GBP',
          amountMinor: 12_000,
          occurredAt: '2026-08-22T10:00:00.000Z',
          idempotencyKey: 'finance-e2e/payment-2',
          allocations: [
            {
              documentId: '77777777-7777-4777-8777-777777777777',
              amountMinor: 10_000,
            },
          ],
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rls.run).not.toHaveBeenCalled();
  });
});
