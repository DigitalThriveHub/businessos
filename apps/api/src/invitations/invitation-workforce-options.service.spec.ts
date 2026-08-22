import { Test, type TestingModule } from '@nestjs/testing';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { AgentAuthorityLevel, RoleScope } from '../generated/prisma/enums';
import { InvitationWorkforceOptionsService } from './invitation-workforce-options.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_PROFILE_ID = '55555555-5555-4555-8555-555555555555';
const DEPARTMENT_ID = '66666666-6666-4666-8666-666666666666';
const TEAM_ID = '77777777-7777-4777-8777-777777777777';
const AGENT_PROFILE_ID = '88888888-8888-4888-8888-888888888888';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: MEMBERSHIP_ID,
  sessionId: SESSION_ID,
  aal: 'AAL2',
});

describe('InvitationWorkforceOptionsService', () => {
  let service: InvitationWorkforceOptionsService;

  let transaction: {
    jobProfile: { findMany: jest.Mock };
    department: { findMany: jest.Mock };
    team: { findMany: jest.Mock };
    organisationMembership: { findMany: jest.Mock };
    agentProfile: { findMany: jest.Mock };
    role: { count: jest.Mock };
  };

  let rls: { run: jest.Mock };

  beforeEach(async () => {
    transaction = {
      jobProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: JOB_PROFILE_ID,
            key: 'case_worker',
            name: 'Case Worker',
            description: 'Manages allocated immigration matters.',
            departmentId: DEPARTMENT_ID,
            isManagerial: false,
            duties: [{ id: 'duty-1' }, { id: 'duty-2' }],
            kpis: [{ id: 'kpi-1' }],
          },
        ]),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: DEPARTMENT_ID,
            name: 'Legal Operations',
            code: 'LEGAL',
          },
        ]),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: TEAM_ID,
            departmentId: DEPARTMENT_ID,
            name: 'Skilled Worker Team',
            code: 'SW',
          },
        ]),
      },
      organisationMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: MEMBERSHIP_ID,
            jobTitle: 'Director',
            userProfile: {
              displayName: null,
              firstName: 'Olivia',
              lastName: 'Owner',
              email: 'owner@example.com',
            },
          },
        ]),
      },
      agentProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: AGENT_PROFILE_ID,
            key: 'case_worker_copilot',
            name: 'Case Worker Copilot',
            description: 'Drafts and proposes case-work actions.',
            departmentId: DEPARTMENT_ID,
            authorityCeiling: AgentAuthorityLevel.PROPOSE,
            requiresHumanReview: true,
          },
        ]),
      },
      role: {
        count: jest.fn().mockResolvedValue(3),
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
        InvitationWorkforceOptionsService,
        {
          provide: RlsTransactionService,
          useValue: rls,
        },
      ],
    }).compile();

    service = module.get<InvitationWorkforceOptionsService>(
      InvitationWorkforceOptionsService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns only verified tenant workforce options with safe display data', async () => {
    const result = await service.findAll(CONTEXT);

    expect(result).toEqual({
      configurationReady: true,
      assignableRoleCount: 3,
      jobProfiles: [
        {
          id: JOB_PROFILE_ID,
          key: 'case_worker',
          name: 'Case Worker',
          description: 'Manages allocated immigration matters.',
          departmentId: DEPARTMENT_ID,
          isManagerial: false,
          activeDutyCount: 2,
          activeKpiCount: 1,
        },
      ],
      departments: [
        {
          id: DEPARTMENT_ID,
          name: 'Legal Operations',
          code: 'LEGAL',
        },
      ],
      teams: [
        {
          id: TEAM_ID,
          departmentId: DEPARTMENT_ID,
          name: 'Skilled Worker Team',
          code: 'SW',
        },
      ],
      managers: [
        {
          organisationMembershipId: MEMBERSHIP_ID,
          displayName: 'Olivia Owner',
          email: 'owner@example.com',
          jobTitle: 'Director',
        },
      ],
      agentProfiles: [
        {
          id: AGENT_PROFILE_ID,
          key: 'case_worker_copilot',
          name: 'Case Worker Copilot',
          description: 'Drafts and proposes case-work actions.',
          departmentId: DEPARTMENT_ID,
          authorityCeiling: 'PROPOSE',
          requiresHumanReview: true,
        },
      ],
    });

    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organisationId: ORGANISATION_ID,
        aal: 'AAL2',
      },
      expect.any(Function),
    );

    expect(transaction.jobProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organisationId: ORGANISATION_ID,
          isActive: true,
          deletedAt: null,
        },
      }),
    );

    expect(transaction.role.count).toHaveBeenCalledWith({
      where: {
        organisationId: ORGANISATION_ID,
        scope: {
          in: [RoleScope.ORGANISATION, RoleScope.DEPARTMENT, RoleScope.TEAM],
        },
        isAssignable: true,
        deletedAt: null,
        key: { not: 'organisation_owner' },
      },
    });
  });

  it('reports configuration as unavailable instead of inventing defaults', async () => {
    transaction.jobProfile.findMany.mockResolvedValue([]);
    transaction.role.count.mockResolvedValue(0);

    const result = await service.findAll(CONTEXT);

    expect(result.configurationReady).toBe(false);
    expect(result.jobProfiles).toEqual([]);
    expect(result.assignableRoleCount).toBe(0);
  });
});