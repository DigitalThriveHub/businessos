import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RlsTransactionService } from '../../../database/rls-transaction.service';
import { REQUIRED_PERMISSIONS_KEY } from '../../decorators/require-permissions.decorator';
import type { OrganisationScopedRequest } from '../../request-security-context';
import { PermissionGuard } from './permission.guard';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';

const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';

const SESSION_ID = '44444444-4444-4444-8444-444444444444';

type TestPermission = {
  key: string;
  requiresMfa: boolean;
};

function assignment(permissions: TestPermission[]) {
  return {
    role: {
      permissions: permissions.map((permission) => ({
        permission,
      })),
    },
  };
}

function createExecutionContext(
  aal: 'AAL1' | 'AAL2' = 'AAL1',
  includeAccessContext = true,
): {
  context: ExecutionContext;
  request: OrganisationScopedRequest;
} {
  const handler = () => undefined;
  class TestController {}

  const request = {
    headers: {},
    body: {},
    query: {},
    params: {},
    organisationAccess: includeAccessContext
      ? Object.freeze({
          userId: USER_ID,
          organisationId: ORGANISATION_ID,
          membershipId: MEMBERSHIP_ID,
          sessionId: SESSION_ID,
          aal,
        })
      : undefined,
  } as unknown as OrganisationScopedRequest;

  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return {
    context,
    request,
  };
}

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: {
    getAllAndOverride: jest.Mock;
  };
  let rls: {
    run: jest.Mock;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };

    rls = {
      run: jest.fn(),
    };

    guard = new PermissionGuard(
      reflector as unknown as Reflector,
      rls as unknown as RlsTransactionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function mockAssignments(
    assignments: ReturnType<typeof assignment>[],
  ): jest.Mock {
    const findMany = jest.fn().mockResolvedValue(assignments);

    const transaction = {
      roleAssignment: {
        findMany,
      },
    };

    rls.run.mockImplementation(
      async (
        _context: unknown,
        operation: (client: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );

    return findMany;
  }

  it('allows routes that declare no permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const { context } = createExecutionContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('grants every declared permission inside the verified tenant context', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      'enquiries.read',
      'enquiries.update',
    ]);

    const findMany = mockAssignments([
      assignment([
        {
          key: 'enquiries.read',
          requiresMfa: false,
        },
        {
          key: 'enquiries.update',
          requiresMfa: false,
        },
      ]),
    ]);

    const { context } = createExecutionContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL1',
      },
      expect.any(Function),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userProfileId: USER_ID,
          organisationId: ORGANISATION_ID,
          organisationMembershipId: MEMBERSHIP_ID,
          revokedAt: null,
          deletedAt: null,
          organisationMembership: {
            is: expect.objectContaining({
              id: MEMBERSHIP_ID,
              userProfileId: USER_ID,
              organisationId: ORGANISATION_ID,
              status: 'ACTIVE',
              deletedAt: null,
            }),
          },
        }),
      }),
    );
  });

  it('requires every declared permission', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      'enquiries.read',
      'enquiries.delete',
    ]);

    mockAssignments([
      assignment([
        {
          key: 'enquiries.read',
          requiresMfa: false,
        },
      ]),
    ]);

    const { context } = createExecutionContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('denies an MFA-protected permission at AAL1', async () => {
    reflector.getAllAndOverride.mockReturnValue(['enquiries.delete']);

    mockAssignments([
      assignment([
        {
          key: 'enquiries.delete',
          requiresMfa: true,
        },
      ]),
    ]);

    const { context } = createExecutionContext('AAL1');

    try {
      await guard.canActivate(context);
      throw new Error('Expected MFA enforcement to deny access');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);

      const response = (error as ForbiddenException).getResponse();

      expect(response).toEqual(
        expect.objectContaining({
          code: 'MFA_REQUIRED',
          message:
            'Multi-factor authentication is required to perform this action',
        }),
      );
    }
  });

  it('allows an MFA-protected permission at AAL2', async () => {
    reflector.getAllAndOverride.mockReturnValue(['enquiries.delete']);

    mockAssignments([
      assignment([
        {
          key: 'enquiries.delete',
          requiresMfa: true,
        },
      ]),
    ]);

    const { context } = createExecutionContext('AAL2');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects permission evaluation without verified organisation access', async () => {
    reflector.getAllAndOverride.mockReturnValue(['enquiries.read']);

    const { context } = createExecutionContext('AAL1', false);

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );

    expect(rls.run).not.toHaveBeenCalled();
  });
});
