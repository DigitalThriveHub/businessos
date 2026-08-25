import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import type { RlsTransactionService } from '../database/rls-transaction.service';
import { ComplianceAssuranceService } from './compliance-assurance.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

function createService() {
  const transaction = { $queryRaw: jest.fn() };
  const rls = {
    run: jest.fn(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    ),
  };
  return {
    transaction,
    rls,
    service: new ComplianceAssuranceService(
      rls as unknown as RlsTransactionService,
    ),
  };
}

describe('ComplianceAssuranceService', () => {
  it('reads the dashboard inside verified tenant and AAL context', async () => {
    const { service, transaction, rls } = createService();
    transaction.$queryRaw.mockResolvedValue([
      { dashboard: { generatedAt: new Date().toISOString(), rights: [] } },
    ]);
    await expect(service.getDashboard(CONTEXT)).resolves.toMatchObject({
      rights: [],
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

  it('requires a usable subject match before creating a rights request', async () => {
    const { service, transaction } = createService();
    await expect(
      service.createDataSubjectRequest(
        {
          requestType: 'ACCESS',
          subjectName: 'Alex Example',
          subjectEmail: null,
          subjectPhone: null,
          clientId: null,
          receivedAt: null,
          requestDetails: 'The person requested a copy of their information.',
          ownerUserId: null,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects impossible evidence dates before database mutation', async () => {
    const { service, transaction } = createService();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      service.recordEvidence(
        {
          evidenceKey: 'backup.restore',
          title: 'Restore test',
          category: 'RESILIENCE',
          evidenceReference: 'immutable://evidence/restore-1',
          evidenceSha256: 'a'.repeat(64),
          assessorName: 'Test reviewer',
          assessorOrganisation: 'Independent Assurance Ltd',
          scope: { environment: 'production' },
          testedAt: tomorrow,
          expiresAt: new Date(Date.now() + 172_800_000).toISOString(),
          notes: 'A full restore was tested against the documented objective.',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects evidence with an empty tested scope before database mutation', async () => {
    const { service, transaction } = createService();
    await expect(
      service.recordEvidence(
        {
          evidenceKey: 'operations.capacity_test',
          title: 'Production capacity exercise',
          category: 'RESILIENCE',
          evidenceReference: 'immutable://evidence/capacity-1',
          evidenceSha256: 'b'.repeat(64),
          assessorName: 'Test reviewer',
          assessorOrganisation: 'Independent Assurance Ltd',
          scope: {},
          testedAt: new Date(Date.now() - 3_600_000).toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          notes: 'The test completed but failed to identify its tested scope.',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns the recorded deadline extension without claiming legal approval', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockResolvedValue([
      {
        result: {
          id: '55555555-5555-4555-8555-555555555555',
          status: 'RECEIVED',
          extendedDueAt: '2026-11-25T12:00:00.000Z',
          notificationReferenceRecorded: true,
          version: 2,
        },
      },
    ]);
    await expect(
      service.extendDataSubjectRequest(
        '55555555-5555-4555-8555-555555555555',
        {
          extendedDueAt: '2026-11-25T12:00:00.000Z',
          reason:
            'The request is complex and spans several independently controlled systems.',
          notificationReference: 'document://rights/extension-notice-1',
          expectedVersion: 1,
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      status: 'RECEIVED',
      notificationReferenceRecorded: true,
      version: 2,
    });
  });

  it('maps permission, concurrency and outage errors without leaking SQL', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockRejectedValueOnce({ originalCode: '42501' });
    await expect(service.getDashboard(CONTEXT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    transaction.$queryRaw.mockRejectedValueOnce({ sqlState: '40001' });
    await expect(service.getDashboard(CONTEXT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    transaction.$queryRaw.mockRejectedValueOnce({ code: '08006' });
    await expect(service.getDashboard(CONTEXT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('records a blocked release decision as evidence without claiming approval', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockResolvedValue([
      {
        result: {
          id: '55555555-5555-4555-8555-555555555555',
          decision: 'BLOCKED',
          eligibleAtDecision: false,
        },
      },
    ]);
    await expect(
      service.decideProductionRelease(
        {
          releaseReference: 'release-2026.08.25',
          environment: 'PRODUCTION',
          decision: 'BLOCKED',
          rationale:
            'Release remains blocked while external production evidence is incomplete.',
          changeReference: 'CHG-1004',
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({ decision: 'BLOCKED' });
  });
});
