import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationAccessContext,
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { InvitationRolesController } from './invitation-roles.controller';
import { InvitationRolesService } from './invitation-roles.service';

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

describe('InvitationRolesController', () => {
  let controller: InvitationRolesController;
  const rolesServiceMock = { findAll: jest.fn() };
  const allowGuardMock = { canActivate: jest.fn() };
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
      controllers: [InvitationRolesController],
      providers: [
        {
          provide: InvitationRolesService,
          useValue: rolesServiceMock,
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

    controller = module.get<InvitationRolesController>(
      InvitationRolesController,
    );
  });

  it('lists roles using only the verified organisation context', async () => {
    const expected = { items: [], total: 0 };
    rolesServiceMock.findAll.mockResolvedValue(expected);

    await expect(controller.findAll(ORGANISATION_ID, request)).resolves.toBe(
      expected,
    );

    expect(requireContextMock).toHaveBeenCalledWith(request);
    expect(rolesServiceMock.findAll).toHaveBeenCalledWith(CONTEXT);
  });
});
