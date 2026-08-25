import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  MY_AI_ACTION_TOOL_KEYS,
  type MyAiActionToolKey,
  type MyAiProviderResult,
  type MyAiRuntimeContext,
  myAiProviderOutputSchema,
} from './my-ai.types';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function outputText(body: JsonRecord): string | null {
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return body.output_text;
  }

  if (!Array.isArray(body.output)) return null;

  for (const item of body.output) {
    if (
      !isRecord(item) ||
      item.type !== 'message' ||
      !Array.isArray(item.content)
    ) {
      continue;
    }

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
  if (!Array.isArray(body.output)) return false;

  return body.output.some(
    (item) =>
      isRecord(item) &&
      Array.isArray(item.content) &&
      item.content.some(
        (content) => isRecord(content) && content.type === 'refusal',
      ),
  );
}

function structuredOutputSchema(allowedTools: readonly MyAiActionToolKey[]) {
  const toolEnum =
    allowedTools.length > 0 ? [...allowedTools] : [...MY_AI_ACTION_TOOL_KEYS];

  return {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'summary', 'followUpQuestions', 'suggestedActions'],
    properties: {
      answer: { type: 'string', minLength: 1, maxLength: 12_000 },
      summary: { type: 'string', minLength: 1, maxLength: 500 },
      followUpQuestions: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
      suggestedActions: {
        type: 'array',
        maxItems: allowedTools.length > 0 ? 5 : 0,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'toolKey',
            'subjectType',
            'subjectId',
            'title',
            'summary',
            'riskLevel',
            'payload',
          ],
          properties: {
            toolKey: { type: 'string', enum: toolEnum },
            subjectType: {
              type: 'string',
              enum: ['ENQUIRY', 'CLIENT', 'MATTER'],
            },
            subjectId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 3, maxLength: 240 },
            summary: { type: 'string', minLength: 3, maxLength: 4_000 },
            riskLevel: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            },
            payload: {
              type: 'object',
              additionalProperties: false,
              required: [
                'dueAt',
                'assigneeUserId',
                'draftText',
                'documentTypes',
                'targetStatus',
                'note',
              ],
              properties: {
                dueAt: { type: ['string', 'null'], format: 'date-time' },
                assigneeUserId: { type: ['string', 'null'], format: 'uuid' },
                draftText: { type: ['string', 'null'], maxLength: 4_000 },
                documentTypes: {
                  type: 'array',
                  maxItems: 20,
                  items: { type: 'string', minLength: 1, maxLength: 120 },
                },
                targetStatus: { type: ['string', 'null'], maxLength: 80 },
                note: { type: ['string', 'null'], maxLength: 1_000 },
              },
            },
          },
        },
      },
    },
  };
}

@Injectable()
export class OpenAiGatewayService {
  constructor(private readonly config: ConfigService) {}

  async generate(input: {
    mode: 'CHAT' | 'DAILY_BRIEF';
    message: string;
    context: MyAiRuntimeContext;
  }): Promise<MyAiProviderResult> {
    const providerEnabled =
      this.config.get<string>('OPENAI_AGENT_ENABLED', 'false') === 'true';
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    const configuredModel = this.config
      .get<string>('OPENAI_AGENT_MODEL')
      ?.trim();

    if (!providerEnabled || !apiKey || !configuredModel) {
      throw new ServiceUnavailableException(
        providerEnabled
          ? 'The governed AI provider is not configured.'
          : 'AI generation is disabled in free mode.',
      );
    }

    const authorityRank: Readonly<Record<string, number>> = {
      DISABLED: 0,
      READ: 1,
      DRAFT: 2,
      PROPOSE: 3,
      EXECUTE_WITH_APPROVAL: 4,
      EXECUTE_AUTOMATIC: 5,
    };
    const profileAuthority =
      authorityRank[input.context.identity.authorityCeiling] ?? 0;
    const allowedActionTools = input.context.policies
      .filter(
        (policy) =>
          ['DRAFT', 'PROPOSE'].includes(policy.authorityLevel) &&
          policy.requiresApproval &&
          profileAuthority >= (authorityRank[policy.authorityLevel] ?? 99) &&
          MY_AI_ACTION_TOOL_KEYS.includes(policy.toolKey as MyAiActionToolKey),
      )
      .map((policy) => policy.toolKey as MyAiActionToolKey);
    const uniqueActionTools = [...new Set(allowedActionTools)];

    const instructions = [
      'You are the governed personal AI inside BusinessOS.',
      'Use only the supplied permission-filtered BusinessOS context.',
      'Never invent records, facts, deadlines, payments or completed work.',
      'Never claim that an action was executed. You may only draft or propose.',
      'Any proposed action requires the application and a human approver.',
      'Do not provide final legal, tax, accounting or regulatory advice; clearly request the appropriate qualified review.',
      'Minimise personal data in the response and do not repeat identifiers unless needed for an action proposal.',
      'Be practical, concise and focused on reducing UK business administration.',
      input.context.identity.behaviourInstructions,
    ].join('\n');

    const providerInput = JSON.stringify({
      requestMode: input.mode,
      employee: {
        displayName: input.context.identity.displayName,
        jobTitle: input.context.identity.jobTitle,
        roles: input.context.identity.roles,
        agentName: input.context.identity.agentName,
        authorityCeiling: input.context.identity.authorityCeiling,
      },
      workload: input.context.workload,
      allowedActionTools: uniqueActionTools,
      recentConversation: input.context.history,
      employeeRequest: input.message,
    });

    const timeoutMs = this.config.get<number>(
      'OPENAI_AGENT_TIMEOUT_MS',
      30_000,
    );
    const maximumOutputTokens = this.config.get<number>(
      'OPENAI_AGENT_MAX_OUTPUT_TOKENS',
      1_800,
    );
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: configuredModel,
          instructions,
          input: providerInput,
          store: false,
          max_output_tokens: maximumOutputTokens,
          text: {
            format: {
              type: 'json_schema',
              name: 'businessos_personal_ai_result',
              strict: true,
              schema: structuredOutputSchema(uniqueActionTools),
            },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BadGatewayException(
        'The AI provider could not be reached. No action was taken.',
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body)) {
      throw new BadGatewayException(
        'The AI provider rejected the request. No action was taken.',
      );
    }

    if (body.status !== 'completed' || containsRefusal(body)) {
      throw new BadGatewayException(
        'The AI provider could not complete this request. No action was taken.',
      );
    }

    const rawOutput = outputText(body);
    if (!rawOutput) {
      throw new BadGatewayException(
        'The AI provider returned an invalid response. No action was taken.',
      );
    }

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(rawOutput);
    } catch {
      throw new BadGatewayException(
        'The AI provider returned an invalid response. No action was taken.',
      );
    }

    const output = myAiProviderOutputSchema.safeParse(parsedOutput);
    if (!output.success) {
      throw new BadGatewayException(
        'The AI provider returned an invalid response. No action was taken.',
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
      throw new BadGatewayException(
        'The AI provider returned invalid evidence. No action was taken.',
      );
    }

    const usage = isRecord(body.usage) ? body.usage : {};
    const inputTokens = nonNegativeInteger(usage.input_tokens);
    const outputTokens = nonNegativeInteger(usage.output_tokens);
    const inputDetails = isRecord(usage.input_tokens_details)
      ? usage.input_tokens_details
      : {};
    const cachedInputTokens = Math.min(
      inputTokens,
      nonNegativeInteger(inputDetails.cached_tokens),
    );
    const totalTokens = Math.max(
      inputTokens + outputTokens,
      nonNegativeInteger(usage.total_tokens),
    );

    return {
      responseId,
      requestId: response.headers.get('x-request-id'),
      model: observedModel,
      latencyMs: Math.max(0, Date.now() - startedAt),
      output: output.data,
      usage: {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens,
      },
    };
  }
}
