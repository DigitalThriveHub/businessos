import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationAccessContext,
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import type { CreateOrganisationInvitationDto } from './dto/create-organisation-invitation.dto';
import type { InvitationQueryDto } from './dto/invitation-query.dto';
import type { RevokeOrganisationInvitationDto } from './dto/revoke-organisation-invitation.dto';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

jest.mock('../auth/request-security-context', () => {
  const actual = jest.requireActual('../auth/request-security-context');

  return {
    ...actual,
    requireOrganisationAccessContext: jest.fn(),
  };
});

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

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: MEMBERSHIP_ID,
  sessionId: SESSION_ID,
  aal: 'AAL2',
});

const CREATE_DTO: CreateOrganisationInvitationDto = {
  email: 'case.worker@example.com',
  roleKeys: ['case_worker'],
  jobProfileId: JOB_PROFILE_ID,
  jobTitle: 'Case Worker',
  departmentId: DEPARTMENT_ID,
  teamId: TEAM_ID,
  managerOrganisationMembershipId: MANAGER_MEMBERSHIP_ID,
  agentProfileId: AGENT_PROFILE_ID,
  startsAt: '2026-08-20T09:00:00.000Z',
  isDepartmentManager: false,
  isTeamLead: false,
};

describe('InvitationsController', () => {
  let controller: InvitationsController;

  const invitationsServiceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    revoke: jest.fn(),
  };

  const allowGuardMock = {
    canActivate: jest.fn(),
  };

  const request = {} as OrganisationScopedRequest;

  const requireContextMock =
    requireOrganisationAccessContext as jest.MockedFunction<
      typeof requireOrganisationAccessContext
    >;

  beforeEach(async () => {
    jest.resetAllMocks();

    allowGuardMock.canActivate.mockReturnValue(true);
    requireContextMock.mockReturnValue(CONTEXT);

    const moduleBuilder = Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [
        {
          provide: InvitationsService,
          useValue: invitationsServiceMock,
        },
      ],
    });

    const module: TestingModule = await moduleBuilder
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuardMock)
      .overrideGuard(OrganisationAccessGuard)
      .useValue(allowGuardMock)
      .overrideGuard(PermissionGuard)
      .useValue(allowGuardMock)
      .compile();

    controller = module.get<InvitationsController>(InvitationsController);
  });

  it('is defined with its service dependency', () => {
    expect(controller).toBeDefined();
  });

  it('creates the complete workforce invitation using only verified tenant context', async () => {
    const expected = {
      id: INVITATION_ID,
      organisationId: ORGANISATION_ID,
      onboardingPlanId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };

    invitationsServiceMock.create.mockResolvedValue(expected);

    await expect(
      controller.create(ORGANISATION_ID, CREATE_DTO, request),
    ).resolves.toBe(expected);

    expect(requireContextMock).toHaveBeenCalledTimes(1);
    expect(requireContextMock).toHaveBeenCalledWith(request);
    expect(invitationsServiceMock.create).toHaveBeenCalledTimes(1);
    expect(invitationsServiceMock.create).toHaveBeenCalledWith(
      CREATE_DTO,
      CONTEXT,
    );
  });

  it('does not trust the route organisation identifier as service security context', async () => {
    const differentRouteOrganisationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    invitationsServiceMock.create.mockResolvedValue({
      id: INVITATION_ID,
    });

    await controller.create(differentRouteOrganisationId, CREATE_DTO, request);

    expect(invitationsServiceMock.create).toHaveBeenCalledWith(
      CREATE_DTO,
      CONTEXT,
    );
    expect(invitationsServiceMock.create).not.toHaveBeenCalledWith(
      CREATE_DTO,
      expect.objectContaining({
        organisationId: differentRouteOrganisationId,
      }),
    );
  });

  it('lists invitations with validated pagination and verified tenant context', async () => {
    const query = {
      page: 2,
      limit: 25,
    } as InvitationQueryDto;

    const expected = {
      items: [],
      page: 2,
      limit: 25,
      total: 0,
      totalPages: 0,
    };

    invitationsServiceMock.findAll.mockResolvedValue(expected);

    await expect(
      controller.findAll(ORGANISATION_ID, query, request),
    ).resolves.toBe(expected);

    expect(requireContextMock).toHaveBeenCalledWith(request);
    expect(invitationsServiceMock.findAll).toHaveBeenCalledWith(CONTEXT, 2, 25);
  });

  it('passes omitted pagination to the service defaults without inventing values', async () => {
    const query = {} as InvitationQueryDto;

    invitationsServiceMock.findAll.mockResolvedValue({
      items: [],
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
    });

    await controller.findAll(ORGANISATION_ID, query, request);

    expect(invitationsServiceMock.findAll).toHaveBeenCalledWith(
      CONTEXT,
      undefined,
      undefined,
    );
  });

  it('revokes only the requested invitation with the verified tenant context', async () => {
    const dto = {
      reason: 'Invitation no longer required.',
    } as RevokeOrganisationInvitationDto;

    const expected = {
      id: INVITATION_ID,
      status: 'REVOKED',
    };

    invitationsServiceMock.revoke.mockResolvedValue(expected);

    await expect(
      controller.revoke(ORGANISATION_ID, INVITATION_ID, dto, request),
    ).resolves.toBe(expected);

    expect(requireContextMock).toHaveBeenCalledWith(request);
    expect(invitationsServiceMock.revoke).toHaveBeenCalledTimes(1);
    expect(invitationsServiceMock.revoke).toHaveBeenCalledWith(
      INVITATION_ID,
      dto.reason,
      CONTEXT,
    );
  });
});
