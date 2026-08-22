import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationAccessContext,
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { CaseManagementController } from './case-management.controller';
import { CaseManagementService } from './case-management.service';

jest.mock('../auth/request-security-context', () => {
  const actual = jest.requireActual('../auth/request-security-context');
  return { ...actual, requireOrganisationAccessContext: jest.fn() };
});

const ROUTE_ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: ROUTE_ORGANISATION_ID,
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('CaseManagementController', () => {
  const service = {
    getOptions: jest.fn(),
    listClients: jest.fn(),
    getClient: jest.fn(),
    createClient: jest.fn(),
    updateClient: jest.fn(),
    archiveClient: jest.fn(),
    listMatters: jest.fn(),
    getMatter: jest.fn(),
    createMatter: jest.fn(),
    updateMatter: jest.fn(),
    changeMatterStatus: jest.fn(),
    updateMatterCompliance: jest.fn(),
    addMatterParty: jest.fn(),
    removeMatterParty: jest.fn(),
    convertEnquiry: jest.fn(),
  };
  const guard = { canActivate: jest.fn(() => true) };
  const request = {} as OrganisationScopedRequest;
  const requireContextMock =
    requireOrganisationAccessContext as jest.MockedFunction<
      typeof requireOrganisationAccessContext
    >;
  let controller: CaseManagementController;

  beforeEach(async () => {
    jest.resetAllMocks();
    guard.canActivate.mockReturnValue(true);
    requireContextMock.mockReturnValue(CONTEXT);

    const builder = Test.createTestingModule({
      controllers: [CaseManagementController],
      providers: [{ provide: CaseManagementService, useValue: service }],
    });
    builder
      .overrideGuard(JwtAuthGuard)
      .useValue(guard)
      .overrideGuard(OrganisationAccessGuard)
      .useValue(guard)
      .overrideGuard(PermissionGuard)
      .useValue(guard);
    const module: TestingModule = await builder.compile();
    controller = module.get(CaseManagementController);
  });

  it('uses only verified tenant context when listing clients', async () => {
    const query = { page: 1, limit: 20 };
    service.listClients.mockResolvedValue({ items: [] });

    await controller.listClients(ROUTE_ORGANISATION_ID, query, request);

    expect(service.listClients).toHaveBeenCalledWith(query, CONTEXT);
    expect(service.listClients).not.toHaveBeenCalledWith(
      expect.anything(),
      ROUTE_ORGANISATION_ID,
    );
  });

  it('passes the immutable conversion request through verified context', async () => {
    const dto = {
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      processingLawfulBasis: 'CONTRACT' as const,
      matterTitle: 'Skilled Worker application',
      serviceType: 'UK immigration',
    };
    const enquiryId = '66666666-6666-4666-8666-666666666666';

    await controller.convertEnquiry(
      ROUTE_ORGANISATION_ID,
      enquiryId,
      dto,
      request,
    );

    expect(service.convertEnquiry).toHaveBeenCalledWith(
      enquiryId,
      dto,
      CONTEXT,
    );
  });

  it('passes party removal reason without trusting the route tenant', async () => {
    const matterId = '77777777-7777-4777-8777-777777777777';
    const partyId = '88888888-8888-4888-8888-888888888888';
    const dto = { reason: 'Duplicate party recorded in error.' };

    await controller.removeMatterParty(
      ROUTE_ORGANISATION_ID,
      matterId,
      partyId,
      dto,
      request,
    );

    expect(service.removeMatterParty).toHaveBeenCalledWith(
      matterId,
      partyId,
      dto,
      CONTEXT,
    );
  });
});
