import { ForbiddenException } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import type { RlsTransactionService } from '../database/rls-transaction.service';
import { CommandCentreService } from './command-centre.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('CommandCentreService', () => {
  const transaction = { $queryRaw: jest.fn() };
  const rls = {
    run: jest.fn(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    ),
  };
  const service = new CommandCentreService(
    rls as unknown as RlsTransactionService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns the tenant-scoped operational dashboard', async () => {
    const dashboard = { summary: { openMatters: 4 } };
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

  it('maps database permission denial to a safe forbidden response', async () => {
    transaction.$queryRaw.mockRejectedValue({ originalCode: '42501' });
    await expect(service.getDashboard(CONTEXT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
