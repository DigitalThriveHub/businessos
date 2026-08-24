import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PilotReadinessService } from './pilot-readiness.service';

const context = {
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2' as const,
};

function databaseError(code: string) {
  return { meta: { driverAdapterError: { cause: { originalCode: code } } } };
}

describe('PilotReadinessService', () => {
  it('returns the evidence-backed dashboard', async () => {
    const dashboard = { summary: { readyForPilot: false } };
    const rls = {
      run: jest.fn(async (_scope, work) =>
        work({ $queryRaw: jest.fn().mockResolvedValue([{ dashboard }]) }),
      ),
    };
    await expect(
      new PilotReadinessService(rls as never).dashboard(context),
    ).resolves.toEqual(dashboard);
  });

  it('records role acceptance inside the tenant transaction', async () => {
    const rls = {
      run: jest.fn(async (_scope, work) =>
        work({ $queryRaw: jest.fn().mockResolvedValue([{ id: 'evidence' }]) }),
      ),
    };
    await expect(
      new PilotReadinessService(rls as never).recordAcceptance(
        {
          key: 'role.solicitor',
          roleName: 'Solicitor',
          scenarioName: 'Review and approve a case',
          status: 'PASS',
          evidenceNote:
            'Solicitor completed the controlled review successfully.',
        },
        context,
      ),
    ).resolves.toEqual([{ id: 'evidence' }]);
    expect(rls.run).toHaveBeenCalledTimes(1);
  });

  it('maps database permission and concurrency failures safely', async () => {
    const denied = { run: jest.fn().mockRejectedValue(databaseError('42501')) };
    await expect(
      new PilotReadinessService(denied as never).dashboard(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const conflict = {
      run: jest.fn().mockRejectedValue(databaseError('40001')),
    };
    await expect(
      new PilotReadinessService(conflict as never).recordAcceptance(
        {
          key: 'role.sales',
          roleName: 'Sales',
          scenarioName: 'Convert qualified enquiry',
          status: 'PASS',
          evidenceNote: 'Sales conversion completed with evidence.',
          expectedVersion: 1,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
