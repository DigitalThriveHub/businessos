import type {
  OrganisationAccessContext,
  OrganisationScopedRequest,
} from '../auth/request-security-context';
import { requireOrganisationAccessContext } from '../auth/request-security-context';
import { OperationalIntelligenceController } from './operational-intelligence.controller';
import { OperationalIntelligenceService } from './operational-intelligence.service';

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

describe('OperationalIntelligenceController', () => {
  const service = {
    getDashboard: jest.fn(),
    reviewDocument: jest.fn(),
    updateBenchmark: jest.fn(),
  };
  const request = {} as OrganisationScopedRequest;
  const contextMock = requireOrganisationAccessContext as jest.MockedFunction<
    typeof requireOrganisationAccessContext
  >;
  let controller: OperationalIntelligenceController;

  beforeEach(() => {
    jest.resetAllMocks();
    contextMock.mockReturnValue(CONTEXT);
    controller = new OperationalIntelligenceController(
      service as unknown as OperationalIntelligenceService,
    );
  });

  it('reads the dashboard only through verified tenant context', async () => {
    await controller.getDashboard(ORGANISATION_ID, request);
    expect(service.getDashboard).toHaveBeenCalledWith(CONTEXT);
    expect(service.getDashboard).not.toHaveBeenCalledWith(ORGANISATION_ID);
  });

  it('passes an optimistic human document decision without trusting route tenant data', async () => {
    const dto = {
      decision: 'CORRECTED' as const,
      confirmedCategory: 'IDENTITY' as const,
      confirmedExpiryDate: '2030-05-12',
      corrections: { category: 'Human confirmed.' },
      notes: 'Checked against the visible original document.',
      createFollowUpTask: false,
      expectedVersion: 4,
    };
    await controller.reviewDocument(ORGANISATION_ID, RECORD_ID, dto, request);
    expect(service.reviewDocument).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });

  it('passes versioned benchmark assumptions through verified AAL2 context', async () => {
    const dto = {
      estimatedManualMinutes: 20,
      estimatedAutomatedMinutes: 4,
      hourlyCostMinor: 3500,
      isActive: true,
      expectedVersion: 2,
    };
    await controller.updateBenchmark(ORGANISATION_ID, RECORD_ID, dto, request);
    expect(service.updateBenchmark).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });
});
