import type {
  OrganisationAccessContext,
  OrganisationScopedRequest,
} from '../auth/request-security-context';
import { requireOrganisationAccessContext } from '../auth/request-security-context';
import { MyAiController } from './my-ai.controller';
import { MyAiService } from './my-ai.service';

jest.mock('../auth/request-security-context', () => {
  const actual = jest.requireActual('../auth/request-security-context');
  return { ...actual, requireOrganisationAccessContext: jest.fn() };
});

const ROUTE_ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: ROUTE_ORGANISATION_ID,
  membershipId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  aal: 'AAL2',
});

describe('MyAiController', () => {
  const service = {
    getWorkspace: jest.fn(),
    runCommand: jest.fn(),
  };
  const request = {} as OrganisationScopedRequest;
  const contextMock = requireOrganisationAccessContext as jest.MockedFunction<
    typeof requireOrganisationAccessContext
  >;
  let controller: MyAiController;

  beforeEach(() => {
    jest.resetAllMocks();
    contextMock.mockReturnValue(CONTEXT);
    controller = new MyAiController(service as unknown as MyAiService);
  });

  it('reads only the employee conversation in verified tenant context', async () => {
    await controller.getWorkspace(
      ROUTE_ORGANISATION_ID,
      { conversationId: CONVERSATION_ID },
      request,
    );

    expect(service.getWorkspace).toHaveBeenCalledWith(CONVERSATION_ID, CONTEXT);
    expect(service.getWorkspace).not.toHaveBeenCalledWith(
      expect.anything(),
      ROUTE_ORGANISATION_ID,
    );
  });

  it('does not trust a route tenant when starting a governed command', async () => {
    const dto = {
      clientRequestId: '66666666-6666-4666-8666-666666666666',
      conversationId: CONVERSATION_ID,
      mode: 'CHAT' as const,
      message: 'Prioritise my workload.',
    };

    await controller.runCommand(ROUTE_ORGANISATION_ID, dto, request);

    expect(service.runCommand).toHaveBeenCalledWith(dto, CONTEXT);
  });
});
