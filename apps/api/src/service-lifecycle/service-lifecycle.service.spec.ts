import { ServiceLifecycleService } from './service-lifecycle.service';

describe('ServiceLifecycleService', () => {
  const context = {
    userId: '11111111-1111-4111-8111-111111111111',
    organisationId: '22222222-2222-4222-8222-222222222222',
    aal: 'AAL2' as const,
  };

  it('uses the trusted organisation context for readiness', async () => {
    const rls = {
      run: jest.fn().mockImplementation(async (security, action) => {
        expect(security).toEqual(context);
        await action({ $queryRaw: jest.fn().mockResolvedValue([]) });
        return [{ readiness: { matterId: 'matter' } }];
      }),
    };
    const service = new ServiceLifecycleService(rls as never);
    await expect(
      service.readiness('33333333-3333-4333-8333-333333333333', context),
    ).resolves.toEqual({ matterId: 'matter' });
  });

  it('creates an audited exception through the database contract', async () => {
    const rls = {
      run: jest.fn().mockImplementation(async (_security, action) => {
        await action({ $queryRaw: jest.fn().mockResolvedValue([]) });
        return [{ id: '44444444-4444-4444-8444-444444444444' }];
      }),
    };
    const service = new ServiceLifecycleService(rls as never);
    await expect(
      service.createException(
        {
          matterId: '33333333-3333-4333-8333-333333333333',
          category: 'MISSING_EVIDENCE',
          severity: 'HIGH',
          title: 'Evidence missing',
          detail: 'Required evidence is missing from the case.',
          ownerUserId: context.userId,
          dueAt: new Date(Date.now() + 60_000).toISOString(),
        },
        context,
      ),
    ).resolves.toEqual({ id: '44444444-4444-4444-8444-444444444444' });
  });
});
