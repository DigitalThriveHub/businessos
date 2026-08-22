import { ClientPortalService } from './client-portal.service';

const USER = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated' as const,
  aal: 'aal1' as const,
  session_id: '22222222-2222-4222-8222-222222222222',
  is_anonymous: false as const,
};

describe('ClientPortalService', () => {
  it('reads the filtered portal dashboard without requiring staff membership', async () => {
    const dashboard = { accessGrants: [], matters: [] };
    const rls = {
      run: jest.fn().mockImplementation(async (context, action) => {
        expect(context).toEqual({ userId: USER.sub, aal: 'AAL1' });
        return action({
          $queryRaw: jest.fn().mockResolvedValue([{ dashboard }]),
        });
      }),
    };
    const service = new ClientPortalService(rls as never, {} as never);

    await expect(service.getDashboard(USER)).resolves.toEqual(dashboard);
  });

  it('hashes the raw token before atomic invitation acceptance', async () => {
    const accepted = {
      invitationId: '33333333-3333-4333-8333-333333333333',
      status: 'ACCEPTED',
    };
    const tokens = { hashToken: jest.fn().mockReturnValue('a'.repeat(64)) };
    const rls = {
      run: jest
        .fn()
        .mockImplementation(async (_context, action) =>
          action({ $queryRaw: jest.fn().mockResolvedValue([accepted]) }),
        ),
    };
    const service = new ClientPortalService(rls as never, tokens as never);

    await expect(
      service.acceptInvitation(`bop_v1_${'A'.repeat(43)}`, USER),
    ).resolves.toEqual(accepted);
    expect(tokens.hashToken).toHaveBeenCalledTimes(1);
  });
});
