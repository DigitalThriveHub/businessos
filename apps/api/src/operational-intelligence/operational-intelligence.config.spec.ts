import { OperationalIntelligenceConfig } from './operational-intelligence.config';

describe('OperationalIntelligenceConfig', () => {
  it('defaults to genuine free mode without provider credentials', () => {
    const config = new OperationalIntelligenceConfig({});
    expect(config.enabled).toBe(false);
    expect(config.apiKey).toBe('');
    expect(config.model).toBe('');
    expect(config.maxFileBytes).toBe(20_971_520);
  });

  it('requires the malware scanner before provider processing', () => {
    expect(
      () =>
        new OperationalIntelligenceConfig({
          DOCUMENT_INTELLIGENCE_ENABLED: 'true',
          OPENAI_API_KEY: 'sk-proj-private-test-key',
          DOCUMENT_INTELLIGENCE_MODEL: 'approved-vision-model',
        }),
    ).toThrow('DOCUMENT_SCANNER_ENABLED must be true');
  });

  it('accepts an enabled bounded provider configuration', () => {
    const config = new OperationalIntelligenceConfig({
      DOCUMENT_INTELLIGENCE_ENABLED: 'true',
      DOCUMENT_SCANNER_ENABLED: 'true',
      OPENAI_API_KEY: 'sk-proj-private-test-key',
      DOCUMENT_INTELLIGENCE_MODEL: 'approved-vision-model',
      DOCUMENT_INTELLIGENCE_LEASE_SECONDS: '300',
      DOCUMENT_INTELLIGENCE_TIMEOUT_MS: '60000',
    });
    expect(config).toMatchObject({
      enabled: true,
      model: 'approved-vision-model',
      leaseSeconds: 300,
    });
  });

  it('rejects a lease that cannot cover the provider timeout', () => {
    expect(
      () =>
        new OperationalIntelligenceConfig({
          DOCUMENT_INTELLIGENCE_ENABLED: 'true',
          DOCUMENT_SCANNER_ENABLED: 'true',
          OPENAI_API_KEY: 'sk-proj-private-test-key',
          DOCUMENT_INTELLIGENCE_MODEL: 'approved-vision-model',
          DOCUMENT_INTELLIGENCE_LEASE_SECONDS: '60',
          DOCUMENT_INTELLIGENCE_TIMEOUT_MS: '60000',
        }),
    ).toThrow('must exceed the provider timeout');
  });
});
