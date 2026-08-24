import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import type { PrismaService } from '../database/prisma.service';
import type { RlsTransactionService } from '../database/rls-transaction.service';
import type { IntegrationSigningService } from './integration-signing.service';
import { IntegrationsService } from './integrations.service';

const CONTEXT: Readonly<OrganisationAccessContext> = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  organisationId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
  aal: 'AAL2',
});

describe('IntegrationsService', () => {
  const transaction = { $queryRaw: jest.fn() };
  const database = { $queryRaw: jest.fn() };
  const rls = {
    run: jest.fn(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    ),
  };
  const signing = {
    deriveConnectionSecret: jest.fn().mockReturnValue('derived-secret'),
    verifyIntakeSignature: jest.fn(),
  };
  let service: IntegrationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    rls.run.mockImplementation(
      async (
        _context: unknown,
        action: (value: typeof transaction) => Promise<unknown>,
      ) => action(transaction),
    );
    service = new IntegrationsService(
      database as unknown as PrismaService,
      rls as unknown as RlsTransactionService,
      signing as unknown as IntegrationSigningService,
    );
  });

  it('returns only the dashboard produced inside the RLS transaction', async () => {
    const dashboard = { connections: [], recentEvents: [] };
    transaction.$queryRaw.mockResolvedValue([{ dashboard }]);

    await expect(service.getDashboard(CONTEXT)).resolves.toEqual(dashboard);
    expect(rls.run).toHaveBeenCalledWith(
      {
        userId: CONTEXT.userId,
        organisationId: CONTEXT.organisationId,
        aal: 'AAL2',
      },
      expect.any(Function),
    );
  });

  it('returns a one-time derived secret for a new intake connection', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        provider: 'WORDPRESS',
        secretVersion: 1,
      },
    ]);

    await expect(
      service.createConnection(
        {
          provider: 'WORDPRESS' as never,
          displayName: 'Website intake',
        },
        CONTEXT,
      ),
    ).resolves.toMatchObject({ signingSecret: 'derived-secret' });
    expect(signing.deriveConnectionSecret).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      1,
    );
  });

  it('validates signature before recording an external enquiry', async () => {
    database.$queryRaw
      .mockResolvedValueOnce([
        {
          organisationId: CONTEXT.organisationId,
          provider: 'WORDPRESS',
          displayName: 'Website',
          secretVersion: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          eventId: '66666666-6666-4666-8666-666666666666',
          enquiryId: '77777777-7777-4777-8777-777777777777',
          duplicate: false,
          correlationId: '88888888-8888-4888-8888-888888888888',
        },
      ]);

    await expect(
      service.receiveExternalEnquiry({
        connectionId: '55555555-5555-4555-8555-555555555555',
        eventId: 'wordpress/100',
        eventType: 'lead.created',
        timestamp: '1787398400',
        signature: `v1=${'a'.repeat(64)}`,
        rawBody: Buffer.from('{"firstName":"Ada"}'),
        dto: {
          firstName: 'Ada',
          email: 'ada@example.test',
          lawfulBasis: 'CONSENT',
          privacyNoticeAcknowledged: true,
          privacyNoticeVersion: '2026-08',
        },
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(signing.verifyIntakeSignature).toHaveBeenCalledTimes(1);
    expect(database.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete intake before database or signature work', async () => {
    await expect(
      service.receiveExternalEnquiry({
        connectionId: '55555555-5555-4555-8555-555555555555',
        eventId: 'event-1',
        eventType: 'lead.created',
        timestamp: '1787398400',
        signature: `v1=${'a'.repeat(64)}`,
        rawBody: Buffer.from('{}'),
        dto: {
          firstName: 'Ada',
          lawfulBasis: 'CONSENT',
          privacyNoticeAcknowledged: true,
          privacyNoticeVersion: '2026-08',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it('records a validated hosted-form submission without storing raw payloads', async () => {
    const previousWebAppUrl = process.env.WEB_APP_URL;
    process.env.WEB_APP_URL = 'https://app.example.test';
    database.$queryRaw
      .mockResolvedValueOnce([
        {
          id: '55555555-5555-4555-8555-555555555555',
          organisationId: CONTEXT.organisationId,
          connectionId: '66666666-6666-4666-8666-666666666666',
          publicId: '77777777-7777-4777-8777-777777777777',
          name: 'Website enquiry',
          description: null,
          formSchema: {
            fields: [
              { name: 'firstName', label: 'First name', required: true },
              { name: 'email', label: 'Email', required: true },
            ],
          },
          privacyNoticeUrl: 'https://example.test/privacy',
          privacyNoticeVersion: '2026-08',
          allowedOrigins: ['https://website.example.test'],
          successMessage: 'Received.',
          submitButtonLabel: 'Submit',
          honeypotField: 'company_website',
        },
      ])
      .mockResolvedValueOnce([
        {
          submissionId: '88888888-8888-4888-8888-888888888888',
          enquiryId: '99999999-9999-4999-8999-999999999999',
          duplicate: false,
          correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ]);

    try {
      await expect(
        service.submitPublicIntakeForm({
          publicId: '77777777-7777-4777-8777-777777777777',
          origin: 'https://website.example.test',
          rawBody: Buffer.from('{"firstName":"Ada"}'),
          dto: {
            submissionId: 'website-submission-100',
            formStartedAt: new Date(Date.now() - 2_000).toISOString(),
            firstName: 'Ada',
            email: 'ada@example.test',
            lawfulBasis: 'CONSENT',
            privacyNoticeAcknowledged: true,
            privacyNoticeVersion: '2026-08',
          },
        }),
      ).resolves.toMatchObject({ accepted: true, duplicate: false });
      expect(database.$queryRaw).toHaveBeenCalledTimes(2);
    } finally {
      if (previousWebAppUrl === undefined) delete process.env.WEB_APP_URL;
      else process.env.WEB_APP_URL = previousWebAppUrl;
    }
  });

  it('quarantines automated hosted-form abuse with a non-enumerating response', async () => {
    database.$queryRaw
      .mockResolvedValueOnce([
        {
          id: '55555555-5555-4555-8555-555555555555',
          organisationId: CONTEXT.organisationId,
          connectionId: '66666666-6666-4666-8666-666666666666',
          publicId: '77777777-7777-4777-8777-777777777777',
          name: 'Website enquiry',
          description: null,
          formSchema: {
            fields: [
              { name: 'firstName', label: 'First name', required: true },
              { name: 'email', label: 'Email', required: true },
            ],
          },
          privacyNoticeUrl: 'https://example.test/privacy',
          privacyNoticeVersion: '2026-08',
          allowedOrigins: [],
          successMessage: 'Received.',
          submitButtonLabel: 'Submit',
          honeypotField: 'company_website',
        },
      ])
      .mockResolvedValueOnce([
        { submissionId: '88888888-8888-4888-8888-888888888888' },
      ]);

    await expect(
      service.submitPublicIntakeForm({
        publicId: '77777777-7777-4777-8777-777777777777',
        origin: undefined,
        rawBody: Buffer.from('{"companyWebsite":"spam"}'),
        dto: {
          submissionId: 'website-submission-spam',
          formStartedAt: new Date(Date.now() - 2_000).toISOString(),
          firstName: 'Bot',
          email: 'bot@example.test',
          lawfulBasis: 'CONSENT',
          privacyNoticeAcknowledged: true,
          privacyNoticeVersion: '2026-08',
          companyWebsite: 'https://spam.example',
        },
      }),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
      submissionId: '88888888-8888-4888-8888-888888888888',
    });
  });

  it('does not leak database permission details', async () => {
    transaction.$queryRaw.mockRejectedValue({ originalCode: '42501' });
    await expect(service.getDashboard(CONTEXT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
