import {
  BadRequestException,
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { RlsTransactionService } from '../../../database/rls-transaction.service';
import {
  type OrganisationScopedRequest,
} from '../../request-security-context';
import type {
  VerifiedUserJwtPayload,
} from '../../verified-jwt-payload';
import { OrganisationAccessGuard } from './organisation-access.guard';

const USER_ID =
  '11111111-1111-4111-8111-111111111111';

const SESSION_ID =
  '22222222-2222-4222-8222-222222222222';

const ORGANISATION_ID =
  '33333333-3333-4333-8333-333333333333';

const OTHER_ORGANISATION_ID =
  '44444444-4444-4444-8444-444444444444';

const MEMBERSHIP_ID =
  '55555555-5555-4555-8555-555555555555';

function validUser(): VerifiedUserJwtPayload {
  const now = Math.floor(Date.now() / 1_000);

  return {
    iss: 'https://example.supabase.co/auth/v1',
    aud: 'authenticated',
    exp: now + 3_600,
    iat: now,
    sub: USER_ID,
    role: 'authenticated',
    aal: 'aal1',
    session_id: SESSION_ID,
    is_anonymous: false,
  };
}

function createExecutionContext(
  options: {
    user?: VerifiedUserJwtPayload;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
  } = {},
): {
  context: ExecutionContext;
  request: OrganisationScopedRequest;
} {
  const request = {
    headers: {},
    user: options.user,
    body: options.body ?? {},
    query: options.query ?? {},
    params: options.params ?? {},
  } as unknown as OrganisationScopedRequest;

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return {
    context,
    request,
  };
}

describe('OrganisationAccessGuard', () => {
  let guard: OrganisationAccessGuard;
  let rls: {
    run: jest.Mock;
  };

  beforeEach(() => {
    rls = {
      run: jest.fn(),
    };

    guard = new OrganisationAccessGuard(
      rls as unknown as RlsTransactionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function mockMembership(
    membership:
      | {
          id: string;
        }
      | null,
  ): jest.Mock {
    const findFirst =
      jest.fn().mockResolvedValue(membership);

    const transaction = {
      organisationMembership: {
        findFirst,
      },
    };

    rls.run.mockImplementation(
      async (
        _context: unknown,
        operation: (
          client: typeof transaction,
        ) => Promise<unknown>,
      ) => operation(transaction),
    );

    return findFirst;
  }

  it('grants an active member access and attaches an immutable context', async () => {
    const findFirst = mockMembership({
      id: MEMBERSHIP_ID,
    });

    const { context, request } =
      createExecutionContext({
        user: validUser(),
        body: {
          organisationId: ORGANISATION_ID,
        },
      });

    await expect(
      guard.canActivate(context),
    ).resolves.toBe(true);

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL1',
      },
      expect.any(Function),
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userProfileId: USER_ID,
          organisationId: ORGANISATION_ID,
          status: 'ACTIVE',
          deletedAt: null,
        }),
        select: {
          id: true,
        },
      }),
    );

    expect(request.organisationAccess).toEqual({
      userId: USER_ID,
      organisationId: ORGANISATION_ID,
      membershipId: MEMBERSHIP_ID,
      sessionId: SESSION_ID,
      aal: 'AAL1',
    });

    expect(
      Object.isFrozen(request.organisationAccess),
    ).toBe(true);
  });

  it('accepts an organisation identifier from the query string', async () => {
    mockMembership({
      id: MEMBERSHIP_ID,
    });

    const { context } = createExecutionContext({
      user: validUser(),
      query: {
        organisationId: ORGANISATION_ID,
      },
    });

    await expect(
      guard.canActivate(context),
    ).resolves.toBe(true);
  });

  it('rejects a missing organisation identifier', async () => {
    const { context } = createExecutionContext({
      user: validUser(),
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(BadRequestException);

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('rejects a malformed organisation identifier', async () => {
    const { context } = createExecutionContext({
      user: validUser(),
      query: {
        organisationId: 'not-a-uuid',
      },
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(BadRequestException);

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('rejects conflicting organisation identifiers', async () => {
    const { context } = createExecutionContext({
      user: validUser(),
      body: {
        organisationId: ORGANISATION_ID,
      },
      query: {
        organisationId: OTHER_ORGANISATION_ID,
      },
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(
      'Conflicting organisation identifiers were supplied',
    );

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('rejects an unverified user context', async () => {
    const { context } = createExecutionContext({
      query: {
        organisationId: ORGANISATION_ID,
      },
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(UnauthorizedException);

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('denies access when no active membership exists', async () => {
    mockMembership(null);

    const { context } = createExecutionContext({
      user: validUser(),
      query: {
        organisationId: ORGANISATION_ID,
      },
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toThrow(ForbiddenException);
  });
});