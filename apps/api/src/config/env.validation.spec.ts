import { validateEnvironment } from './env.validation';

const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://businessos_runtime:password@database.example:5432/businessos?sslmode=verify-full',
  TRUST_PROXY_HOPS: 1,
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_JWT_ISSUER: 'https://project.supabase.co/auth/v1',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  WEB_APP_URL: 'https://app.businessos.example/',
  RESEND_API_KEY: 're_businessos_production_key_123456',
  EMAIL_FROM_ADDRESS: 'no-reply@notifications.example',
  INVITATION_TOKEN_SECRET:
    'workforce-invitation-secret-with-independent-entropy',
  PORTAL_INVITATION_TOKEN_SECRET:
    'portal-invitation-secret-with-independent-entropy',
  RESEND_WEBHOOK_SECRET: 'whsec_resend_signature_secret_123456',
  INTEGRATION_SIGNING_MASTER_SECRET:
    'integration-master-secret-with-independent-entropy-123456',
  STRIPE_SECRET_KEY: 'sk_live_businessoskey123456789',
  STRIPE_WEBHOOK_SECRET: 'whsec_stripe_signature_secret_123456',
  STRIPE_PLATFORM_ACCOUNT_ID: 'acct_platform123',
  STRIPE_API_VERSION: '2026-08-15.stable',
  OPENAI_AGENT_ENABLED: 'true',
  OPENAI_API_KEY: 'sk-proj-businessos-production-key-123456',
  OPENAI_AGENT_MODEL: 'approved-businessos-model',
  RELEASE_SHA: 'abcdef1234567890',
  SENTRY_DSN: 'https://public@example.ingest.sentry.io/12345',
  AXIOM_TOKEN: 'xaat-businessos-production-token-123456',
  BACKUP_RESTORE_EVIDENCE_AT: new Date().toISOString(),
  OPERATIONS_HEALTH_TOKEN:
    'operations-health-token-with-independent-entropy-123456',
  INCIDENT_RESPONSE_EMAIL: 'security@example.com',
  SUPABASE_PITR_ENABLED: 'true',
  AUTOMATION_WORKER_ENABLED: 'true',
  COMMUNICATION_DELIVERY_ENABLED: 'true',
  DOCUMENT_SCANNER_ENABLED: 'true',
};

describe('validateEnvironment Gate F controls', () => {
  it('accepts a complete production configuration with independent secrets', () => {
    expect(validateEnvironment(productionEnvironment)).toMatchObject({
      NODE_ENV: 'production',
      STRIPE_PLATFORM_ACCOUNT_ID: 'acct_platform123',
    });
  });

  it('rejects test-mode Stripe credentials in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        STRIPE_SECRET_KEY: 'sk_test_businessoskey123456789',
      }),
    ).toThrow('STRIPE_SECRET_KEY must be a live key in production');
  });

  it('rejects secret reuse across trust boundaries', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        INTEGRATION_SIGNING_MASTER_SECRET:
          productionEnvironment.PORTAL_INVITATION_TOKEN_SECRET,
      }),
    ).toThrow('integration signing master secret must be independent');
  });

  it('rejects an unencrypted production database connection', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        DATABASE_URL:
          'postgresql://businessos_runtime:password@database.example:5432/businessos',
      }),
    ).toThrow('DATABASE_URL must require TLS in production');
  });

  it('requires a reviewed production proxy chain', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        TRUST_PROXY_HOPS: 0,
      }),
    ).toThrow('TRUST_PROXY_HOPS must identify the reviewed proxy chain');
  });

  it('rejects stale backup restore evidence', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        BACKUP_RESTORE_EVIDENCE_AT: '2025-01-01T00:00:00.000Z',
      }),
    ).toThrow('A successful backup restore exercise is required every 92 days');
  });

  it('rejects a production deployment with a disabled critical worker', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        DOCUMENT_SCANNER_ENABLED: 'false',
      }),
    ).toThrow('DOCUMENT_SCANNER_ENABLED must be true in production');
  });

  it('requires the governed AI provider when paid AI is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        OPENAI_API_KEY: undefined,
      }),
    ).toThrow('OPENAI_API_KEY is required when OPENAI_AGENT_ENABLED is true');
  });

  it('allows production free mode without an AI key or model', () => {
    expect(
      validateEnvironment({
        ...productionEnvironment,
        OPENAI_AGENT_ENABLED: 'false',
        OPENAI_API_KEY: undefined,
        OPENAI_AGENT_MODEL: undefined,
      }),
    ).toMatchObject({
      NODE_ENV: 'production',
      OPENAI_AGENT_ENABLED: 'false',
    });
  });

  it('fails closed when live Gate L has no server-side credential map', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        GATE_L_LIVE_ENABLED: 'true',
        GATE_L_SYNC_ENABLED: 'true',
      }),
    ).toThrow(
      'GATE_L_PROVIDER_SECRETS_JSON is required when Gate L live providers are enabled',
    );
  });

  it('requires mailbox sync when live Gate L is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        GATE_L_LIVE_ENABLED: 'true',
        GATE_L_SYNC_ENABLED: 'false',
        GATE_L_PROVIDER_SECRETS_JSON: JSON.stringify({ configured: true }),
      }),
    ).toThrow('GATE_L_SYNC_ENABLED must be true for live Gate L operation');
  });

  it('accepts live Gate L only with a JSON credential map and sync enabled', () => {
    expect(
      validateEnvironment({
        ...productionEnvironment,
        GATE_L_LIVE_ENABLED: 'true',
        GATE_L_SYNC_ENABLED: 'true',
        GATE_L_PROVIDER_SECRETS_JSON: JSON.stringify({
          'microsoft-main': { provider: 'MICROSOFT_365' },
        }),
      }),
    ).toMatchObject({
      GATE_L_LIVE_ENABLED: 'true',
      GATE_L_SYNC_ENABLED: 'true',
    });
  });
});
