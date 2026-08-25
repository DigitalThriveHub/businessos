import { createHmac } from 'node:crypto';

import { WhatsAppCloudProvider } from './whatsapp-cloud-provider.service';

describe('WhatsAppCloudProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('verifies Meta HMAC evidence and sends an approved template outside the service window', async () => {
    const providerSecret = {
      provider: 'WHATSAPP_BUSINESS',
      graphApiVersion: 'v21.0',
      accessToken: 'access-token',
      appSecret: 'a'.repeat(32),
      phoneNumberId: '123456789',
      verifyToken: 'v'.repeat(32),
      defaultTemplateName: 'businessos_update',
      defaultTemplateLanguage: 'en_GB',
    };
    const service = new WhatsAppCloudProvider({
      resolve: jest.fn().mockReturnValue(providerSecret),
    } as never);
    const context = {
      organisationId: '11111111-1111-4111-8111-111111111111',
      connectionId: '22222222-2222-4222-8222-222222222222',
      provider: 'WHATSAPP_BUSINESS' as const,
      secretReference: 'whatsapp-main',
      capabilities: ['WHATSAPP'],
      mailboxAddress: null,
      phoneNumber: '+442012345678',
      syncCursor: null,
      state: 'READY',
      webhookPublicId: '33333333-3333-4333-8333-333333333333',
    };
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = `sha256=${createHmac('sha256', providerSecret.appSecret).update(raw).digest('hex')}`;
    expect(service.verifySignature(context, raw, signature)).toBe(true);
    expect(service.verifySignature(context, raw, 'sha256=bad')).toBe(false);

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await service.send({
      messageId: '44444444-4444-4444-8444-444444444444',
      organisationId: context.organisationId,
      channel: 'WHATSAPP',
      connectionId: context.connectionId,
      provider: 'WHATSAPP_BUSINESS',
      secretReference: context.secretReference,
      mailboxAddress: null,
      phoneNumber: context.phoneNumber,
      recipientAddresses: ['+447700900000'],
      subject: null,
      bodyText: 'Your case has an update.',
      idempotencyKey: 'whatsapp/test-001',
      attempt: 1,
      maxAttempts: 5,
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      type: string;
      template: { name: string };
    };
    expect(payload).toEqual(
      expect.objectContaining({
        type: 'template',
        template: expect.objectContaining({ name: 'businessos_update' }),
      }),
    );
  });
});
