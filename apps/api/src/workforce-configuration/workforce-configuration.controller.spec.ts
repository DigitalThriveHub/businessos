import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationAccessContext,
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import type {
  CreateAgentPolicyDto,
  CreateDepartmentDto,
  CreateJobProfileKpiDto,
} from './dto/workforce-configuration.dto';
import { WorkforceConfigurationController } from './workforce-configuration.controller';
import { WorkforceConfigurationService } from './workforce-configuration.service';

jest.mock('../auth/request-security-context', () => {
  const actual = jest.requireActual('../auth/request-security-context');

  return {
    ...actual,
    requireOrganisationAccessContext: jest.fn(),
  };
});

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: ORGANISATION_ID,
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('WorkforceConfigurationController', () => {
  let controller: WorkforceConfigurationController;

  const serviceMock = {
    getSnapshot: jest.fn(),
    createDepartment: jest.fn(),
    updateDepartment: jest.fn(),
    createTeam: jest.fn(),
    updateTeam: jest.fn(),
    createKpiDefinition: jest.fn(),
    updateKpiDefinition: jest.fn(),
    createJobProfile: jest.fn(),
    updateJobProfile: jest.fn(),
    createJobProfileDuty: jest.fn(),
    updateJobProfileDuty: jest.fn(),
    createJobProfileKpi: jest.fn(),
    updateJobProfileKpi: jest.fn(),
    createAgentProfile: jest.fn(),
    updateAgentProfile: jest.fn(),
    createAgentPolicy: jest.fn(),
    updateAgentPolicy: jest.fn(),
  };
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
      controllers: [WorkforceConfigurationController],
      providers: [
        {
          provide: WorkforceConfigurationService,
          useValue: serviceMock,
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

    controller = module.get(WorkforceConfigurationController);
  });

  it('loads the tenant snapshot using only verified access context', async () => {
    const expected = { organisationId: ORGANISATION_ID };
    serviceMock.getSnapshot.mockResolvedValue(expected);

    await expect(
      controller.getSnapshot(ORGANISATION_ID, request),
    ).resolves.toBe(expected);

    expect(requireContextMock).toHaveBeenCalledWith(request);
    expect(serviceMock.getSnapshot).toHaveBeenCalledWith(CONTEXT);
  });

  it('creates a department through verified tenant context', async () => {
    const dto: CreateDepartmentDto = {
      name: 'Client Services',
      code: 'CLIENT-SERVICES',
    };
    serviceMock.createDepartment.mockResolvedValue({ id: 'created' });

    await controller.createDepartment(ORGANISATION_ID, dto, request);

    expect(serviceMock.createDepartment).toHaveBeenCalledWith(dto, CONTEXT);
  });

  it('routes job-profile KPI changes without trusting route context', async () => {
    const jobProfileId = '55555555-5555-4555-8555-555555555555';
    const dto: CreateJobProfileKpiDto = {
      kpiDefinitionId: '66666666-6666-4666-8666-666666666666',
      weightPercent: 25,
    };
    serviceMock.createJobProfileKpi.mockResolvedValue({ id: 'created' });

    await controller.createJobProfileKpi(
      '77777777-7777-4777-8777-777777777777',
      jobProfileId,
      dto,
      request,
    );

    expect(serviceMock.createJobProfileKpi).toHaveBeenCalledWith(
      jobProfileId,
      dto,
      CONTEXT,
    );
  });

  it('routes AI policy creation through verified tenant context', async () => {
    const agentProfileId = '88888888-8888-4888-8888-888888888888';
    const dto = {
      toolKey: 'crm.read',
      requiredPermissionKey: 'clients.read',
      authorityLevel: 'READ',
      maximumDataScope: 'ASSIGNED',
      requiresApproval: false,
      requiresMfa: false,
      maxActionsPerRun: 25,
    } as CreateAgentPolicyDto;
    serviceMock.createAgentPolicy.mockResolvedValue({ id: 'created' });

    await controller.createAgentPolicy(
      ORGANISATION_ID,
      agentProfileId,
      dto,
      request,
    );

    expect(serviceMock.createAgentPolicy).toHaveBeenCalledWith(
      agentProfileId,
      dto,
      CONTEXT,
    );
  });

  it('never converts an untrusted organisation route value into context', async () => {
    serviceMock.getSnapshot.mockResolvedValue({});

    await controller.getSnapshot(
      '99999999-9999-4999-8999-999999999999',
      request,
    );

    expect(serviceMock.getSnapshot).toHaveBeenCalledWith(CONTEXT);
    expect(serviceMock.getSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: '99999999-9999-4999-8999-999999999999',
      }),
    );
  });
});