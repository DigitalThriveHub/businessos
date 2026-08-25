import { MicrosoftGraphProvider } from './microsoft-graph-provider.service';

describe('MicrosoftGraphProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates an idempotency-marked draft and sends it through Graph', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'token', expires_in: 3600 }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'graph-message-1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const service = new MicrosoftGraphProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'MICROSOFT_365',
        tenantId: 'tenant',
        clientId: 'client',
        clientSecret: 'secret',
        mailboxUserId: 'shared@example.test',
        webhookClientState: 'x'.repeat(32),
      }),
    } as never);

    await expect(
      service.send({
        messageId: '11111111-1111-4111-8111-111111111111',
        organisationId: '22222222-2222-4222-8222-222222222222',
        channel: 'EMAIL',
        connectionId: '33333333-3333-4333-8333-333333333333',
        provider: 'MICROSOFT_365',
        secretReference: 'legal-main',
        mailboxAddress: 'shared@example.test',
        phoneNumber: null,
        recipientAddresses: ['client@example.test'],
        subject: 'Case update',
        bodyText: 'Your matter has progressed.',
        idempotencyKey: 'message/test-001',
        attempt: 1,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({
      provider: 'microsoft_365',
      messageId: 'graph-message-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const draft = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      internetMessageHeaders: Array<{ name: string; value: string }>;
    };
    expect(draft.internetMessageHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-BusinessOS-Idempotency-Key' }),
      ]),
    );
  });

  it('persists a delta continuation so busy mailboxes do not starve later pages', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'token', expires_in: 3600 }),
        {
          status: 200,
        },
      ),
    );
    for (let page = 1; page <= 5; page += 1) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [],
            '@odata.nextLink': `https://graph.microsoft.com/page-${page + 1}`,
          }),
          { status: 200 },
        ),
      );
    }
    const service = new MicrosoftGraphProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'MICROSOFT_365',
        tenantId: 'tenant',
        clientId: 'client',
        clientSecret: 'secret',
        mailboxUserId: 'shared@example.test',
        webhookClientState: 'x'.repeat(32),
      }),
    } as never);

    await expect(
      service.sync({
        organisationId: '11111111-1111-4111-8111-111111111111',
        connectionId: '22222222-2222-4222-8222-222222222222',
        provider: 'MICROSOFT_365',
        secretReference: 'microsoft-main',
        capabilities: ['EMAIL'],
        mailboxAddress: 'shared@example.test',
        phoneNumber: null,
        syncCursor: null,
        state: 'READY',
        webhookPublicId: '33333333-3333-4333-8333-333333333333',
      }),
    ).resolves.toEqual({
      messages: [],
      nextCursor: 'https://graph.microsoft.com/page-6',
    });
  });

  it('does not forward a mailbox token to an untrusted continuation host', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const service = new MicrosoftGraphProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'MICROSOFT_365',
        tenantId: 'tenant',
        clientId: 'client',
        clientSecret: 'secret',
        mailboxUserId: 'shared@example.test',
        webhookClientState: 'x'.repeat(32),
      }),
    } as never);

    await expect(
      service.sync({
        organisationId: '11111111-1111-4111-8111-111111111111',
        connectionId: '22222222-2222-4222-8222-222222222222',
        provider: 'MICROSOFT_365',
        secretReference: 'microsoft-main',
        capabilities: ['EMAIL'],
        mailboxAddress: 'shared@example.test',
        phoneNumber: null,
        syncCursor: 'https://attacker.example/steal-token',
        state: 'READY',
        webhookPublicId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toMatchObject({ code: 'MICROSOFT_GRAPH_URL_REJECTED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
