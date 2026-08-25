import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { MyAiRuntimeContext } from './my-ai.types';
import { OpenAiGatewayService } from './openai-gateway.service';

const context: MyAiRuntimeContext = {
  identity: {
    displayName: 'Authorised Employee',
    jobTitle: 'Case Worker',
    roles: ['Case Worker'],
    agentProfileId: '11111111-1111-4111-8111-111111111111',
    agentName: 'BusinessOS Personal AI',
    behaviourInstructions: 'Draft and propose only.',
    authorityCeiling: 'PROPOSE',
    requiresHumanReview: true,
    approverUserId: '22222222-2222-4222-8222-222222222222',
  },
  policies: [
    {
      toolKey: 'matter.task.propose',
      requiredPermissionKey: 'tasks.create',
      authorityLevel: 'PROPOSE',
      maximumDataScope: 'OWN',
      requiresApproval: true,
      requiresMfa: false,
      maxActionsPerRun: 5,
    },
  ],
  workload: {
    summary: {
      openTasks: 1,
      overdueTasks: 0,
      deadlinesNextSevenDays: 0,
      assignedEnquiries: 0,
      activeMatters: 1,
      pendingApprovals: 0,
    },
    tasks: [],
    deadlines: [],
    records: [],
  },
  history: [],
};

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function completedResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      id: 'resp_businessos_123',
      status: 'completed',
      model: 'approved-businessos-model',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(output) }],
        },
      ],
      usage: {
        input_tokens: 120,
        output_tokens: 40,
        total_tokens: 160,
        input_tokens_details: { cached_tokens: 20 },
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_businessos_123',
      },
    },
  );
}

describe('OpenAiGatewayService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails closed before a provider call when server configuration is absent', async () => {
    const gateway = new OpenAiGatewayService(config({}));
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(
      gateway.generate({ mode: 'CHAT', message: 'Help me', context }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('makes no provider call in free mode even when a key is present', async () => {
    const gateway = new OpenAiGatewayService(
      config({
        OPENAI_AGENT_ENABLED: 'false',
        OPENAI_API_KEY: 'sk-proj-private-test-key',
        OPENAI_AGENT_MODEL: 'approved-businessos-model',
      }),
    );
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(
      gateway.generate({ mode: 'CHAT', message: 'Help me', context }),
    ).rejects.toThrow('disabled in free mode');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses non-stored strict Responses API output and returns usage evidence', async () => {
    const gateway = new OpenAiGatewayService(
      config({
        OPENAI_AGENT_ENABLED: 'true',
        OPENAI_API_KEY: 'sk-proj-private-test-key',
        OPENAI_AGENT_MODEL: 'approved-businessos-model',
        OPENAI_AGENT_TIMEOUT_MS: 30_000,
        OPENAI_AGENT_MAX_OUTPUT_TOKENS: 1_800,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue(
      completedResponse({
        answer: 'Review the assigned matter first.',
        summary: 'One matter needs attention.',
        followUpQuestions: [],
        suggestedActions: [],
      }),
    ) as unknown as typeof fetch;

    const result = await gateway.generate({
      mode: 'DAILY_BRIEF',
      message: 'Prepare my brief',
      context,
    });

    expect(result).toMatchObject({
      responseId: 'resp_businessos_123',
      requestId: 'req_businessos_123',
      model: 'approved-businessos-model',
      usage: {
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 40,
        totalTokens: 160,
      },
    });

    const [, request] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(request.body)) as {
      store: boolean;
      text: {
        format: {
          strict: boolean;
          schema: { additionalProperties: boolean };
        };
      };
    };
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(String(request.body)).not.toContain('sk-proj-private-test-key');
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer sk-proj-private-test-key',
    });
  });

  it('does not expose proposal tools above the employee authority ceiling', async () => {
    const gateway = new OpenAiGatewayService(
      config({
        OPENAI_AGENT_ENABLED: 'true',
        OPENAI_API_KEY: 'sk-proj-private-test-key',
        OPENAI_AGENT_MODEL: 'approved-businessos-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue(
      completedResponse({
        answer: 'Here is your read-only workload summary.',
        summary: 'Read-only summary.',
        followUpQuestions: [],
        suggestedActions: [],
      }),
    ) as unknown as typeof fetch;

    await gateway.generate({
      mode: 'CHAT',
      message: 'What should I do next?',
      context: {
        ...context,
        identity: { ...context.identity, authorityCeiling: 'READ' },
      },
    });

    const [, request] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(request.body)) as {
      input: string;
      text: {
        format: {
          schema: {
            properties: { suggestedActions: { maxItems: number } };
          };
        };
      };
    };
    expect(JSON.parse(body.input)).toMatchObject({ allowedActionTools: [] });
    expect(body.text.format.schema.properties.suggestedActions.maxItems).toBe(
      0,
    );
  });

  it('rejects malformed provider output without returning it to the employee', async () => {
    const gateway = new OpenAiGatewayService(
      config({
        OPENAI_AGENT_ENABLED: 'true',
        OPENAI_API_KEY: 'sk-proj-private-test-key',
        OPENAI_AGENT_MODEL: 'approved-businessos-model',
      }),
    );
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        completedResponse({ answer: 'Missing required fields' }),
      ) as unknown as typeof fetch;

    await expect(
      gateway.generate({ mode: 'CHAT', message: 'Help me', context }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('fails safely when the provider is unreachable', async () => {
    const gateway = new OpenAiGatewayService(
      config({
        OPENAI_AGENT_ENABLED: 'true',
        OPENAI_API_KEY: 'sk-proj-private-test-key',
        OPENAI_AGENT_MODEL: 'approved-businessos-model',
      }),
    );
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('network detail must remain private'),
      ) as unknown as typeof fetch;

    await expect(
      gateway.generate({ mode: 'CHAT', message: 'Help me', context }),
    ).rejects.toThrow('No action was taken');
  });
});
