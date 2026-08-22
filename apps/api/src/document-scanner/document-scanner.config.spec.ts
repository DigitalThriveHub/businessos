import { DocumentScannerConfig } from './document-scanner.config';

const ENABLED_ENV = {
  DOCUMENT_SCANNER_ENABLED: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-that-is-long-enough',
  CLAMAV_HOST: 'clamav.internal',
};

describe('DocumentScannerConfig', () => {
  it('remains fail-closed without requiring scanner secrets when disabled', () => {
    const config = new DocumentScannerConfig({
      DOCUMENT_SCANNER_ENABLED: 'false',
    });

    expect(config.enabled).toBe(false);
    expect(config.supabaseServiceRoleKey).toBe('');
  });

  it('accepts a private TCP scanner configuration', () => {
    const config = new DocumentScannerConfig(ENABLED_ENV);

    expect(config.enabled).toBe(true);
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.clamavHost).toBe('clamav.internal');
    expect(config.clamavSocketPath).toBeNull();
  });

  it('rejects an insecure production storage origin', () => {
    expect(
      () =>
        new DocumentScannerConfig({
          ...ENABLED_ENV,
          NODE_ENV: 'production',
          SUPABASE_URL: 'http://example.supabase.co',
        }),
    ).toThrow('SUPABASE_URL must use HTTPS in production.');
  });

  it('rejects ambiguous scanner transports and unsafe storage base paths', () => {
    expect(
      () =>
        new DocumentScannerConfig({
          ...ENABLED_ENV,
          CLAMAV_SOCKET_PATH: '/run/clamav/clamd.ctl',
        }),
    ).toThrow('Configure only one');

    expect(
      () =>
        new DocumentScannerConfig({
          ...ENABLED_ENV,
          SUPABASE_URL: 'https://example.supabase.co/untrusted-path',
        }),
    ).toThrow('must be an origin');
  });

  it('rejects a lease that can expire during the configured scan window', () => {
    expect(
      () =>
        new DocumentScannerConfig({
          ...ENABLED_ENV,
          DOCUMENT_SCANNER_LEASE_SECONDS: '30',
        }),
    ).toThrow('must exceed the combined scanner timeouts');
  });
});