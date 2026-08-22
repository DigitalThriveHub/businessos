import type {
  OrganisationAccessContext,
  OrganisationScopedRequest,
} from '../auth/request-security-context';
import { requireOrganisationAccessContext } from '../auth/request-security-context';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

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

describe('FinanceController', () => {
  const service = {
    getDashboard: jest.fn(),
    updateSettings: jest.fn(),
    createDocument: jest.fn(),
    issueDocument: jest.fn(),
    voidDocument: jest.fn(),
    recordPayment: jest.fn(),
  };
  const request = {} as OrganisationScopedRequest;
  const contextMock = requireOrganisationAccessContext as jest.MockedFunction<
    typeof requireOrganisationAccessContext
  >;
  let controller: FinanceController;

  beforeEach(() => {
    jest.resetAllMocks();
    contextMock.mockReturnValue(CONTEXT);
    controller = new FinanceController(service as unknown as FinanceService);
  });

  it('reads finance using verified tenant context', async () => {
    await controller.getDashboard(ORGANISATION_ID, request);
    expect(service.getDashboard).toHaveBeenCalledWith(CONTEXT);
  });

  it('passes a controlled draft document to the service', async () => {
    const dto = {
      clientId: RECORD_ID,
      documentType: 'INVOICE' as const,
      currencyCode: 'GBP',
      lines: [
        {
          description: 'Professional services',
          quantityMilli: 1000,
          unitAmountMinor: 10_000,
          taxCategory: 'STANDARD' as const,
          vatRateBasisPoints: 2000,
        },
      ],
    };
    await controller.createDocument(ORGANISATION_ID, dto, request);
    expect(service.createDocument).toHaveBeenCalledWith(dto, CONTEXT);
  });

  it('uses optimistic evidence when issuing a document', async () => {
    const dto = { expectedVersion: 2 };
    await controller.issueDocument(ORGANISATION_ID, RECORD_ID, dto, request);
    expect(service.issueDocument).toHaveBeenCalledWith(RECORD_ID, dto, CONTEXT);
  });

  it('passes payment allocations without trusting the route tenant', async () => {
    const dto = {
      clientId: RECORD_ID,
      paymentType: 'RECEIPT' as const,
      method: 'BANK_TRANSFER' as const,
      currencyCode: 'GBP',
      amountMinor: 12_000,
      occurredAt: '2026-08-22T10:00:00.000Z',
      idempotencyKey: 'finance-e2e/payment-1',
      allocations: [{ documentId: RECORD_ID, amountMinor: 12_000 }],
    };
    await controller.recordPayment(ORGANISATION_ID, dto, request);
    expect(service.recordPayment).toHaveBeenCalledWith(dto, CONTEXT);
  });
});
