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
});
