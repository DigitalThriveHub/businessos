import { OperationalIntelligenceConfig } from './operational-intelligence.config';
import { DocumentIntelligenceProviderService } from './document-intelligence-provider.service';
import { DocumentIntelligencePipelineError } from './operational-intelligence.types';

const providerOutput = {
  detectedCategory: 'IDENTITY',
  categoryConfidenceBps: 9400,
  extractedFields: [
    { label: 'Document number', value: 'REDACTED', confidenceBps: 9000 },
  ],
  extractedNames: ['Example Person'],
  extractedDates: [
    { label: 'Issue date', value: '2026-01-01', confidenceBps: 8500 },
  ],
  expiryDate: '2031-01-01',
  missingPages: [],
  missingInformation: [],
  inconsistencies: [],
  summary: 'Identity document ready for human review.',
  reviewPriority: 'ROUTINE',
} as const;

function config(enabled = true): OperationalIntelligenceConfig {
  return new OperationalIntelligenceConfig(
    enabled
      ? {
          DOCUMENT_INTELLIGENCE_ENABLED: 'true',
          DOCUMENT_SCANNER_ENABLED: 'true',
          OPENAI_API_KEY: 'sk-proj-private-test-key',
          DOCUMENT_INTELLIGENCE_MODEL: 'approved-vision-model',
          DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR: '2000',
          DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR: '6000',
        }
      : {},
  );
}

function response(output: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_document_123',
      status: status === 200 ? 'completed' : 'failed',
      model: 'approved-vision-model',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(output) }],
        },
      ],
      usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
    }),
    {
      status,
      headers: { 'x-request-id': 'req_document_123' },
    },
  );
}

describe('DocumentIntelligenceProviderService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('makes no provider call in free mode', async () => {
    const service = new DocumentIntelligenceProviderService(config(false));
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(
      service.analyse({
        bytes: Buffer.from('document'),
        fileName: 'record.pdf',
        contentType: 'application/pdf',
        documentTitle: 'Identity record',
        currentCategory: 'GENERAL',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_DISABLED', retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses non-stored strict file input and returns usage evidence', async () => {
    const service = new DocumentIntelligenceProviderService(config());
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(providerOutput)) as unknown as typeof fetch;
    const result = await service.analyse({
      bytes: Buffer.from('private-document'),
      fileName: 'record.pdf',
      contentType: 'application/pdf',
      documentTitle: 'Identity record',
      currentCategory: 'GENERAL',
    });
    expect(result).toMatchObject({
      responseId: 'resp_document_123',
      requestId: 'req_document_123',
      usage: { inputTokens: 1000, outputTokens: 500, estimatedCostMinor: 5 },
      output: { detectedCategory: 'IDENTITY' },
    });
    const [, request] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(request.body)) as {
      store: boolean;
      input: Array<{ content: Array<Record<string, unknown>> }>;
      text: { format: { strict: boolean; schema: JsonObject } };
    };
    type JsonObject = Record<string, unknown>;
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema).toMatchObject({
      additionalProperties: false,
    });
    expect(body.input[0]?.content[1]).toMatchObject({
      type: 'input_file',
      filename: 'record.pdf',
    });
    expect(String(request.body)).not.toContain('sk-proj-private-test-key');
  });

  it('uses image input for scanned image evidence', async () => {
    const service = new DocumentIntelligenceProviderService(config());
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(providerOutput)) as unknown as typeof fetch;
    await service.analyse({
      bytes: Buffer.from('image'),
      fileName: 'scan.png',
      contentType: 'image/png',
      documentTitle: 'Scanned record',
      currentCategory: 'GENERAL',
    });
    const request = (global.fetch as jest.Mock).mock
      .calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain('"type":"input_image"');
    expect(String(request.body)).toContain('data:image/png;base64,');
  });

  it('rejects malformed structured output without exposing it', async () => {
    const service = new DocumentIntelligenceProviderService(config());
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response({ summary: 'incomplete' }),
      ) as unknown as typeof fetch;
    await expect(
      service.analyse({
        bytes: Buffer.from('document'),
        fileName: 'record.pdf',
        contentType: 'application/pdf',
        documentTitle: 'Record',
        currentCategory: 'GENERAL',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' });
  });

  it('marks provider throttling as retryable', async () => {
    const service = new DocumentIntelligenceProviderService(config());
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({}, 429)) as unknown as typeof fetch;
    await expect(
      service.analyse({
        bytes: Buffer.from('document'),
        fileName: 'record.pdf',
        contentType: 'application/pdf',
        documentTitle: 'Record',
        currentCategory: 'GENERAL',
      }),
    ).rejects.toEqual(
      expect.objectContaining<DocumentIntelligencePipelineError>({
        code: 'PROVIDER_HTTP_429',
        retryable: true,
      }),
    );
  });
});
