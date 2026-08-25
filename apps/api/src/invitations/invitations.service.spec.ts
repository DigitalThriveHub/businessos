import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  AssignmentScope,
  InvitationStatus,
  OnboardingPlanStatus,
  RoleScope,
} from '../generated/prisma/enums';
import { EmailService } from '../notifications/email.service';
import type { CreateOrganisationInvitationDto } from './dto/create-organisation-invitation.dto';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationsService } from './invitations.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const INVITATION_ID = '55555555-5555-4555-8555-555555555555';
const JOB_PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const DEPARTMENT_ID = '77777777-7777-4777-8777-777777777777';
const TEAM_ID = '88888888-8888-4888-8888-888888888888';
const MANAGER_MEMBERSHIP_ID = '99999999-9999-4999-8999-999999999999';
const AGENT_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ONBOARDING_PLAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KPI_DEFINITION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const JOB_PROFILE_KPI_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const NOW = new Date('2026-08-19T10:00:00.000Z');
const STARTS_AT = new Date('2026-08-20T09:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-22T10:00:00.000Z');
const CREATED_AT = new Date('2026-08-19T10:00:00.000Z');
const UPDATED_AT = new Date('2026-08-19T10:00:00.000Z');
const RAW_TOKEN = `boi_v1_${'A'.repeat(43)}`;
const TOKEN_HASH = 'a'.repeat(64);

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: MEMBERSHIP_ID,
  sessionId: SESSION_ID,
  aal: 'AAL2',
});

const DTO: CreateOrganisationInvitationDto = {
  email: 'case.worker@example.com',
  roleKeys: ['case_worker'],
  jobProfileId: JOB_PROFILE_ID,
  jobTitle: 'Case Worker',
  departmentId: DEPARTMENT_ID,
  teamId: TEAM_ID,
  managerOrganisationMembershipId: MANAGER_MEMBERSHIP_ID,
  agentProfileId: AGENT_PROFILE_ID,
  startsAt: STARTS_AT.toISOString(),
  isDepartmentManager: false,
  isTeamLead: false,
};

const ONBOARDING_METADATA = {
  planId: ONBOARDING_PLAN_ID,
  jobProfileId: JOB_PROFILE_ID,
  departmentId: DEPARTMENT_ID,
  teamId: TEAM_ID,
  managerOrganisationMembershipId: MANAGER_MEMBERSHIP_ID,
  agentProfileId: AGENT_PROFILE_ID,
  startsAt: STARTS_AT.toISOString(),
  isDepartmentManager: false,
  isTeamLead: false,
};

function invitationMetadata(
  deliveryStatus: 'QUEUED' | 'SENT' | 'FAILED' = 'QUEUED',
  providerMessageId: string | null = null,
) {
  return {
    schemaVersion: 2,
    roleKeys: ['case_worker'],
    jobTitle: 'Case Worker',
    onboarding: ONBOARDING_METADATA,
    delivery: {
      status: deliveryStatus,
      providerMessageId,
    },
  };
}

function invitationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    organisationId: ORGANISATION_ID,
    email: DTO.email,
    status: InvitationStatus.PENDING,
    expiresAt: EXPIRES_AT,
    acceptedAt: null,
    revokedAt: null,
    revocationReason: null,
    metadata: invitationMetadata(),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe('InvitationsService', () => {
  let service: InvitationsService;

  let transaction: {
    userProfile: {
      findFirst: jest.Mock;
    };
    role: {
      findMany: jest.Mock;
    };
    organisationMembership: {
      findFirst: jest.Mock;
    };
    invitation: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    organisation: {
      findFirst: jest.Mock;
    };
    jobProfile: {
      findFirst: jest.Mock;
    };
    department: {
      findFirst: jest.Mock;
    };
    team: {
      findFirst: jest.Mock;
    };
    agentProfile: {
      findFirst: jest.Mock;
    };
    invitationOnboardingPlan: {
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    invitationOnboardingRole: {
      createMany: jest.Mock;
    };
    invitationOnboardingKpi: {
      createMany: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };

  let rls: {
    run: jest.Mock;
  };

  let tokens: {
    issue: jest.Mock;
  };

  let emails: {
    sendOrganisationInvitation: jest.Mock;
  };

  let config: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    transaction = {
      userProfile: {
        findFirst: jest.fn().mockResolvedValue({
          displayName: 'Olivia Owner',
          firstName: 'Olivia',
          lastName: 'Owner',
          email: 'owner@example.com',
        }),
      },
      role: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: ROLE_ID,
            key: 'case_worker',
            scope: RoleScope.TEAM,
          },
        ]),
      },
      organisationMembership: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve(
              where.id === MANAGER_MEMBERSHIP_ID
                ? { id: MANAGER_MEMBERSHIP_ID }
                : null,
            ),
          ),
      },
      invitation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: INVITATION_ID,
        }),
        update: jest.fn().mockResolvedValue(invitationRecord()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      organisation: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'Example Legal Services',
        }),
      },
      jobProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: JOB_PROFILE_ID,
          name: 'Case Worker',
          departmentId: DEPARTMENT_ID,
          isManagerial: false,
          kpis: [
            {
              id: JOB_PROFILE_KPI_ID,
              kpiDefinitionId: KPI_DEFINITION_ID,
              targetValue: '12.0000',
              minimumValue: '8.0000',
              maximumValue: '20.0000',
              weightPercent: '100.00',
            },
          ],
        }),
      },
      department: {
        findFirst: jest.fn().mockResolvedValue({
          id: DEPARTMENT_ID,
        }),
      },
      team: {
        findFirst: jest.fn().mockResolvedValue({
          id: TEAM_ID,
          departmentId: DEPARTMENT_ID,
        }),
      },
      agentProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: AGENT_PROFILE_ID,
          departmentId: DEPARTMENT_ID,
        }),
      },
      invitationOnboardingPlan: {
        create: jest.fn().mockResolvedValue({
          id: ONBOARDING_PLAN_ID,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invitationOnboardingRole: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invitationOnboardingKpi: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    rls = {
      run: jest.fn(
        async (
          _context: unknown,
          operation: (client: typeof transaction) => Promise<unknown>,
        ) => operation(transaction),
      ),
    };

    tokens = {
      issue: jest.fn().mockReturnValue({
        token: RAW_TOKEN,
        tokenHash: TOKEN_HASH,
      }),
    };

    emails = {
      sendOrganisationInvitation: jest.fn().mockResolvedValue({
        provider: 'resend',
        messageId: 'resend-message-1',
      }),
    };

    config = {
      get: jest.fn((key: string) =>
        key === 'INVITATION_TTL_HOURS' ? 72 : undefined,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: RlsTransactionService,
          useValue: rls,
        },
        {
          provide: InvitationTokenService,
          useValue: tokens,
        },
        {
          provide: EmailService,
          useValue: emails,
        },
        {
          provide: ConfigService,
          useValue: config,
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('creates an immutable workforce onboarding plan, audits it and delivers the invitation', async () => {
    const result = await service.create(DTO, CONTEXT);

    expect(result).toMatchObject({
      id: INVITATION_ID,
      organisationId: ORGANISATION_ID,
      email: DTO.email,
      status: InvitationStatus.PENDING,
      roleKeys: ['case_worker'],
      jobTitle: 'Case Worker',
      deliveryStatus: 'SENT',
      onboardingPlanId: ONBOARDING_PLAN_ID,
      jobProfileId: JOB_PROFILE_ID,
      departmentId: DEPARTMENT_ID,
      teamId: TEAM_ID,
      managerOrganisationMembershipId: MANAGER_MEMBERSHIP_ID,
      agentProfileId: AGENT_PROFILE_ID,
      startsAt: STARTS_AT.toISOString(),
      isDepartmentManager: false,
      isTeamLead: false,
    });

    expect(tokens.issue).toHaveBeenCalledTimes(1);

    expect(transaction.jobProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: JOB_PROFILE_ID,
          organisationId: ORGANISATION_ID,
          isActive: true,
          deletedAt: null,
        },
      }),
    );

    expect(transaction.invitation.create).toHaveBeenCalledWith({
      data: {
        organisationId: ORGANISATION_ID,
        email: DTO.email,
        tokenHash: TOKEN_HASH,
        status: InvitationStatus.PENDING,
        invitedByUserProfileId: USER_ID,
        expiresAt: EXPIRES_AT,
      },
      select: { id: true },
    });

    expect(transaction.invitationOnboardingPlan.create).toHaveBeenCalledWith({
      data: {
        organisationId: ORGANISATION_ID,
        invitationId: INVITATION_ID,
        jobProfileId: JOB_PROFILE_ID,
        departmentId: DEPARTMENT_ID,
        teamId: TEAM_ID,
        managerOrganisationMembershipId: MANAGER_MEMBERSHIP_ID,
        agentProfileId: AGENT_PROFILE_ID,
        jobTitle: 'Case Worker',
        isDepartmentManager: false,
        isTeamLead: false,
        startsAt: STARTS_AT,
        createdByUserProfileId: USER_ID,
      },
      select: { id: true },
    });

    expect(
      transaction.invitationOnboardingRole.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          organisationId: ORGANISATION_ID,
          onboardingPlanId: ONBOARDING_PLAN_ID,
          roleId: ROLE_ID,
          scope: AssignmentScope.TEAM,
          departmentId: null,
          teamId: TEAM_ID,
        },
      ],
    });

    expect(transaction.invitationOnboardingKpi.createMany).toHaveBeenCalledWith(
      {
        data: [
          {
            organisationId: ORGANISATION_ID,
            onboardingPlanId: ONBOARDING_PLAN_ID,
            kpiDefinitionId: KPI_DEFINITION_ID,
            sourceJobProfileKpiId: JOB_PROFILE_KPI_ID,
            targetValue: '12.0000',
            minimumValue: '8.0000',
            maximumValue: '20.0000',
            weightPercent: '100.00',
          },
        ],
      },
    );

    expect(transaction.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITATION_ID },
        data: {
          metadata: invitationMetadata(),
        },
      }),
    );

    expect(emails.sendOrganisationInvitation).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
      recipientEmail: DTO.email,
      organisationName: 'Example Legal Services',
      inviterName: 'Olivia Owner',
      invitationToken: RAW_TOKEN,
      expiresAt: EXPIRES_AT,
    });

    expect(transaction.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        organisationId: ORGANISATION_ID,
        status: InvitationStatus.PENDING,
        deletedAt: null,
      },
      data: {
        metadata: invitationMetadata('SENT', 'resend-message-1'),
      },
    });

    expect(rls.run).toHaveBeenCalledTimes(2);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown or unassignable roles before creating an invitation', async () => {
    transaction.role.findMany.mockResolvedValue([]);

    await expect(service.create(DTO, CONTEXT)).rejects.toThrow(
      BadRequestException,
    );

    expect(transaction.invitation.create).not.toHaveBeenCalled();
    expect(transaction.invitationOnboardingPlan.create).not.toHaveBeenCalled();
    expect(emails.sendOrganisationInvitation).not.toHaveBeenCalled();
  });

  it('rejects an invitation for an existing organisation member', async () => {
    transaction.organisationMembership.findFirst.mockResolvedValue({
      id: MEMBERSHIP_ID,
    });

    await expect(service.create(DTO, CONTEXT)).rejects.toThrow(
      ConflictException,
    );

    expect(transaction.invitation.create).not.toHaveBeenCalled();
    expect(transaction.invitationOnboardingPlan.create).not.toHaveBeenCalled();
  });

  it('rejects a team that is outside the resolved job-profile department', async () => {
    transaction.team.findFirst.mockResolvedValue({
      id: TEAM_ID,
      departmentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });

    await expect(service.create(DTO, CONTEXT)).rejects.toThrow(
      'The selected team does not belong to the selected department.',
    );

    expect(transaction.invitation.create).not.toHaveBeenCalled();
    expect(transaction.invitationOnboardingPlan.create).not.toHaveBeenCalled();
  });

  it('rejects a management assignment when the job profile is not managerial', async () => {
    const managementDto: CreateOrganisationInvitationDto = {
      ...DTO,
      isDepartmentManager: true,
    };

    await expect(service.create(managementDto, CONTEXT)).rejects.toThrow(
      'The selected job profile is not approved for management duties.',
    );

    expect(transaction.invitation.create).not.toHaveBeenCalled();
  });

  it('rejects an AI-agent profile restricted to another department', async () => {
    transaction.agentProfile.findFirst.mockResolvedValue({
      id: AGENT_PROFILE_ID,
      departmentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });

    await expect(service.create(DTO, CONTEXT)).rejects.toThrow(
      'The selected AI-agent profile is restricted to another department.',
    );

    expect(transaction.invitation.create).not.toHaveBeenCalled();
  });

  it('records failed email delivery without storing or reusing the raw token', async () => {
    emails.sendOrganisationInvitation.mockRejectedValue(
      new ServiceUnavailableException('Delivery failed.'),
    );

    await expect(service.create(DTO, CONTEXT)).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(tokens.issue).toHaveBeenCalledTimes(1);
    expect(transaction.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        organisationId: ORGANISATION_ID,
        status: InvitationStatus.PENDING,
        deletedAt: null,
      },
      data: {
        metadata: invitationMetadata('FAILED'),
      },
    });

    expect(
      JSON.stringify({
        create: transaction.invitation.create.mock.calls,
        update: transaction.invitation.update.mock.calls,
        updateMany: transaction.invitation.updateMany.mock.calls,
      }),
    ).not.toContain(RAW_TOKEN);
  });

  it('lists invitations with pagination, onboarding context and safe expiry derivation', async () => {
    transaction.invitation.findMany.mockResolvedValue([
      invitationRecord({
        expiresAt: new Date('2026-08-19T09:59:59.000Z'),
      }),
      invitationRecord({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        metadata: invitationMetadata('SENT', 'resend-message-1'),
      }),
    ]);
    transaction.invitation.count.mockResolvedValue(2);

    const result = await service.findAll(CONTEXT, 1, 25);

    expect(result).toMatchObject({
      page: 1,
      limit: 25,
      total: 2,
      totalPages: 1,
    });
    expect(result.items[0]).toMatchObject({
      status: InvitationStatus.EXPIRED,
      onboardingPlanId: ONBOARDING_PLAN_ID,
      jobProfileId: JOB_PROFILE_ID,
      departmentId: DEPARTMENT_ID,
      teamId: TEAM_ID,
      managerOrganisationMembershipId: MANAGER_MEMBERSHIP_ID,
      agentProfileId: AGENT_PROFILE_ID,
      startsAt: STARTS_AT.toISOString(),
    });
    expect(result.items[1]).toMatchObject({
      status: InvitationStatus.PENDING,
      deliveryStatus: 'SENT',
    });

    expect(transaction.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organisationId: ORGANISATION_ID,
          deletedAt: null,
        },
        skip: 0,
        take: 25,
      }),
    );
  });

  it('safely reads legacy invitation metadata without inventing workforce access', async () => {
    transaction.invitation.findMany.mockResolvedValue([
      invitationRecord({
        metadata: {
          schemaVersion: 1,
          roleKeys: ['case_worker'],
          jobTitle: 'Case Worker',
          delivery: { status: 'SENT' },
        },
      }),
    ]);
    transaction.invitation.count.mockResolvedValue(1);

    const result = await service.findAll(CONTEXT, 1, 25);

    expect(result.items[0]).toMatchObject({
      roleKeys: ['case_worker'],
      jobTitle: 'Case Worker',
      deliveryStatus: 'SENT',
      onboardingPlanId: null,
      jobProfileId: null,
      departmentId: null,
      teamId: null,
      managerOrganisationMembershipId: null,
      agentProfileId: null,
      startsAt: null,
      isDepartmentManager: false,
      isTeamLead: false,
    });
  });

  it('rejects unsafe invitation pagination', async () => {
    await expect(service.findAll(CONTEXT, 0, 101)).rejects.toThrow(
      BadRequestException,
    );

    expect(rls.run).not.toHaveBeenCalled();
  });

  it('revokes an active pending invitation, cancels onboarding and audits it', async () => {
    const existing = invitationRecord();
    const revokedAt = NOW;
    const updated = invitationRecord({
      status: InvitationStatus.REVOKED,
      revokedAt,
      revocationReason: 'Invitation sent to the wrong address.',
      updatedAt: revokedAt,
    });

    transaction.invitation.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);

    const result = await service.revoke(
      INVITATION_ID,
      '  Invitation sent to the wrong address.  ',
      CONTEXT,
    );

    expect(result.status).toBe(InvitationStatus.REVOKED);
    expect(result.revocationReason).toBe(
      'Invitation sent to the wrong address.',
    );

    expect(transaction.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        organisationId: ORGANISATION_ID,
        status: InvitationStatus.PENDING,
        deletedAt: null,
      },
      data: {
        status: InvitationStatus.REVOKED,
        revokedByUserProfileId: USER_ID,
        revokedAt,
        revocationReason: 'Invitation sent to the wrong address.',
      },
    });

    expect(
      transaction.invitationOnboardingPlan.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        invitationId: INVITATION_ID,
        organisationId: ORGANISATION_ID,
        status: OnboardingPlanStatus.PENDING,
        deletedAt: null,
      },
      data: {
        status: OnboardingPlanStatus.CANCELLED,
        cancelledAt: revokedAt,
        cancellationReason: 'Invitation sent to the wrong address.',
      },
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('does not revoke an expired invitation or mutate its onboarding plan', async () => {
    transaction.invitation.findFirst.mockResolvedValue(
      invitationRecord({
        expiresAt: new Date('2026-08-19T09:59:59.000Z'),
      }),
    );

    await expect(
      service.revoke(INVITATION_ID, 'No longer required.', CONTEXT),
    ).rejects.toThrow(ConflictException);

    expect(transaction.invitation.updateMany).not.toHaveBeenCalled();
    expect(
      transaction.invitationOnboardingPlan.updateMany,
    ).not.toHaveBeenCalled();
  });
});
