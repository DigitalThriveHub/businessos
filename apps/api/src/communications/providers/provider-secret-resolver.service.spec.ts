import { ProviderSecretResolver } from './provider-secret-resolver.service';

function resolver(
  value?: string,
  liveEnabled = Boolean(value),
): ProviderSecretResolver {
  return new ProviderSecretResolver({
    get: jest.fn((name: string) =>
      name === 'GATE_L_LIVE_ENABLED' ? (liveEnabled ? 'true' : 'false') : value,
    ),
  } as never);
}

describe('ProviderSecretResolver', () => {
  it('resolves the credential only through its opaque server reference', () => {
    const service = resolver(
      JSON.stringify({
        'legal-main': {
          provider: 'MICROSOFT_365',
          tenantId: 'tenant-id',
          clientId: 'client-id',
          clientSecret: 'secret-value',
          mailboxUserId: 'shared@example.test',
          webhookClientState: 'x'.repeat(32),
        },
      }),
    );

    expect(service.resolve('legal-main', 'MICROSOFT_365')).toEqual(
      expect.objectContaining({ mailboxUserId: 'shared@example.test' }),
    );
    expect(service.has('legal-main', 'MICROSOFT_365')).toBe(true);
  });

  it('fails closed for a missing or cross-provider reference', () => {
    const service = resolver(
      JSON.stringify({
        whatsapp: {
          provider: 'WHATSAPP_BUSINESS',
          graphApiVersion: 'v21.0',
          accessToken: 'access-token-value',
          appSecret: 'a'.repeat(32),
          phoneNumberId: '123456789',
          verifyToken: 'v'.repeat(32),
        },
      }),
    );

    expect(() => service.resolve('whatsapp', 'GOOGLE_WORKSPACE')).toThrow(
      'credential is unavailable',
    );
    expect(() => service.resolve('unknown', 'WHATSAPP_BUSINESS')).toThrow(
      'credential is unavailable',
    );
  });

  it('accepts an empty map when live providers are disabled', () => {
    expect(resolver().has('anything', 'MICROSOFT_365')).toBe(false);
  });

  it('keeps configured credentials fail-closed behind the live kill switch', () => {
    const service = resolver(
      JSON.stringify({
        'legal-main': {
          provider: 'MICROSOFT_365',
          tenantId: 'tenant-id',
          clientId: 'client-id',
          clientSecret: 'secret-value',
          mailboxUserId: 'shared@example.test',
          webhookClientState: 'x'.repeat(32),
        },
      }),
      false,
    );

    expect(() => service.resolve('legal-main', 'MICROSOFT_365')).toThrow(
      'Live provider operations are disabled',
    );
    expect(service.has('legal-main', 'MICROSOFT_365')).toBe(false);
  });
});
