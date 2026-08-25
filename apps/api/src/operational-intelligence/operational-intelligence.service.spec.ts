import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import type { RlsTransactionService } from '../database/rls-transaction.service';
import type { OperationalIntelligenceConfig } from './operational-intelligence.config';
import { OperationalIntelligenceService } from './operational-intelligence.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

function createService(enabled = false) {
  const transaction = { $queryRaw: jest.fn() };
  const rls = {
    run: jest.fn(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    ),
  };
  const config = {
    enabled,
    model: enabled ? 'approved-vision-model' : '',
    inputCostPerMillionMinor: 0,
    outputCostPerMillionMinor: 0,
  } as OperationalIntelligenceConfig;
  return {
    transaction,
    rls,
    service: new OperationalIntelligenceService(
      rls as unknown as RlsTransactionService,
      config,
    ),
  };
}

describe('OperationalIntelligenceService', () => {
  it('returns the tenant dashboard with an honest free-mode boundary', async () => {
    const { service, transaction, rls } = createService(false);
    transaction.$queryRaw.mockResolvedValue([
      { dashboard: { generatedAt: new Date().toISOString(), myWork: {} } },
    ]);
    await expect(service.getDashboard(CONTEXT)).resolves.toMatchObject({
      myWork: {},
      provider: {
        state: 'FREE_MODE',
        generationEnabled: false,
        manualReviewAvailable: true,
      },
    });
    expect(rls.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CONTEXT.userId,
        organisationId: CONTEXT.organisationId,
        aal: 'AAL2',
      }),
      expect.any(Function),
    );
  });

  it('executes a human document review inside verified RLS context', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockResolvedValue([
      {
        result: {
          analysisId: '55555555-5555-4555-8555-555555555555',
          status: 'REVIEWED',
        },
      },
    ]);
    await expect(
      service.reviewDocument(
        '55555555-5555-4555-8555-555555555555',
        {
          decision: 'ACCEPTED',
          confirmedCategory: 'IDENTITY',
          confirmedExpiryDate: null,
          corrections: {},
          notes: 'Confirmed against the original document.',
          createFollowUpTask: false,
          expectedVersion: 1,
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({ status: 'REVIEWED' });
  });

  it('rejects impossible benchmark assumptions before database mutation', async () => {
    const { service, transaction } = createService();
    await expect(
      service.updateBenchmark(
        '55555555-5555-4555-8555-555555555555',
        {
          estimatedManualMinutes: 5,
          estimatedAutomatedMinutes: 6,
          hourlyCostMinor: 3000,
          isActive: true,
          expectedVersion: 1,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('maps database permission denial without leaking database detail', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockRejectedValue({ originalCode: '42501' });
    await expect(service.getDashboard(CONTEXT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('maps concurrent review changes to a safe conflict', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockRejectedValue({ sqlState: '40001' });
    await expect(
      service.reviewDocument(
        '55555555-5555-4555-8555-555555555555',
        {
          decision: 'CORRECTED',
          confirmedCategory: 'LEGAL',
          corrections: {},
          notes: 'Corrected after checking the source.',
          createFollowUpTask: false,
          expectedVersion: 2,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
