import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationAccessContext,
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { InvitationWorkforceOptionsController } from './invitation-workforce-options.controller';
import { InvitationWorkforceOptionsService } from './invitation-workforce-options.service';

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

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: MEMBERSHIP_ID,
  sessionId: SESSION_ID,
  aal: 'AAL2',
});

describe('InvitationWorkforceOptionsController', () => {
  let controller: InvitationWorkforceOptionsController;

  const optionsServiceMock = {
    findAll: jest.fn(),
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
      controllers: [InvitationWorkforceOptionsController],
      providers: [
        {
          provide: InvitationWorkforceOptionsService,
          useValue: optionsServiceMock,
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

    controller = module.get<InvitationWorkforceOptionsController>(
      InvitationWorkforceOptionsController,
    );
  });

  it('uses only verified organisation context for workforce options', async () => {
    const expected = {
      configurationReady: false,
      assignableRoleCount: 0,
      jobProfiles: [],
      departments: [],
      teams: [],
      managers: [],
      agentProfiles: [],
    };

    optionsServiceMock.findAll.mockResolvedValue(expected);

    await expect(controller.findAll(ORGANISATION_ID, request)).resolves.toBe(
      expected,
    );

    expect(requireContextMock).toHaveBeenCalledWith(request);
    expect(optionsServiceMock.findAll).toHaveBeenCalledWith(CONTEXT);
  });

  it('never converts an untrusted route identifier into tenant context', async () => {
    const routeOrganisationId = '55555555-5555-4555-8555-555555555555';

    optionsServiceMock.findAll.mockResolvedValue({});

    await controller.findAll(routeOrganisationId, request);

    expect(optionsServiceMock.findAll).toHaveBeenCalledWith(CONTEXT);
    expect(optionsServiceMock.findAll).not.toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: routeOrganisationId,
      }),
    );
  });
});