import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { JWTPayload } from 'jose';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { AuthService } from './auth.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';

const ORGANISATION_ID = '33333333-3333-4333-8333-333333333333';

const MEMBERSHIP_ID = '44444444-4444-4444-8444-444444444444';

function validPayload(aal: 'aal1' | 'aal2' = 'aal1'): JWTPayload {
  return {
    sub: USER_ID,
    email: 'owner@example.test',
    role: 'authenticated',
    aal,
    session_id: SESSION_ID,
    is_anonymous: false,
  };
}

function activeProfile() {
  return {
    id: USER_ID,
    email: 'owner@example.test',
    displayName: 'Business Owner',
    firstName: 'Business',
    lastName: 'Owner',
    status: 'ACTIVE',
    deletedAt: null,
    organisationMemberships: [
      {
        id: MEMBERSHIP_ID,
        organisationId: ORGANISATION_ID,
        jobTitle: 'Owner',
        organisation: {
          id: ORGANISATION_ID,
          name: 'Example Organisation',
          slug: 'example-organisation',
          status: 'ACTIVE',
        },
      },
    ],
  };
}

function roleAssignments() {
  return [
    {
      role: {
        key: 'organisation.owner',
        permissions: [
          {
            permission: {
              key: 'enquiries.read',
              requiresMfa: false,
            },
          },
          {
            permission: {
              key: 'enquiries.delete',
              requiresMfa: true,
            },
          },
        ],
      },
    },
  ];
}

describe('AuthService', () => {
  let service: AuthService;
  let rls: {
    run: jest.Mock;
  };

  beforeEach(async () => {
    rls = {
      run: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: RlsTransactionService,
          useValue: rls,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is created with the RLS dependency', () => {
    expect(service).toBeDefined();
  });

  it('returns onboarding when no user profile exists', async () => {
    const transaction = {
      userProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    rls.run.mockImplementation(
      async (
        _context: unknown,
        operation: (client: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );

    await expect(service.getCurrentUser(validPayload())).resolves.toEqual({
      id: USER_ID,
      email: 'owner@example.test',
      authenticated: true,
      onboardingRequired: true,
      organisations: [],
    });

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        aal: 'AAL1',
      },
      expect.any(Function),
    );
  });

  it('resolves memberships and effective permissions through tenant RLS', async () => {
    const profileTransaction = {
      userProfile: {
        findUnique: jest.fn().mockResolvedValue(activeProfile()),
      },
    };

    const roleTransaction = {
      roleAssignment: {
        findMany: jest.fn().mockResolvedValue(roleAssignments()),
      },
    };

    rls.run.mockImplementation(
      async (
        context: {
          organisationId?: string;
        },
        operation: (
          client: typeof profileTransaction | typeof roleTransaction,
        ) => Promise<unknown>,
      ) =>
        context.organisationId
          ? operation(roleTransaction)
          : operation(profileTransaction),
    );

    const result = await service.getCurrentUser(validPayload());

    expect(result).toEqual({
      id: USER_ID,
      email: 'owner@example.test',
      displayName: 'Business Owner',
      firstName: 'Business',
      lastName: 'Owner',
      status: 'ACTIVE',
      authenticated: true,
      onboardingRequired: false,
      organisations: [
        {
          organisationId: ORGANISATION_ID,
          membershipId: MEMBERSHIP_ID,
          organisationName: 'Example Organisation',
          organisationSlug: 'example-organisation',
          organisationStatus: 'ACTIVE',
          jobTitle: 'Owner',
          roles: ['organisation.owner'],
          permissions: ['enquiries.read'],
        },
      ],
    });

    expect(rls.run).toHaveBeenNthCalledWith(
      1,
      {
        userId: USER_ID,
        aal: 'AAL1',
      },
      expect.any(Function),
    );

    expect(rls.run).toHaveBeenNthCalledWith(
      2,
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL1',
      },
      expect.any(Function),
    );
  });

  it('includes MFA-protected permissions for an AAL2 session', async () => {
    const profileTransaction = {
      userProfile: {
        findUnique: jest.fn().mockResolvedValue(activeProfile()),
      },
    };

    const roleTransaction = {
      roleAssignment: {
        findMany: jest.fn().mockResolvedValue(roleAssignments()),
      },
    };

    rls.run.mockImplementation(
      async (
        context: {
          organisationId?: string;
        },
        operation: (
          client: typeof profileTransaction | typeof roleTransaction,
        ) => Promise<unknown>,
      ) =>
        context.organisationId
          ? operation(roleTransaction)
          : operation(profileTransaction),
    );

    const result = await service.getCurrentUser(validPayload('aal2'));

    expect(result.organisations[0]?.permissions).toEqual([
      'enquiries.delete',
      'enquiries.read',
    ]);
  });

  it('denies an inactive user profile', async () => {
    const transaction = {
      userProfile: {
        findUnique: jest.fn().mockResolvedValue({
          ...activeProfile(),
          status: 'SUSPENDED',
        }),
      },
    };

    rls.run.mockImplementation(
      async (
        _context: unknown,
        operation: (client: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );

    await expect(service.getCurrentUser(validPayload())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unverified JWT payload', async () => {
    await expect(
      service.getCurrentUser({
        sub: 'not-a-uuid',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(rls.run).not.toHaveBeenCalled();
  });
});
