import { GoogleWorkspaceProvider } from './google-workspace-provider.service';

describe('GoogleWorkspaceProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends RFC 5322 mail using a URL-safe Gmail payload', async () => {
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
        new Response(JSON.stringify({ id: 'gmail-message-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const service = new GoogleWorkspaceProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'GOOGLE_WORKSPACE',
        clientId: 'client',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        mailboxAddress: 'shared@example.test',
        calendarId: 'primary',
      }),
    } as never);

    await expect(
      service.send({
        messageId: '11111111-1111-4111-8111-111111111111',
        organisationId: '22222222-2222-4222-8222-222222222222',
        channel: 'EMAIL',
        connectionId: '33333333-3333-4333-8333-333333333333',
        provider: 'GOOGLE_WORKSPACE',
        secretReference: 'google-main',
        mailboxAddress: 'shared@example.test',
        phoneNumber: null,
        recipientAddresses: ['client@example.test'],
        subject: 'No\r\nBcc: attacker@example.test',
        bodyText: 'Safe body',
        idempotencyKey: 'message/test-002',
        attempt: 1,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({
      provider: 'google_workspace',
      messageId: 'gmail-message-1',
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      raw: string;
    };
    expect(payload.raw).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(
      payload.raw.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    expect(decoded).toContain('Subject: No Bcc: attacker@example.test');
    expect(decoded).not.toContain('\r\nBcc:');
  });

  it('takes a mailbox cursor before the initial snapshot so concurrent mail is replay-safe', async () => {
    const encodedBody = Buffer.from('Hello from a client')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'token', expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ historyId: '200' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'message-1' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'message-1',
            threadId: 'thread-1',
            historyId: '201',
            internalDate: String(Date.now()),
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Client <client@example.test>' },
                { name: 'To', value: 'shared@example.test' },
                { name: 'Subject', value: 'A new enquiry' },
              ],
              body: { data: encodedBody },
            },
          }),
          { status: 200 },
        ),
      );
    const service = new GoogleWorkspaceProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'GOOGLE_WORKSPACE',
        clientId: 'client',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        mailboxAddress: 'shared@example.test',
        calendarId: 'primary',
      }),
    } as never);

    const result = await service.sync({
      organisationId: '11111111-1111-4111-8111-111111111111',
      connectionId: '22222222-2222-4222-8222-222222222222',
      provider: 'GOOGLE_WORKSPACE',
      secretReference: 'google-main',
      capabilities: ['EMAIL'],
      mailboxAddress: 'shared@example.test',
      phoneNumber: null,
      syncCursor: null,
      state: 'READY',
      webhookPublicId: '33333333-3333-4333-8333-333333333333',
    });

    expect(fetchMock.mock.calls[1]?.[0]).toContain('/profile');
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/messages?');
    expect(result.nextCursor).toBe('200');
    expect(result.messages).toEqual([
      expect.objectContaining({
        providerMessageId: 'message-1',
        sender: 'client@example.test',
        bodyText: 'Hello from a client',
      }),
    ]);
  });

  it('continues a busy Gmail history feed without skipping unprocessed pages', async () => {
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
            historyId: String(200 + page),
            nextPageToken: `page-${page + 1}`,
            history: [],
          }),
          { status: 200 },
        ),
      );
    }
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ historyId: '250', history: [] }), {
        status: 200,
      }),
    );
    const service = new GoogleWorkspaceProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'GOOGLE_WORKSPACE',
        clientId: 'client',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        mailboxAddress: 'shared@example.test',
        calendarId: 'primary',
      }),
    } as never);
    const context = {
      organisationId: '11111111-1111-4111-8111-111111111111',
      connectionId: '22222222-2222-4222-8222-222222222222',
      provider: 'GOOGLE_WORKSPACE' as const,
      secretReference: 'google-main',
      capabilities: ['EMAIL'],
      mailboxAddress: 'shared@example.test',
      phoneNumber: null,
      syncCursor: '100',
      state: 'READY',
      webhookPublicId: '33333333-3333-4333-8333-333333333333',
    };

    const first = await service.sync(context);
    expect(first.nextCursor).toMatch(/^gmail-v1:/);
    const second = await service.sync({
      ...context,
      syncCursor: first.nextCursor,
    });

    expect(second.nextCursor).toBe('250');
    expect(fetchMock.mock.calls[6]?.[0]).toContain('startHistoryId=100');
    expect(fetchMock.mock.calls[6]?.[0]).toContain('pageToken=page-6');
  });

  it('recovers a calendar retry without creating a duplicate Google event', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'token', expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: '11111111111141118111111111111111',
            hangoutLink: 'https://meet.google.com/controlled-test',
          }),
          { status: 200 },
        ),
      );
    const service = new GoogleWorkspaceProvider({
      resolve: jest.fn().mockReturnValue({
        provider: 'GOOGLE_WORKSPACE',
        clientId: 'client',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        mailboxAddress: 'shared@example.test',
        calendarId: 'primary',
      }),
    } as never);
    const context = {
      organisationId: '22222222-2222-4222-8222-222222222222',
      connectionId: '33333333-3333-4333-8333-333333333333',
      provider: 'GOOGLE_WORKSPACE' as const,
      secretReference: 'google-main',
      capabilities: ['CALENDAR'],
      mailboxAddress: 'shared@example.test',
      phoneNumber: null,
      syncCursor: null,
      state: 'READY',
      webhookPublicId: '44444444-4444-4444-8444-444444444444',
    };

    await expect(
      service.createCalendarEvent(context, {
        eventId: '11111111-1111-4111-8111-111111111111',
        title: 'Controlled appointment',
        description: null,
        startsAt: new Date('2026-09-01T09:00:00.000Z'),
        endsAt: new Date('2026-09-01T09:30:00.000Z'),
        timezone: 'Europe/London',
        location: null,
        attendeeAddresses: ['client@example.test'],
        reminderMinutesBefore: 15,
        idempotencyKey: 'gate-l/calendar-retry-001',
      }),
    ).resolves.toEqual({
      providerEventId: '11111111111141118111111111111111',
      joinUrl: 'https://meet.google.com/controlled-test',
    });
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      '"id":"11111111111141118111111111111111"',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toContain(
      '/events/11111111111141118111111111111111',
    );
  });
});
