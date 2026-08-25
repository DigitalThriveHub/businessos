import type {
  OrganisationAccessContext,
  OrganisationScopedRequest,
} from '../auth/request-security-context';
import { requireOrganisationAccessContext } from '../auth/request-security-context';
import { ComplianceAssuranceController } from './compliance-assurance.controller';
import { ComplianceAssuranceService } from './compliance-assurance.service';

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

describe('ComplianceAssuranceController', () => {
  const service = {
    getDashboard: jest.fn(),
    createDataSubjectRequest: jest.fn(),
    transitionDataSubjectRequest: jest.fn(),
    extendDataSubjectRequest: jest.fn(),
    buildDataSubjectExport: jest.fn(),
    createPrivacyIncident: jest.fn(),
    updatePrivacyIncident: jest.fn(),
    createLegalHold: jest.fn(),
    releaseLegalHold: jest.fn(),
    upsertRetentionPolicy: jest.fn(),
    createRetentionReview: jest.fn(),
    decideRetentionReview: jest.fn(),
    recordEvidence: jest.fn(),
    reviewEvidence: jest.fn(),
    decideProductionRelease: jest.fn(),
  };
  const request = {} as OrganisationScopedRequest;
  const contextMock = requireOrganisationAccessContext as jest.MockedFunction<
    typeof requireOrganisationAccessContext
  >;
  let controller: ComplianceAssuranceController;

  beforeEach(() => {
    jest.resetAllMocks();
    contextMock.mockReturnValue(CONTEXT);
    controller = new ComplianceAssuranceController(
      service as unknown as ComplianceAssuranceService,
    );
  });

  it('reads only through the organisation context verified by guards', async () => {
    await controller.dashboard(ORGANISATION_ID, request);
    expect(service.getDashboard).toHaveBeenCalledWith(CONTEXT);
    expect(service.getDashboard).not.toHaveBeenCalledWith(ORGANISATION_ID);
  });

  it('passes an optimistic data-right transition through verified context', async () => {
    const dto = {
      status: 'IN_PROGRESS' as const,
      identityStatus: 'VERIFIED' as const,
      note: 'Identity checked using the approved evidence process.',
      evidenceReference: 'evidence://identity/123',
      responseReference: null,
      expectedVersion: 2,
    };
    await controller.transitionRight(RECORD_ID, dto, request);
    expect(service.transitionDataSubjectRequest).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });

  it('passes a controlled deadline extension through verified context', async () => {
    const dto = {
      extendedDueAt: '2026-11-25T12:00:00.000Z',
      reason:
        'The request is complex and spans several independently controlled systems.',
      notificationReference: 'document://rights/extension-notice-1',
      expectedVersion: 1,
    };
    await controller.extendRight(RECORD_ID, dto, request);
    expect(service.extendDataSubjectRequest).toHaveBeenCalledWith(
      RECORD_ID,
      dto,
      CONTEXT,
    );
  });

  it('passes a release decision without trusting client tenant data', async () => {
    const dto = {
      releaseReference: 'release-2026.08.25',
      environment: 'PRODUCTION' as const,
      decision: 'BLOCKED' as const,
      rationale:
        'Mandatory external evidence is incomplete, so production remains blocked.',
      changeReference: 'CHG-1004',
    };
    await controller.decideRelease(dto, request);
    expect(service.decideProductionRelease).toHaveBeenCalledWith(dto, CONTEXT);
  });
});
