import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { CaseManagementService } from './case-management.service';

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENQUIRY_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_ID = '44444444-4444-4444-8444-444444444444';
const MATTER_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: '77777777-7777-4777-8777-777777777777',
  sessionId: '88888888-8888-4888-8888-888888888888',
  aal: 'AAL2',
});

describe('CaseManagementService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const rls = {
    run: jest.fn(
      async (
        _context: unknown,
        operation: (value: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    ),
  };
  let service: CaseManagementService;

  beforeEach(() => {
    jest.resetAllMocks();
    rls.run.mockImplementation(
      async (
        _context: unknown,
        operation: (value: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );
    service = new CaseManagementService(
      rls as unknown as RlsTransactionService,
    );
  });

  it('rejects a client without a contact channel before opening a transaction', async () => {
    await expect(
      service.createClient(
        {
          kind: 'INDIVIDUAL',
          firstName: 'Ada',
          processingLawfulBasis: 'CONTRACT',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rls.run).not.toHaveBeenCalled();
  });

  it('rejects mixed organisation and individual identity data', async () => {
    await expect(
      service.createClient(
        {
          kind: 'ORGANISATION',
          organisationName: 'Example Limited',
          firstName: 'Ada',
          email: 'contact@example.test',
          processingLawfulBasis: 'CONTRACT',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a next-action summary and timestamp together', async () => {
    await expect(
      service.createMatter(
        {
          primaryClientId: CLIENT_ID,
          title: 'Skilled Worker application',
          serviceType: 'UK immigration',
          nextActionSummary: 'Collect identity documents',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rls.run).not.toHaveBeenCalled();
  });

  it('returns the original conversion for a repeated idempotency key', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      {
        enquiryId: ENQUIRY_ID,
        clientId: CLIENT_ID,
        matterId: MATTER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        clientNumber: 'CLI-000001',
        matterNumber: 'MAT-000001',
      },
    ]);

    await expect(
      service.convertEnquiry(
        ENQUIRY_ID,
        {
          idempotencyKey: IDEMPOTENCY_KEY,
          processingLawfulBasis: 'CONTRACT',
          matterTitle: 'Skilled Worker application',
          serviceType: 'UK immigration',
        },
        CONTEXT,
      ),
    ).resolves.toEqual({
      enquiryId: ENQUIRY_ID,
      clientId: CLIENT_ID,
      matterId: MATTER_ID,
      clientNumber: 'CLI-000001',
      matterNumber: 'MAT-000001',
      repeated: true,
    });
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for another enquiry', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      {
        enquiryId: '99999999-9999-4999-8999-999999999999',
        clientId: CLIENT_ID,
        matterId: MATTER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        clientNumber: 'CLI-000001',
        matterNumber: 'MAT-000001',
      },
    ]);

    await expect(
      service.convertEnquiry(
        ENQUIRY_ID,
        {
          idempotencyKey: IDEMPOTENCY_KEY,
          processingLawfulBasis: 'CONTRACT',
          matterTitle: 'Skilled Worker application',
          serviceType: 'UK immigration',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an invalid matter status jump before mutating evidence', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      { id: MATTER_ID, status: 'INTAKE', version: 3 },
    ]);

    await expect(
      service.changeMatterStatus(
        MATTER_ID,
        {
          toStatus: 'ACTIVE',
          reason: 'Attempted invalid jump',
          expectedVersion: 3,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('blocks client-care progression until conflict checking is complete', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([
        { id: MATTER_ID, status: 'CONFLICT_CHECK', version: 4 },
      ])
      .mockResolvedValueOnce([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          conflictStatus: 'PENDING',
          amlStatus: 'NOT_STARTED',
          clientCareStatus: 'NOT_SENT',
          riskRating: 'NOT_ASSESSED',
          version: 1,
          updatedAt: new Date(),
        },
      ]);

    await expect(
      service.changeMatterStatus(
        MATTER_ID,
        {
          toStatus: 'CLIENT_CARE',
          reason: 'Start client care',
          expectedVersion: 4,
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats archived clients as immutable', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      { id: CLIENT_ID, status: 'ARCHIVED', version: 2 },
    ]);

    await expect(
      service.updateClient(
        CLIENT_ID,
        { expectedVersion: 2 } as never,
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
