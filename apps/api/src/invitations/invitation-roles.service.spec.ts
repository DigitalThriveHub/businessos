import { Test, type TestingModule } from '@nestjs/testing';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { RoleScope } from '../generated/prisma/enums';
import { InvitationRolesService } from './invitation-roles.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: MEMBERSHIP_ID,
  sessionId: SESSION_ID,
  aal: 'AAL2',
});

describe('InvitationRolesService', () => {
  let service: InvitationRolesService;
  let transaction: { role: { findMany: jest.Mock } };
  let rls: { run: jest.Mock };

  beforeEach(async () => {
    transaction = {
      role: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'case_worker',
            name: 'Case Worker',
            description: 'Case-work access.',
            scope: RoleScope.TEAM,
            isSystem: true,
          },
        ]),
      },
    };

    rls = {
      run: jest.fn(
        async (
          _context: unknown,
          operation: (client: typeof transaction) => Promise<unknown>,
        ) => operation(transaction),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationRolesService,
        {
          provide: RlsTransactionService,
          useValue: rls,
        },
      ],
    }).compile();

    service = module.get<InvitationRolesService>(InvitationRolesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns assignable organisation, department and team roles through tenant RLS', async () => {
    const result = await service.findAll(CONTEXT);

    expect(result).toEqual({
      items: [
        {
          key: 'case_worker',
          name: 'Case Worker',
          description: 'Case-work access.',
          scope: RoleScope.TEAM,
          isSystem: true,
        },
      ],
      total: 1,
    });

    expect(transaction.role.findMany).toHaveBeenCalledWith({
      where: {
        organisationId: ORGANISATION_ID,
        scope: {
          in: [RoleScope.ORGANISATION, RoleScope.DEPARTMENT, RoleScope.TEAM],
        },
        isAssignable: true,
        deletedAt: null,
        key: { not: 'organisation_owner' },
      },
      select: {
        key: true,
        name: true,
        description: true,
        scope: true,
        isSystem: true,
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }, { key: 'asc' }],
    });

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL2',
      },
      expect.any(Function),
    );
  });
});
