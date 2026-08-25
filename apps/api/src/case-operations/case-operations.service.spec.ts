import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { CaseOperationsService } from './case-operations.service';

const ORGANISATION_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const MATTER_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_ID = '66666666-6666-4666-8666-666666666666';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: USER_ID,
  organisationId: ORGANISATION_ID,
  membershipId: '77777777-7777-4777-8777-777777777777',
  sessionId: '88888888-8888-4888-8888-888888888888',
  aal: 'AAL2',
});

const taskRow = {
  id: TASK_ID,
  title: 'Review client documents',
  description: null,
  status: 'OPEN',
  priority: 'HIGH',
  assignedToUserId: USER_ID,
  assignedToName: 'Ada Worker',
  dueAt: new Date('2026-09-01T12:00:00.000Z'),
  reminderAt: new Date('2026-08-31T12:00:00.000Z'),
  blockedReason: null,
  completionNote: null,
  completedAt: null,
  cancellationReason: null,
  version: 1,
  createdAt: new Date('2026-08-20T12:00:00.000Z'),
  updatedAt: new Date('2026-08-20T12:00:00.000Z'),
};

describe('CaseOperationsService', () => {
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
  let service: CaseOperationsService;

  beforeEach(() => {
    jest.resetAllMocks();
    transaction.$executeRaw.mockResolvedValue(1);
    rls.run.mockImplementation(
      async (
        _context: unknown,
        operation: (value: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    );
    service = new CaseOperationsService(
      rls as unknown as RlsTransactionService,
    );
  });

  it('rejects a reminder after its due time before opening a transaction', async () => {
    await expect(
      service.createTask(
        MATTER_ID,
        {
          title: 'Invalid reminder',
          dueAt: '2026-09-01T12:00:00.000Z',
          reminderAt: '2026-09-02T12:00:00.000Z',
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rls.run).not.toHaveBeenCalled();
  });

  it('creates a task with timeline and audit evidence', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: TASK_ID }])
      .mockResolvedValueOnce([taskRow]);

    await expect(
      service.createTask(
        MATTER_ID,
        {
          title: 'Review client documents',
          priority: 'HIGH',
          assignedToUserId: USER_ID,
          dueAt: '2026-09-01T12:00:00.000Z',
          reminderAt: '2026-08-31T12:00:00.000Z',
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({ id: TASK_ID, status: 'OPEN', version: 1 });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('does not reopen a completed task', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      { id: TASK_ID, status: 'COMPLETED', version: 4 },
    ]);

    await expect(
      service.changeTaskStatus(
        MATTER_ID,
        TASK_ID,
        { version: 4, status: 'OPEN' },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects executable document content before creating metadata', async () => {
    await expect(
      service.registerDocumentUpload(
        MATTER_ID,
        {
          title: 'Unsafe upload',
          category: 'GENERAL',
          securityClassification: 'CONFIDENTIAL',
          originalFileName: 'payload.exe',
          contentType: 'application/x-msdownload',
          sizeBytes: 1024,
          sha256Hex: 'a'.repeat(64),
        },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rls.run).not.toHaveBeenCalled();
  });

  it('registers an immutable private upload identity before binary upload', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      {
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        storageBucket: 'businessos-documents',
        storagePath: `${ORGANISATION_ID}/${MATTER_ID}/${DOCUMENT_ID}/${VERSION_ID}/object`,
        expectedContentType: 'application/pdf',
        expectedSizeBytes: 2048,
        status: 'PENDING_UPLOAD',
      },
    ]);

    await expect(
      service.registerDocumentUpload(
        MATTER_ID,
        {
          title: 'Passport copy',
          category: 'IDENTITY',
          securityClassification: 'RESTRICTED',
          originalFileName: 'passport.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          sha256Hex: 'b'.repeat(64),
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      status: 'PENDING_UPLOAD',
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('checks the route matter before finalising a stored object', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ value: false }]);

    await expect(
      service.finaliseDocumentUpload(
        MATTER_ID,
        DOCUMENT_ID,
        VERSION_ID,
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('moves a verified upload into fail-closed pending scan state', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ value: true }])
      .mockResolvedValueOnce([
        {
          documentId: DOCUMENT_ID,
          versionId: VERSION_ID,
          documentStatus: 'PENDING_SCAN',
          scanStatus: 'PENDING',
        },
      ]);

    await expect(
      service.finaliseDocumentUpload(
        MATTER_ID,
        DOCUMENT_ID,
        VERSION_ID,
        CONTEXT,
      ),
    ).resolves.toEqual({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      documentStatus: 'PENDING_SCAN',
      scanStatus: 'PENDING',
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
