import type {
  OrganisationAccessContext,
  OrganisationScopedRequest,
} from '../auth/request-security-context';
import { requireOrganisationAccessContext } from '../auth/request-security-context';
import { CaseOperationsController } from './case-operations.controller';
import { CaseOperationsService } from './case-operations.service';

jest.mock('../auth/request-security-context', () => {
  const actual = jest.requireActual('../auth/request-security-context');
  return { ...actual, requireOrganisationAccessContext: jest.fn() };
});

const ROUTE_ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const MATTER_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: ROUTE_ORGANISATION_ID,
  membershipId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  aal: 'AAL2',
});

describe('CaseOperationsController', () => {
  const service = {
    getOperations: jest.fn(),
    createTask: jest.fn(),
    updateTask: jest.fn(),
    changeTaskStatus: jest.fn(),
    createDeadline: jest.fn(),
    updateDeadline: jest.fn(),
    changeDeadlineStatus: jest.fn(),
    createDocumentRequest: jest.fn(),
    sendDocumentRequest: jest.fn(),
    manageDocumentRequest: jest.fn(),
    registerDocumentUpload: jest.fn(),
    registerDocumentVersion: jest.fn(),
    finaliseDocumentUpload: jest.fn(),
    updateDocumentMetadata: jest.fn(),
    archiveDocument: jest.fn(),
  };
  const request = {} as OrganisationScopedRequest;
  const contextMock =
    requireOrganisationAccessContext as jest.MockedFunction<
      typeof requireOrganisationAccessContext
    >;
  let controller: CaseOperationsController;

  beforeEach(() => {
    jest.resetAllMocks();
    contextMock.mockReturnValue(CONTEXT);
    controller = new CaseOperationsController(
      service as unknown as CaseOperationsService,
    );
  });

  it('reads matter operations using verified tenant context only', async () => {
    await controller.getOperations(ROUTE_ORGANISATION_ID, MATTER_ID, request);
    expect(service.getOperations).toHaveBeenCalledWith(MATTER_ID, CONTEXT);
  });

  it('passes controlled task completion evidence to the service', async () => {
    const taskId = '66666666-6666-4666-8666-666666666666';
    const dto = { version: 2, status: 'COMPLETED' as const, completionNote: 'Checked.' };
    await controller.changeTaskStatus(
      ROUTE_ORGANISATION_ID,
      MATTER_ID,
      taskId,
      dto,
      request,
    );
    expect(service.changeTaskStatus).toHaveBeenCalledWith(
      MATTER_ID,
      taskId,
      dto,
      CONTEXT,
    );
  });

  it('does not trust route organisation data when registering uploads', async () => {
    const dto = {
      title: 'Passport',
      category: 'IDENTITY' as const,
      securityClassification: 'RESTRICTED' as const,
      originalFileName: 'passport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256Hex: 'a'.repeat(64),
    };
    await controller.registerDocumentUpload(
      ROUTE_ORGANISATION_ID,
      MATTER_ID,
      dto,
      request,
    );
    expect(service.registerDocumentUpload).toHaveBeenCalledWith(
      MATTER_ID,
      dto,
      CONTEXT,
    );
  });

});