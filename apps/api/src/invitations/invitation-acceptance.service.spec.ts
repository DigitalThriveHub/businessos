import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  Test,
  type TestingModule,
} from '@nestjs/testing';
import type { JWTPayload } from 'jose';

import {
  resolveAssuranceLevel,
  verifyUserJwtPayload,
} from '../auth/verified-jwt-payload';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { InvitationTokenService } from './invitation-token.service';

jest.mock(
  '../auth/verified-jwt-payload',
  () => ({
    verifyUserJwtPayload: jest.fn(),
    resolveAssuranceLevel: jest.fn(),
  }),
);

const USER_ID =
  '11111111-1111-4111-8111-111111111111';
const ORGANISATION_ID =
  '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID =
  '33333333-3333-4333-8333-333333333333';
const INVITATION_ID =
  '44444444-4444-4444-8444-444444444444';

const RAW_TOKEN =
  `boi_v1_${'A'.repeat(43)}`;
const TOKEN_HASH = 'a'.repeat(64);

const TOKEN_USER: JWTPayload = {
  sub: USER_ID,
};

const DATABASE_RESULT = {
  invitation_id: INVITATION_ID,
  organisation_id: ORGANISATION_ID,
  organisation_name:
    'Example Legal Services',
  organisation_slug:
    'example-legal-services',
  membership_id: MEMBERSHIP_ID,
  invitation_status: 'ACCEPTED',
  role_keys: [
    'solicitor',
    'compliance_manager',
  ],
  job_title: 'Senior Solicitor',
};

describe('InvitationAcceptanceService', () => {
  let service: InvitationAcceptanceService;

  let transaction: {
    $queryRaw: jest.Mock;
  };

  let rls: {
    run: jest.Mock;
  };

  let tokens: {
    hashToken: jest.Mock;
  };

  const verifyUserMock =
    verifyUserJwtPayload as jest.MockedFunction<
      typeof verifyUserJwtPayload
    >;

  const resolveAalMock =
    resolveAssuranceLevel as jest.MockedFunction<
      typeof resolveAssuranceLevel
    >;

  beforeEach(async () => {
    jest.resetAllMocks();

    verifyUserMock.mockReturnValue(
      TOKEN_USER as ReturnType<
        typeof verifyUserJwtPayload
      >,
    );
    resolveAalMock.mockReturnValue('AAL2');

    transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          DATABASE_RESULT,
        ]),
    };

    rls = {
      run: jest.fn(
        async (
          _context: unknown,
          operation: (
            client: typeof transaction,
          ) => Promise<unknown>,
        ) => operation(transaction),
      ),
    };

    tokens = {
      hashToken: jest
        .fn()
        .mockReturnValue(TOKEN_HASH),
    };

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          InvitationAcceptanceService,
          {
            provide: RlsTransactionService,
            useValue: rls,
          },
          {
            provide: InvitationTokenService,
            useValue: tokens,
          },
        ],
      }).compile();

    service =
      module.get<InvitationAcceptanceService>(
        InvitationAcceptanceService,
      );
  });

  it('accepts through a user-scoped RLS transaction and returns minimal organisation data', async () => {
    await expect(
      service.accept(TOKEN_USER, RAW_TOKEN),
    ).resolves.toEqual({
      invitationId: INVITATION_ID,
      organisationId: ORGANISATION_ID,
      organisationName:
        'Example Legal Services',
      organisationSlug:
        'example-legal-services',
      membershipId: MEMBERSHIP_ID,
      status: 'ACCEPTED',
      roleKeys: [
        'compliance_manager',
        'solicitor',
      ],
      jobTitle: 'Senior Solicitor',
    });

    expect(verifyUserMock).toHaveBeenCalledWith(
      TOKEN_USER,
    );
    expect(resolveAalMock).toHaveBeenCalled();
    expect(tokens.hashToken).toHaveBeenCalledWith(
      RAW_TOKEN,
    );
    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        aal: 'AAL2',
      },
      expect.any(Function),
    );
    expect(
      transaction.$queryRaw,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid or expired invitation without exposing database details', async () => {
    transaction.$queryRaw.mockRejectedValue({
      code: 'P2010',
      meta: {
        code: '22023',
      },
    });

    await expect(
      service.accept(TOKEN_USER, RAW_TOKEN),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects acceptance by the wrong authenticated identity', async () => {
    transaction.$queryRaw.mockRejectedValue({
      code: 'P2010',
      meta: {
        driverAdapterError: {
          originalCode: '42501',
        },
      },
    });

    await expect(
      service.accept(TOKEN_USER, RAW_TOKEN),
    ).rejects.toThrow(ForbiddenException);
  });

  it('maps terminal or concurrent invitation state to conflict', async () => {
    transaction.$queryRaw.mockRejectedValue({
      code: 'P2010',
      meta: {
        sqlState: '55000',
      },
    });

    await expect(
      service.accept(TOKEN_USER, RAW_TOKEN),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an invalid secured-function response', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        ...DATABASE_RESULT,
        invitation_status: 'PENDING',
      },
    ]);

    await expect(
      service.accept(TOKEN_USER, RAW_TOKEN),
    ).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('fails closed on an unexpected database error', async () => {
    transaction.$queryRaw.mockRejectedValue(
      new Error('Unexpected database failure'),
    );

    await expect(
      service.accept(TOKEN_USER, RAW_TOKEN),
    ).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('does not open a database transaction when token hashing rejects the token', async () => {
    tokens.hashToken.mockImplementation(() => {
      throw new BadRequestException(
        'Invalid invitation token',
      );
    });

    await expect(
      service.accept(
        TOKEN_USER,
        'invalid-token',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(rls.run).not.toHaveBeenCalled();
  });
});