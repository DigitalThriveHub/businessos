import type {
  OrganisationAccessContext,
  OrganisationScopedRequest,
} from '../auth/request-security-context';
import { requireOrganisationAccessContext } from '../auth/request-security-context';
import { AutomationControlController } from './automation-control.controller';
import { AutomationControlService } from './automation-control.service';

jest.mock('../auth/request-security-context', () => {
  const actual = jest.requireActual('../auth/request-security-context');
  return { ...actual, requireOrganisationAccessContext: jest.fn() };
});

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: ORGANISATION_ID,
  membershipId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  aal: 'AAL2',
});

describe('AutomationControlController', () => {
  const service = {
    getControlTower: jest.fn(),
    completeWorkItem: jest.fn(),
    createApproval: jest.fn(),
    decideApproval: jest.fn(),
    updateSlaPolicy: jest.fn(),
  };
  const request = {} as OrganisationScopedRequest;
  const contextMock = requireOrganisationAccessContext as jest.MockedFunction<
    typeof requireOrganisationAccessContext
  >;
  let controller: AutomationControlController;

  beforeEach(() => {
    jest.resetAllMocks();
    contextMock.mockReturnValue(CONTEXT);
    controller = new AutomationControlController(
      service as unknown as AutomationControlService,
    );
  });

  it('reads the control tower using verified tenant context', async () => {
    await controller.getControlTower(ORGANISATION_ID, request);
    expect(service.getControlTower).toHaveBeenCalledWith(CONTEXT);
  });

  it('passes optimistic work-item evidence to the service', async () => {
    const dto = { expectedVersion: 2, completionNote: 'Contact recorded.' };
    await controller.completeWorkItem(ORGANISATION_ID, RECORD_ID, dto, request);
    expect(service.completeWorkItem).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });

  it('does not trust the route organisation when requesting approval', async () => {
    const dto = {
      subjectType: 'MATTER' as const,
      subjectId: RECORD_ID,
      title: 'Approve submission',
      summary: 'Approve the controlled submission.',
      actionKey: 'matter.submit',
      riskLevel: 'HIGH' as const,
      approverUserId: '66666666-6666-4666-8666-666666666666',
      expiresAt: '2026-08-22T12:00:00.000Z',
    };
    await controller.createApproval(ORGANISATION_ID, dto, request);
    expect(service.createApproval).toHaveBeenCalledWith(dto, CONTEXT);
  });

  it('passes approval decision evidence to the service', async () => {
    const dto = {
      expectedVersion: 1,
      decision: 'APPROVED' as const,
      reason: 'Evidence checked.',
    };
    await controller.decideApproval(ORGANISATION_ID, RECORD_ID, dto, request);
    expect(service.decideApproval).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });

  it('passes controlled SLA changes to the service', async () => {
    const dto = { expectedVersion: 1, targetSeconds: 7200 };
    await controller.updateSlaPolicy(ORGANISATION_ID, RECORD_ID, dto, request);
    expect(service.updateSlaPolicy).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });
});
