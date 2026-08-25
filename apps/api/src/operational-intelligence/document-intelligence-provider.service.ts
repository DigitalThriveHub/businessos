import { Injectable } from '@nestjs/common';

import { OperationalIntelligenceConfig } from './operational-intelligence.config';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_REVIEW_PRIORITIES,
  DocumentIntelligencePipelineError,
  type DocumentIntelligenceProviderResult,
  documentIntelligenceOutputSchema,
} from './operational-intelligence.types';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function responseOutputText(body: JsonRecord): string | null {
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return body.output_text;
  }
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === 'output_text' &&
        typeof content.text === 'string' &&
        content.text.trim()
      ) {
        return content.text;
      }
    }
  }
  return null;
}

function containsRefusal(body: JsonRecord): boolean {
  return (
    Array.isArray(body.output) &&
    body.output.some(
      (item) =>
        isRecord(item) &&
        Array.isArray(item.content) &&
        item.content.some(
          (content) => isRecord(content) && content.type === 'refusal',
        ),
    )
  );
}

function strictOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'detectedCategory',
      'categoryConfidenceBps',
      'extractedFields',
      'extractedNames',
      'extractedDates',
      'expiryDate',
      'missingPages',
      'missingInformation',
      'inconsistencies',
      'summary',
      'reviewPriority',
    ],
    properties: {
      detectedCategory: { type: 'string', enum: [...DOCUMENT_CATEGORIES] },
      categoryConfidenceBps: {
        type: 'integer',
        minimum: 0,
        maximum: 10_000,
      },
      extractedFields: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value', 'confidenceBps'],
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 120 },
            value: { type: 'string', minLength: 1, maxLength: 1000 },
            confidenceBps: {
              type: 'integer',
              minimum: 0,
              maximum: 10_000,
            },
          },
        },
      },
      extractedNames: {
        type: 'array',
        maxItems: 100,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
      extractedDates: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value', 'confidenceBps'],
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 120 },
            value: {
              type: 'string',
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            },
            confidenceBps: {
              type: 'integer',
              minimum: 0,
              maximum: 10_000,
            },
          },
        },
      },
      expiryDate: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
      missingPages: {
        type: 'array',
        maxItems: 500,
        items: { type: 'integer', minimum: 1, maximum: 10_000 },
      },
      missingInformation: {
        type: 'array',
        maxItems: 100,
        items: { type: 'string', minLength: 1, maxLength: 500 },
      },
      inconsistencies: {
        type: 'array',
        maxItems: 100,
        items: { type: 'string', minLength: 1, maxLength: 500 },
      },
      summary: { type: 'string', minLength: 3, maxLength: 4000 },
      reviewPriority: {
        type: 'string',
        enum: [...DOCUMENT_REVIEW_PRIORITIES],
      },
    },
  };
}

function providerContent(input: {
  bytes: Buffer;
  fileName: string;
  contentType: string;
}): JsonRecord {
  const dataUrl = `data:${input.contentType};base64,${input.bytes.toString('base64')}`;
  if (input.contentType.startsWith('image/')) {
    return { type: 'input_image', image_url: dataUrl, detail: 'high' };
  }
  return {
    type: 'input_file',
    filename: input.fileName,
    file_data: dataUrl,
  };
}

@Injectable()
export class DocumentIntelligenceProviderService {
  constructor(private readonly config: OperationalIntelligenceConfig) {}

  async analyse(input: {
    bytes: Buffer;
    fileName: string;
    contentType: string;
    documentTitle: string;
    currentCategory: string;
  }): Promise<DocumentIntelligenceProviderResult> {
    if (!this.config.enabled) {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_DISABLED',
        'Document intelligence is disabled; manual review remains available.',
        false,
      );
    }

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          store: false,
          max_output_tokens: this.config.maxOutputTokens,
          instructions: [
            'Extract facts only from the supplied private business document.',
            'Never infer a fact that is not visible in the document.',
            'Flag uncertainty, missing pages, missing information and inconsistencies.',
            'Return dates as ISO calendar dates only when supported by the document.',
            'The output is advisory and will be confirmed by an authorised human.',
            'Do not provide legal, tax, financial or regulatory advice.',
          ].join('\n'),
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    task: 'Classify and extract the supplied document.',
                    documentTitle: input.documentTitle,
                    currentHumanCategory: input.currentCategory,
                    permittedCategories: DOCUMENT_CATEGORIES,
                  }),
                },
                providerContent(input),
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'businessos_document_intelligence_result',
              strict: true,
              schema: strictOutputSchema(),
            },
          },
        }),
        signal: AbortSignal.timeout(this.config.providerTimeoutMs),
      });
    } catch (error) {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_UNAVAILABLE',
        'The document-intelligence provider could not be reached.',
        true,
        { cause: error },
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body)) {
      throw new DocumentIntelligencePipelineError(
        `PROVIDER_HTTP_${response.status}`,
        'The document-intelligence provider rejected the request.',
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }
    if (body.status !== 'completed' || containsRefusal(body)) {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_INCOMPLETE',
        'The document-intelligence provider did not complete the request.',
        true,
      );
    }

    const outputText = responseOutputText(body);
    if (!outputText) {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_OUTPUT_INVALID',
        'The provider returned no valid structured output.',
        false,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_OUTPUT_INVALID',
        'The provider returned invalid structured output.',
        false,
      );
    }
    const output = documentIntelligenceOutputSchema.safeParse(parsed);
    if (!output.success) {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_OUTPUT_INVALID',
        'The provider returned invalid structured output.',
        false,
      );
    }

    const responseId = body.id;
    const observedModel = body.model;
    if (
      typeof responseId !== 'string' ||
      responseId.length < 3 ||
      responseId.length > 240 ||
      typeof observedModel !== 'string' ||
      observedModel.length < 1 ||
      observedModel.length > 120
    ) {
      throw new DocumentIntelligencePipelineError(
        'PROVIDER_EVIDENCE_INVALID',
        'The provider returned invalid request evidence.',
        false,
      );
    }

    const usage = isRecord(body.usage) ? body.usage : {};
    const inputTokens = nonNegativeInteger(usage.input_tokens);
    const outputTokens = nonNegativeInteger(usage.output_tokens);
    const totalTokens = Math.max(
      inputTokens + outputTokens,
      nonNegativeInteger(usage.total_tokens),
    );
    const estimatedCostMinor = Math.ceil(
      (inputTokens * this.config.inputCostPerMillionMinor +
        outputTokens * this.config.outputCostPerMillionMinor) /
        1_000_000,
    );

    return {
      responseId,
      requestId: response.headers.get('x-request-id'),
      model: observedModel,
      latencyMs: Math.max(0, Date.now() - startedAt),
      output: output.data,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostMinor,
      },
    };
  }
}
