import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { AutomationControlService } from '../automation-control/automation-control.service';
import { RlsTransactionService } from '../database/rls-transaction.service';
import type { Prisma } from '../generated/prisma/client';
import type { RunMyAiCommandDto } from './dto/my-ai.dto';
import {
  MY_AI_ACTION_TOOL_KEYS,
  type MyAiAvailabilityView,
  type AgentIdentityContext,
  type AgentPolicyContext,
  type MyAiActionToolKey,
  type MyAiCommandResultView,
  type MyAiProviderOutput,
  type MyAiProviderResult,
  type MyAiRuntimeContext,
  type MyAiWorkspaceView,
  type WorkloadContext,
} from './my-ai.types';
import { OpenAiGatewayService } from './openai-gateway.service';

type ErrorRecord = Record<string, unknown>;

type IdentityRow = AgentIdentityContext;

interface WorkloadSummaryRow {
  openTasks: number;
  overdueTasks: number;
  deadlinesNextSevenDays: number;
  assignedEnquiries: number;
  activeMatters: number;
  pendingApprovals: number;
}

interface TaskRow {
  id: string;
  matterId: string;
  matterTitle: string;
  title: string;
  status: string;
  priority: string;
  dueAt: Date | string | null;
}

interface DeadlineRow {
  id: string;
  matterId: string;
  matterTitle: string;
  title: string;
  dueAt: Date | string;
  isCritical: boolean;
}

interface RecordRow {
  subjectType: 'ENQUIRY' | 'MATTER';
  subjectId: string;
  label: string;
  status: string;
  priority: string;
  nextActionAt: Date | string | null;
}

interface ConversationRow {
  id: string;
  title: string;
  status: string;
  lastMessageAt: Date | string;
  createdAt: Date | string;
}

interface MessageRow {
  id: string;
  runId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: Date | string;
}

interface ActionRow {
  id: string;
  toolKey: string;
  title: string;
  summary: string;
  riskLevel: string;
  status: string;
  subjectType: string;
  subjectId: string;
  approvalRequestId: string | null;
  approvalVersion: number | null;
  createdAt: Date | string;
}

interface RunRow {
  id: string;
  conversationId: string;
  completedAt?: Date | string;
}

interface PreparedRun {
  runId: string;
  conversationId: string;
  context: MyAiRuntimeContext;
}

interface StoredAction {
  id: string;
  proposal: MyAiProviderOutput['suggestedActions'][number];
  policy: AgentPolicyContext;
  approverUserId: string;
}

interface CompletedRun {
  completedAt: string;
  actionCount: number;
  approvalCandidates: StoredAction[];
}

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 6) return undefined;

  for (const key of ['originalCode', 'sqlState', 'sqlstate']) {
    const value = error[key];
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }

  for (const key of [
    'cause',
    'meta',
    'driverAdapterError',
    'originalError',
    'error',
  ]) {
    const code = postgresCode(error[key], depth + 1);
    if (code) return code;
  }

  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InternalServerErrorException(
      'The personal AI workspace returned an invalid timestamp.',
    );
  }
  return date.toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function safeConversationTitle(message: string, mode: 'CHAT' | 'DAILY_BRIEF') {
  if (mode === 'DAILY_BRIEF') {
    return `Daily brief - ${new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeZone: 'Europe/London',
    }).format(new Date())}`;
  }

  const singleLine = message.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 80 ? singleLine : `${singleLine.slice(0, 77)}...`;
}

function supportsSubject(toolKey: string, subjectType: string): boolean {
  if (
    ['matter.task.propose', 'matter.document-request.propose'].includes(toolKey)
  ) {
    return subjectType === 'MATTER';
  }

  return ['communication.draft', 'record.escalate'].includes(toolKey);
}

const AGENT_AUTHORITY_RANK: Readonly<Record<string, number>> = {
  DISABLED: 0,
  READ: 1,
  DRAFT: 2,
  PROPOSE: 3,
  EXECUTE_WITH_APPROVAL: 4,
  EXECUTE_AUTOMATIC: 5,
};

function profileAllowsPolicy(
  identity: AgentIdentityContext,
  policy: AgentPolicyContext,
): boolean {
  return (
    ['DRAFT', 'PROPOSE'].includes(policy.authorityLevel) &&
    policy.requiresApproval &&
    (AGENT_AUTHORITY_RANK[identity.authorityCeiling] ?? 0) >=
      (AGENT_AUTHORITY_RANK[policy.authorityLevel] ?? 99)
  );
}

@Injectable()
export class MyAiService {
  private readonly logger = new Logger(MyAiService.name);

  constructor(
    private readonly rls: RlsTransactionService,
    private readonly gateway: OpenAiGatewayService,
    private readonly automationControl: AutomationControlService,
    private readonly config: ConfigService,
  ) {}

  private aiAvailability(): MyAiAvailabilityView {
    const providerEnabled =
      this.config.get<string>('OPENAI_AGENT_ENABLED', 'false') === 'true';
    const providerConfigured = Boolean(
      this.config.get<string>('OPENAI_API_KEY')?.trim() &&
      this.config.get<string>('OPENAI_AGENT_MODEL')?.trim(),
    );

    const freeCapabilities = [
      'View your permission-filtered workload, tasks, deadlines and approvals.',
      'Use enquiries, matters, communications, finance and every other non-AI BusinessOS workspace normally.',
      'Review existing AI conversation, proposal and approval evidence.',
    ];
    const upgradeCapabilities = [
      'Generate a role-aware daily brief.',
      'Ask questions using permitted BusinessOS context.',
      'Draft governed next steps and route proposals for human approval.',
    ];

    if (!providerEnabled) {
      return {
        plan: 'FREE',
        state: 'FREE_MODE',
        commandAvailable: false,
        providerCallsEnabled: false,
        upgradeRequired: true,
        message:
          'Free testing mode is active. No AI provider call or AI charge can occur; all non-AI BusinessOS work continues normally.',
        freeCapabilities,
        upgradeCapabilities,
      };
    }

    if (!providerConfigured) {
      return {
        plan: 'AI_ENABLED',
        state: 'CONFIGURATION_REQUIRED',
        commandAvailable: false,
        providerCallsEnabled: false,
        upgradeRequired: false,
        message:
          'AI access is enabled, but the server-side provider configuration is incomplete. No AI provider call can occur.',
        freeCapabilities,
        upgradeCapabilities,
      };
    }

    return {
      plan: 'AI_ENABLED',
      state: 'READY',
      commandAvailable: true,
      providerCallsEnabled: true,
      upgradeRequired: false,
      message:
        'Governed AI generation is enabled. Provider usage may incur charges under the configured provider account.',
      freeCapabilities,
      upgradeCapabilities,
    };
  }

  getWorkspace(
    conversationId: string | undefined,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MyAiWorkspaceView> {
    const availability = this.aiAvailability();

    return this.runSafely('workspace.read', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const identity = await this.loadIdentity(transaction, context);
        const workload = await this.loadWorkload(transaction, context);
        const conversations = await transaction.$queryRaw<ConversationRow[]>`
          SELECT
            conversation.id,
            conversation.title,
            conversation.status::text AS status,
            conversation.last_message_at AS "lastMessageAt",
            conversation.created_at AS "createdAt"
          FROM public.agent_conversations AS conversation
          WHERE conversation.organisation_id = ${context.organisationId}::uuid
            AND conversation.user_profile_id = ${context.userId}::uuid
          ORDER BY conversation.last_message_at DESC, conversation.created_at DESC
          LIMIT 20
        `;

        const activeConversationId =
          conversationId ?? conversations[0]?.id ?? null;

        if (activeConversationId) {
          const [ownedConversation] = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT conversation.id
            FROM public.agent_conversations AS conversation
            WHERE conversation.id = ${activeConversationId}::uuid
              AND conversation.organisation_id = ${context.organisationId}::uuid
              AND conversation.user_profile_id = ${context.userId}::uuid
          `;

          if (!ownedConversation) {
            throw new NotFoundException('AI conversation not found.');
          }
        }

        const messages = activeConversationId
          ? await transaction.$queryRaw<MessageRow[]>`
              SELECT message.id, message.run_id AS "runId",
                message.role::text AS role, message.content,
                message.created_at AS "createdAt"
              FROM (
                SELECT *
                FROM public.agent_messages
                WHERE organisation_id = ${context.organisationId}::uuid
                  AND user_profile_id = ${context.userId}::uuid
                  AND conversation_id = ${activeConversationId}::uuid
                ORDER BY created_at DESC
                LIMIT 50
              ) AS message
              ORDER BY message.created_at
            `
          : [];

        const actions = activeConversationId
          ? await transaction.$queryRaw<ActionRow[]>`
              SELECT
                action.id,
                action.tool_key AS "toolKey",
                action.title,
                action.summary,
                action.risk_level::text AS "riskLevel",
                CASE approval.status::text
                  WHEN 'APPROVED' THEN 'APPROVED'
                  WHEN 'REJECTED' THEN 'REJECTED'
                  WHEN 'EXPIRED' THEN 'EXPIRED'
                  WHEN 'CANCELLED' THEN 'CANCELLED'
                  WHEN 'PENDING' THEN 'PENDING_APPROVAL'
                  ELSE action.status::text
                END AS status,
                action.subject_type::text AS "subjectType",
                action.subject_id AS "subjectId",
                action.approval_request_id AS "approvalRequestId",
                approval.version AS "approvalVersion",
                action.created_at AS "createdAt"
              FROM public.agent_actions AS action
              LEFT JOIN public.approval_requests AS approval
                ON approval.id = action.approval_request_id
               AND approval.organisation_id = action.organisation_id
              WHERE action.organisation_id = ${context.organisationId}::uuid
                AND action.user_profile_id = ${context.userId}::uuid
                AND action.conversation_id = ${activeConversationId}::uuid
              ORDER BY action.created_at DESC
              LIMIT 25
            `
          : [];

        return {
          generatedAt: new Date().toISOString(),
          availability,
          identity: {
            displayName: identity.displayName,
            jobTitle: identity.jobTitle,
            agentName: identity.agentName,
            authorityCeiling: identity.authorityCeiling,
          },
          workload: workload.summary,
          conversations: conversations.map((conversation) => ({
            ...conversation,
            lastMessageAt: iso(conversation.lastMessageAt),
            createdAt: iso(conversation.createdAt),
          })),
          activeConversationId,
          messages: messages.map((message) => ({
            ...message,
            createdAt: iso(message.createdAt),
          })),
          actions: actions.map((action) => ({
            ...action,
            createdAt: iso(action.createdAt),
          })),
          suggestions: this.workspaceSuggestions(workload),
        };
      }),
    );
  }

  async runCommand(
    dto: RunMyAiCommandDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MyAiCommandResultView> {
    let prepared: PreparedRun | null = null;

    try {
      prepared = await this.runSafely('run.start', () =>
        this.prepareRun(dto, context),
      );

      const providerResult = await this.gateway.generate({
        mode: dto.mode,
        message: dto.message,
        context: prepared.context,
      });

      const completed = await this.runSafely('run.complete', () =>
        this.completeRun(prepared!, providerResult, context),
      );

      let approvalCount = 0;
      for (const action of completed.approvalCandidates) {
        try {
          const approval = await this.automationControl.createApproval(
            {
              subjectType: action.proposal.subjectType,
              subjectId: action.proposal.subjectId,
              title: action.proposal.title,
              summary: action.proposal.summary,
              actionKey: action.proposal.toolKey,
              riskLevel: action.proposal.riskLevel,
              approverUserId: action.approverUserId,
              expiresAt: new Date(
                Date.now() + 24 * 60 * 60 * 1_000,
              ).toISOString(),
              allowSelfApproval: false,
              proposedPayload: {
                ...action.proposal.payload,
                source: 'businessos-my-ai',
                agentActionId: action.id,
              },
            },
            context,
          );

          await this.attachApproval(action.id, approval.id, context);
          approvalCount += 1;
        } catch (error: unknown) {
          this.logger.warn(
            `AI proposal approval routing failed; runId=${prepared.runId}; actionId=${action.id}; errorType=${error instanceof Error ? error.name : typeof error}`,
          );
          await this.blockAction(action.id, context).catch(() => undefined);
        }
      }

      return {
        runId: prepared.runId,
        conversationId: prepared.conversationId,
        status: 'COMPLETED',
        completedAt: completed.completedAt,
        actionCount: completed.actionCount,
        approvalCount,
      };
    } catch (error: unknown) {
      if (prepared) {
        await this.failRun(prepared.runId, error, context).catch(
          (failureError: unknown) => {
            this.logger.error(
              `AI run failure evidence could not be persisted; runId=${prepared?.runId}; errorType=${failureError instanceof Error ? failureError.name : typeof failureError}`,
            );
          },
        );
      }
      throw error;
    }
  }

  private async prepareRun(
    dto: RunMyAiCommandDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<PreparedRun> {
    const availability = this.aiAvailability();
    const model = this.config.get<string>('OPENAI_AGENT_MODEL')?.trim();
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!availability.commandAvailable || !model || !apiKey) {
      throw new ServiceUnavailableException(availability.message);
    }

    const requestSha256 = createHash('sha256')
      .update(
        JSON.stringify({
          organisationId: context.organisationId,
          userId: context.userId,
          clientRequestId: dto.clientRequestId,
          conversationId: dto.conversationId ?? null,
          mode: dto.mode,
          message: dto.message,
        }),
      )
      .digest('hex');

    return this.rls.run(this.rlsContext(context), async (transaction) => {
      const identity = await this.loadIdentity(transaction, context);
      const policies = await this.loadPolicies(
        transaction,
        context,
        identity.agentProfileId,
      );
      const workload = await this.loadWorkload(transaction, context);

      let conversationId = dto.conversationId;
      if (conversationId) {
        const [conversation] = await transaction.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT id
          FROM public.agent_conversations
          WHERE id = ${conversationId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND user_profile_id = ${context.userId}::uuid
            AND status = 'ACTIVE'
        `;
        if (!conversation)
          throw new NotFoundException('AI conversation not found.');
      } else {
        const [conversation] = await transaction.$queryRaw<
          Array<{ id: string }>
        >`
          INSERT INTO public.agent_conversations(
            organisation_id, user_profile_id, agent_profile_id, title
          ) VALUES (
            ${context.organisationId}::uuid,
            ${context.userId}::uuid,
            ${identity.agentProfileId}::uuid,
            ${safeConversationTitle(dto.message, dto.mode)}
          )
          RETURNING id
        `;
        if (!conversation) {
          throw new InternalServerErrorException(
            'AI conversation could not be created.',
          );
        }
        conversationId = conversation.id;
      }

      const historyRows = await transaction.$queryRaw<
        Array<{ role: 'USER' | 'ASSISTANT'; content: string }>
      >`
        SELECT history.role::text AS role, history.content
        FROM (
          SELECT role, content, created_at
          FROM public.agent_messages
          WHERE organisation_id = ${context.organisationId}::uuid
            AND user_profile_id = ${context.userId}::uuid
            AND conversation_id = ${conversationId}::uuid
          ORDER BY created_at DESC
          LIMIT 8
        ) AS history
        ORDER BY history.created_at
      `;

      const [run] = await transaction.$queryRaw<RunRow[]>`
        INSERT INTO public.agent_runs(
          organisation_id, user_profile_id, conversation_id,
          agent_profile_id, client_request_id, mode, status, model,
          request_sha256
        ) VALUES (
          ${context.organisationId}::uuid,
          ${context.userId}::uuid,
          ${conversationId}::uuid,
          ${identity.agentProfileId}::uuid,
          ${dto.clientRequestId}::uuid,
          ${dto.mode}::public.agent_run_mode,
          'RUNNING',
          ${model},
          ${requestSha256}
        )
        RETURNING id, conversation_id AS "conversationId"
      `;
      if (!run) {
        throw new InternalServerErrorException('AI run could not be started.');
      }

      await transaction.$executeRaw`
        INSERT INTO public.agent_messages(
          organisation_id, user_profile_id, conversation_id,
          run_id, role, content, structured_content
        ) VALUES (
          ${context.organisationId}::uuid,
          ${context.userId}::uuid,
          ${conversationId}::uuid,
          ${run.id}::uuid,
          'USER',
          ${dto.message},
          ${JSON.stringify({ mode: dto.mode })}::jsonb
        )
      `;

      await transaction.$executeRaw`
        UPDATE public.agent_conversations
        SET last_message_at = pg_catalog.now(),
            updated_at = pg_catalog.now(),
            version = version + 1
        WHERE id = ${conversationId}::uuid
          AND organisation_id = ${context.organisationId}::uuid
          AND user_profile_id = ${context.userId}::uuid
      `;

      await transaction.$executeRaw`
        INSERT INTO public.audit_events(
          id, organisation_id, actor_type, actor_user_profile_id,
          source, action, resource_type, resource_id, outcome, metadata
        ) VALUES (
          pg_catalog.gen_random_uuid(),
          ${context.organisationId}::uuid,
          'USER',
          ${context.userId}::uuid,
          'businessos-api',
          'ai.run.started',
          'agent_run',
          ${run.id},
          'SUCCESS',
          ${JSON.stringify({ mode: dto.mode, conversationId })}::jsonb
        )
      `;

      return {
        runId: run.id,
        conversationId,
        context: {
          identity,
          policies,
          workload,
          history: historyRows.map((history) => ({
            role: history.role,
            content: history.content.slice(0, 6_000),
          })),
        },
      };
    });
  }

  private async completeRun(
    prepared: PreparedRun,
    provider: MyAiProviderResult,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<CompletedRun> {
    return this.rls.run(this.rlsContext(context), async (transaction) => {
      const [completedRun] = await transaction.$queryRaw<RunRow[]>`
        UPDATE public.agent_runs
        SET status = 'COMPLETED',
            model = ${provider.model},
            provider_response_id = ${provider.responseId},
            provider_request_id = ${provider.requestId},
            latency_ms = ${provider.latencyMs},
            completed_at = pg_catalog.now(),
            updated_at = pg_catalog.now(),
            version = version + 1
        WHERE id = ${prepared.runId}::uuid
          AND organisation_id = ${context.organisationId}::uuid
          AND user_profile_id = ${context.userId}::uuid
          AND status = 'RUNNING'
        RETURNING id, conversation_id AS "conversationId",
          completed_at AS "completedAt"
      `;
      if (!completedRun?.completedAt) {
        throw new ConflictException('The AI run is no longer available.');
      }

      await transaction.$executeRaw`
        INSERT INTO public.agent_messages(
          organisation_id, user_profile_id, conversation_id,
          run_id, role, content, structured_content
        ) VALUES (
          ${context.organisationId}::uuid,
          ${context.userId}::uuid,
          ${prepared.conversationId}::uuid,
          ${prepared.runId}::uuid,
          'ASSISTANT',
          ${provider.output.answer},
          ${JSON.stringify({
            summary: provider.output.summary,
            followUpQuestions: provider.output.followUpQuestions,
            suggestedActions: provider.output.suggestedActions,
          })}::jsonb
        )
      `;

      await transaction.$executeRaw`
        INSERT INTO public.agent_usage(
          organisation_id, user_profile_id, run_id, model,
          input_tokens, cached_input_tokens, output_tokens, total_tokens
        ) VALUES (
          ${context.organisationId}::uuid,
          ${context.userId}::uuid,
          ${prepared.runId}::uuid,
          ${provider.model},
          ${provider.usage.inputTokens},
          ${provider.usage.cachedInputTokens},
          ${provider.usage.outputTokens},
          ${provider.usage.totalTokens}
        )
      `;

      const policyByTool = new Map(
        prepared.context.policies.map((policy) => [policy.toolKey, policy]),
      );
      const actionCountByTool = new Map<string, number>();
      const approvalCandidates: StoredAction[] = [];
      let actionCount = 0;

      for (const proposal of provider.output.suggestedActions) {
        const policy = policyByTool.get(proposal.toolKey);
        const existingToolActionCount =
          actionCountByTool.get(proposal.toolKey) ?? 0;
        const validPolicy =
          policy &&
          profileAllowsPolicy(prepared.context.identity, policy) &&
          existingToolActionCount < Math.min(policy.maxActionsPerRun, 5) &&
          MY_AI_ACTION_TOOL_KEYS.includes(
            proposal.toolKey as MyAiActionToolKey,
          );

        const [subjectAccess] = validPolicy
          ? await transaction.$queryRaw<Array<{ allowed: boolean }>>`
              SELECT private.can_read_automation_subject(
                ${context.organisationId}::uuid,
                ${proposal.subjectType}::public.automation_subject_type,
                ${proposal.subjectId}::uuid
              ) AS allowed
            `
          : [];
        const validSubject =
          subjectAccess?.allowed === true &&
          supportsSubject(proposal.toolKey, proposal.subjectType);

        if (!validPolicy || !validSubject) {
          await transaction.$executeRaw`
            INSERT INTO public.agent_tool_calls(
              organisation_id, user_profile_id, run_id, tool_key,
              status, arguments, result_summary, error_code
            ) VALUES (
              ${context.organisationId}::uuid,
              ${context.userId}::uuid,
              ${prepared.runId}::uuid,
              ${proposal.toolKey},
              'DENIED',
              ${JSON.stringify({
                subjectType: proposal.subjectType,
                subjectId: proposal.subjectId,
              })}::jsonb,
              '{}'::jsonb,
              ${!validPolicy ? 'POLICY_DENIED' : 'SUBJECT_DENIED'}
            )
          `;
          continue;
        }

        await transaction.$executeRaw`
          INSERT INTO public.agent_tool_calls(
            organisation_id, user_profile_id, run_id, tool_key,
            status, arguments, result_summary
          ) VALUES (
            ${context.organisationId}::uuid,
            ${context.userId}::uuid,
            ${prepared.runId}::uuid,
            ${proposal.toolKey},
            'SUCCEEDED',
            ${JSON.stringify({
              subjectType: proposal.subjectType,
              subjectId: proposal.subjectId,
              payload: proposal.payload,
            })}::jsonb,
            ${JSON.stringify({ validation: 'accepted-as-proposal' })}::jsonb
          )
        `;

        const approverUserId = prepared.context.identity.approverUserId;
        const [action] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.agent_actions(
            organisation_id, user_profile_id, conversation_id, run_id,
            tool_key, required_permission_key, subject_type, subject_id,
            title, summary, risk_level, proposed_payload,
            status, blocked_reason
          ) VALUES (
            ${context.organisationId}::uuid,
            ${context.userId}::uuid,
            ${prepared.conversationId}::uuid,
            ${prepared.runId}::uuid,
            ${proposal.toolKey},
            ${policy.requiredPermissionKey},
            ${proposal.subjectType}::public.automation_subject_type,
            ${proposal.subjectId}::uuid,
            ${proposal.title},
            ${proposal.summary},
            ${proposal.riskLevel}::public.approval_risk_level,
            ${JSON.stringify(proposal.payload)}::jsonb,
            ${approverUserId ? 'PROPOSED' : 'BLOCKED'}::public.agent_action_status,
            ${approverUserId ? null : 'No independent AAL2 approver is configured.'}
          )
          RETURNING id
        `;
        if (!action) {
          throw new InternalServerErrorException(
            'An AI proposal could not be recorded.',
          );
        }

        actionCount += 1;
        actionCountByTool.set(proposal.toolKey, existingToolActionCount + 1);
        if (approverUserId) {
          approvalCandidates.push({
            id: action.id,
            proposal,
            policy,
            approverUserId,
          });
        }
      }

      await transaction.$executeRaw`
        UPDATE public.agent_conversations
        SET last_message_at = pg_catalog.now(),
            updated_at = pg_catalog.now(),
            version = version + 1
        WHERE id = ${prepared.conversationId}::uuid
          AND organisation_id = ${context.organisationId}::uuid
          AND user_profile_id = ${context.userId}::uuid
      `;

      await transaction.$executeRaw`
        INSERT INTO public.audit_events(
          id, organisation_id, actor_type, actor_user_profile_id,
          source, action, resource_type, resource_id, outcome, metadata
        ) VALUES (
          pg_catalog.gen_random_uuid(),
          ${context.organisationId}::uuid,
          'AI_AGENT',
          ${context.userId}::uuid,
          'businessos-api',
          'ai.run.completed',
          'agent_run',
          ${prepared.runId},
          'SUCCESS',
          ${JSON.stringify({
            model: provider.model,
            providerResponseId: provider.responseId,
            actionCount,
            inputTokens: provider.usage.inputTokens,
            outputTokens: provider.usage.outputTokens,
            store: false,
          })}::jsonb
        )
      `;

      return {
        completedAt: iso(completedRun.completedAt),
        actionCount,
        approvalCandidates,
      };
    });
  }

  private async attachApproval(
    actionId: string,
    approvalId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<void> {
    await this.rls.run(this.rlsContext(context), async (transaction) => {
      const changed = await transaction.$executeRaw`
        UPDATE public.agent_actions
        SET approval_request_id = ${approvalId}::uuid,
            status = 'PENDING_APPROVAL',
            blocked_reason = NULL,
            updated_at = pg_catalog.now(),
            version = version + 1
        WHERE id = ${actionId}::uuid
          AND organisation_id = ${context.organisationId}::uuid
          AND user_profile_id = ${context.userId}::uuid
          AND status = 'PROPOSED'
          AND approval_request_id IS NULL
      `;
      if (changed !== 1) {
        throw new ConflictException('The AI proposal changed during approval.');
      }
    });
  }

  private async blockAction(
    actionId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<void> {
    await this.rls.run(
      this.rlsContext(context),
      (transaction) =>
        transaction.$executeRaw`
        UPDATE public.agent_actions
        SET status = 'BLOCKED',
            blocked_reason = 'Approval routing failed. Ask an administrator to review the approval configuration.',
            updated_at = pg_catalog.now(),
            version = version + 1
        WHERE id = ${actionId}::uuid
          AND organisation_id = ${context.organisationId}::uuid
          AND user_profile_id = ${context.userId}::uuid
          AND status = 'PROPOSED'
          AND approval_request_id IS NULL
      `,
    );
  }

  private async failRun(
    runId: string,
    error: unknown,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<void> {
    const errorCode =
      error instanceof ServiceUnavailableException
        ? 'PROVIDER_NOT_CONFIGURED'
        : error instanceof HttpException && error.getStatus() === 502
          ? 'PROVIDER_FAILURE'
          : 'RUN_FAILED';

    await this.rls.run(this.rlsContext(context), async (transaction) => {
      const changed = await transaction.$executeRaw`
        UPDATE public.agent_runs
        SET status = 'FAILED',
            error_code = ${errorCode},
            error_detail = 'The AI run failed safely. No action was taken.',
            failed_at = pg_catalog.now(),
            updated_at = pg_catalog.now(),
            version = version + 1
        WHERE id = ${runId}::uuid
          AND organisation_id = ${context.organisationId}::uuid
          AND user_profile_id = ${context.userId}::uuid
          AND status = 'RUNNING'
      `;

      if (changed === 1) {
        await transaction.$executeRaw`
          INSERT INTO public.audit_events(
            id, organisation_id, actor_type, actor_user_profile_id,
            source, action, resource_type, resource_id, outcome, metadata
          ) VALUES (
            pg_catalog.gen_random_uuid(),
            ${context.organisationId}::uuid,
            'AI_AGENT',
            ${context.userId}::uuid,
            'businessos-api',
            'ai.run.failed',
            'agent_run',
            ${runId},
            'FAILURE',
            ${JSON.stringify({ errorCode, noActionTaken: true })}::jsonb
          )
        `;
      }
    });
  }

  private async loadIdentity(
    transaction: Prisma.TransactionClient,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<AgentIdentityContext> {
    const [identity] = await transaction.$queryRaw<IdentityRow[]>`
      WITH active_assignment AS (
        SELECT assignment.*
        FROM public.workforce_assignments AS assignment
        WHERE assignment.organisation_id = ${context.organisationId}::uuid
          AND assignment.organisation_membership_id = ${context.membershipId}::uuid
          AND assignment.status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND assignment.starts_at <= pg_catalog.now()
          AND (assignment.ends_at IS NULL OR assignment.ends_at > pg_catalog.now())
        ORDER BY assignment.is_primary DESC, assignment.starts_at DESC
        LIMIT 1
      ),
      selected_profile AS (
        SELECT profile.*
        FROM public.agent_profiles AS profile
        LEFT JOIN active_assignment AS assignment ON true
        WHERE profile.organisation_id = ${context.organisationId}::uuid
          AND profile.is_active = true
          AND profile.deleted_at IS NULL
          AND (
            profile.id = assignment.agent_profile_id
            OR profile.key = 'personal-ai-default'
          )
        ORDER BY
          CASE WHEN profile.id = assignment.agent_profile_id THEN 0 ELSE 1 END,
          profile.updated_at DESC
        LIMIT 1
      )
      SELECT
        COALESCE(
          NULLIF(pg_catalog.btrim(profile.display_name), ''),
          NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', profile.first_name, profile.last_name)), ''),
          profile.email,
          'Authorised employee'
        ) AS "displayName",
        COALESCE(assignment.job_title, membership.job_title) AS "jobTitle",
        COALESCE((
          SELECT pg_catalog.array_agg(DISTINCT role_record.name ORDER BY role_record.name)
          FROM public.role_assignments AS role_assignment
          JOIN public.roles AS role_record ON role_record.id = role_assignment.role_id
          WHERE role_assignment.organisation_id = ${context.organisationId}::uuid
            AND role_assignment.organisation_membership_id = ${context.membershipId}::uuid
            AND role_assignment.user_profile_id = ${context.userId}::uuid
            AND role_assignment.revoked_at IS NULL
            AND role_assignment.deleted_at IS NULL
            AND role_assignment.valid_from <= pg_catalog.now()
            AND (role_assignment.valid_until IS NULL OR role_assignment.valid_until > pg_catalog.now())
            AND role_record.deleted_at IS NULL
        ), ARRAY[]::text[]) AS roles,
        agent_profile.id AS "agentProfileId",
        COALESCE(agent_profile.name, 'BusinessOS Personal AI') AS "agentName",
        COALESCE(
          agent_profile.behaviour_instructions,
          'Use only permission-filtered records. Draft and propose; never execute.'
        ) AS "behaviourInstructions",
        COALESCE(agent_profile.authority_ceiling::text, 'PROPOSE') AS "authorityCeiling",
        COALESCE(agent_profile.requires_human_review, true) AS "requiresHumanReview",
        COALESCE(
          (
            SELECT manager.user_profile_id
            FROM public.organisation_memberships AS manager
            WHERE manager.id = assignment.manager_organisation_membership_id
              AND manager.organisation_id = ${context.organisationId}::uuid
              AND manager.user_profile_id <> ${context.userId}::uuid
              AND manager.status = 'ACTIVE'
              AND manager.deleted_at IS NULL
            LIMIT 1
          ),
          (
            SELECT candidate.user_profile_id
            FROM public.organisation_memberships AS candidate
            JOIN public.role_assignments AS candidate_assignment
              ON candidate_assignment.organisation_membership_id = candidate.id
             AND candidate_assignment.organisation_id = candidate.organisation_id
             AND candidate_assignment.user_profile_id = candidate.user_profile_id
            JOIN public.roles AS candidate_role
              ON candidate_role.id = candidate_assignment.role_id
             AND candidate_role.organisation_id = candidate.organisation_id
            JOIN public.role_permissions AS candidate_role_permission
              ON candidate_role_permission.role_id = candidate_role.id
            JOIN public.permissions AS candidate_permission
              ON candidate_permission.id = candidate_role_permission.permission_id
            WHERE candidate.organisation_id = ${context.organisationId}::uuid
              AND candidate.user_profile_id <> ${context.userId}::uuid
              AND candidate.status = 'ACTIVE'
              AND candidate.deleted_at IS NULL
              AND candidate_assignment.revoked_at IS NULL
              AND candidate_assignment.deleted_at IS NULL
              AND candidate_assignment.valid_from <= pg_catalog.now()
              AND (candidate_assignment.valid_until IS NULL OR candidate_assignment.valid_until > pg_catalog.now())
              AND candidate_role.deleted_at IS NULL
              AND candidate_permission.key = 'approvals.decide'
              AND candidate_permission.is_active = true
              AND candidate_permission.deleted_at IS NULL
            ORDER BY CASE candidate_role.key
              WHEN 'organisation_owner' THEN 0
              WHEN 'system_administrator' THEN 1
              WHEN 'compliance_manager' THEN 2
              WHEN 'case_manager' THEN 3
              ELSE 4
            END, candidate.joined_at NULLS LAST, candidate.created_at
            LIMIT 1
          )
        ) AS "approverUserId"
      FROM public.user_profiles AS profile
      JOIN public.organisation_memberships AS membership
        ON membership.id = ${context.membershipId}::uuid
       AND membership.organisation_id = ${context.organisationId}::uuid
       AND membership.user_profile_id = profile.id
      LEFT JOIN active_assignment AS assignment ON true
      LEFT JOIN selected_profile AS agent_profile ON true
      WHERE profile.id = ${context.userId}::uuid
        AND profile.status = 'ACTIVE'
        AND profile.deleted_at IS NULL
        AND membership.status = 'ACTIVE'
        AND membership.deleted_at IS NULL
    `;

    if (!identity) {
      throw new ForbiddenException('The employee AI workspace is unavailable.');
    }
    return identity;
  }

  private async loadPolicies(
    transaction: Prisma.TransactionClient,
    context: Readonly<OrganisationAccessContext>,
    agentProfileId: string | null,
  ): Promise<AgentPolicyContext[]> {
    if (!agentProfileId) return [];

    return transaction.$queryRaw<AgentPolicyContext[]>`
      SELECT
        policy.tool_key AS "toolKey",
        policy.required_permission_key AS "requiredPermissionKey",
        policy.authority_level::text AS "authorityLevel",
        policy.maximum_data_scope::text AS "maximumDataScope",
        policy.requires_approval AS "requiresApproval",
        policy.requires_mfa AS "requiresMfa",
        policy.max_actions_per_run AS "maxActionsPerRun"
      FROM public.agent_policies AS policy
      JOIN public.permissions AS permission
        ON permission.key = policy.required_permission_key
      WHERE policy.organisation_id = ${context.organisationId}::uuid
        AND policy.agent_profile_id = ${agentProfileId}::uuid
        AND policy.is_active = true
        AND policy.deleted_at IS NULL
        AND permission.allows_ai_use = true
        AND permission.is_active = true
        AND permission.deleted_at IS NULL
        AND private.has_organisation_permission(
          ${context.organisationId}::uuid,
          policy.required_permission_key
        )
      ORDER BY policy.tool_key
    `;
  }

  private async loadWorkload(
    transaction: Prisma.TransactionClient,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkloadContext> {
    const [summary] = await transaction.$queryRaw<WorkloadSummaryRow[]>`
      SELECT
        (SELECT pg_catalog.count(*)::integer
          FROM public.matter_tasks AS task
          JOIN public.matters AS matter
            ON matter.id = task.matter_id
           AND matter.organisation_id = task.organisation_id
          WHERE task.organisation_id = ${context.organisationId}::uuid
            AND task.status NOT IN ('COMPLETED', 'CANCELLED')
            AND task.deleted_at IS NULL
            AND matter.deleted_at IS NULL
            AND (task.assigned_to_user_id = ${context.userId}::uuid
              OR (task.assigned_to_user_id IS NULL
                AND matter.assigned_to_user_id = ${context.userId}::uuid))
            AND private.can_read_matter(task.organisation_id, task.matter_id)
        ) AS "openTasks",
        (SELECT pg_catalog.count(*)::integer
          FROM public.matter_tasks AS task
          JOIN public.matters AS matter
            ON matter.id = task.matter_id
           AND matter.organisation_id = task.organisation_id
          WHERE task.organisation_id = ${context.organisationId}::uuid
            AND task.status NOT IN ('COMPLETED', 'CANCELLED')
            AND task.due_at < pg_catalog.now()
            AND task.deleted_at IS NULL
            AND matter.deleted_at IS NULL
            AND (task.assigned_to_user_id = ${context.userId}::uuid
              OR (task.assigned_to_user_id IS NULL
                AND matter.assigned_to_user_id = ${context.userId}::uuid))
            AND private.can_read_matter(task.organisation_id, task.matter_id)
        ) AS "overdueTasks",
        (SELECT pg_catalog.count(*)::integer
          FROM public.matter_deadlines AS deadline
          JOIN public.matters AS matter
            ON matter.id = deadline.matter_id
           AND matter.organisation_id = deadline.organisation_id
          WHERE deadline.organisation_id = ${context.organisationId}::uuid
            AND deadline.status = 'OPEN'
            AND deadline.due_at <= pg_catalog.now() + interval '7 days'
            AND deadline.deleted_at IS NULL
            AND matter.deleted_at IS NULL
            AND (deadline.owner_user_id = ${context.userId}::uuid
              OR (deadline.owner_user_id IS NULL
                AND matter.assigned_to_user_id = ${context.userId}::uuid))
            AND private.can_read_matter(deadline.organisation_id, deadline.matter_id)
        ) AS "deadlinesNextSevenDays",
        (SELECT pg_catalog.count(*)::integer
          FROM public.enquiries AS enquiry
          WHERE enquiry.organisation_id = ${context.organisationId}::uuid
            AND enquiry.assigned_to_user_id = ${context.userId}::uuid
            AND enquiry.status NOT IN ('CONVERTED', 'CLOSED', 'SPAM')
            AND enquiry.deleted_at IS NULL
        ) AS "assignedEnquiries",
        (SELECT pg_catalog.count(*)::integer
          FROM public.matters AS matter
          WHERE matter.organisation_id = ${context.organisationId}::uuid
            AND (matter.assigned_to_user_id = ${context.userId}::uuid
              OR matter.supervisor_user_id = ${context.userId}::uuid)
            AND matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
            AND matter.deleted_at IS NULL
            AND private.can_read_matter(matter.organisation_id, matter.id)
        ) AS "activeMatters",
        (SELECT pg_catalog.count(*)::integer
          FROM public.approval_requests AS approval
          WHERE approval.organisation_id = ${context.organisationId}::uuid
            AND approval.status = 'PENDING'
            AND approval.expires_at > pg_catalog.now()
            AND (
              approval.approver_user_id = ${context.userId}::uuid
              OR EXISTS (
                SELECT 1
                FROM public.team_memberships AS team_membership
                JOIN public.organisation_memberships AS member
                  ON member.id = team_membership.organisation_membership_id
                 AND member.organisation_id = team_membership.organisation_id
                WHERE team_membership.organisation_id = approval.organisation_id
                  AND team_membership.team_id = approval.approver_team_id
                  AND member.user_profile_id = ${context.userId}::uuid
                  AND member.status = 'ACTIVE'
                  AND member.deleted_at IS NULL
                  AND team_membership.deleted_at IS NULL
              )
            )
        ) AS "pendingApprovals"
    `;

    if (!summary) {
      throw new InternalServerErrorException(
        'The employee workload could not be calculated.',
      );
    }

    const tasks = await transaction.$queryRaw<TaskRow[]>`
      SELECT task.id, task.matter_id AS "matterId",
        matter.title AS "matterTitle", task.title,
        task.status::text AS status, task.priority::text AS priority,
        task.due_at AS "dueAt"
      FROM public.matter_tasks AS task
      JOIN public.matters AS matter
        ON matter.id = task.matter_id
       AND matter.organisation_id = task.organisation_id
      WHERE task.organisation_id = ${context.organisationId}::uuid
        AND task.status NOT IN ('COMPLETED', 'CANCELLED')
        AND task.deleted_at IS NULL
        AND matter.deleted_at IS NULL
        AND (task.assigned_to_user_id = ${context.userId}::uuid
          OR (task.assigned_to_user_id IS NULL
            AND matter.assigned_to_user_id = ${context.userId}::uuid))
        AND private.can_read_matter(task.organisation_id, task.matter_id)
      ORDER BY task.due_at NULLS LAST, task.priority DESC, task.created_at
      LIMIT 10
    `;

    const deadlines = await transaction.$queryRaw<DeadlineRow[]>`
      SELECT deadline.id, deadline.matter_id AS "matterId",
        matter.title AS "matterTitle", deadline.title,
        deadline.due_at AS "dueAt", deadline.is_critical AS "isCritical"
      FROM public.matter_deadlines AS deadline
      JOIN public.matters AS matter
        ON matter.id = deadline.matter_id
       AND matter.organisation_id = deadline.organisation_id
      WHERE deadline.organisation_id = ${context.organisationId}::uuid
        AND deadline.status = 'OPEN'
        AND deadline.deleted_at IS NULL
        AND matter.deleted_at IS NULL
        AND (deadline.owner_user_id = ${context.userId}::uuid
          OR (deadline.owner_user_id IS NULL
            AND matter.assigned_to_user_id = ${context.userId}::uuid))
        AND private.can_read_matter(deadline.organisation_id, deadline.matter_id)
      ORDER BY deadline.due_at, deadline.is_critical DESC
      LIMIT 10
    `;

    const records = await transaction.$queryRaw<RecordRow[]>`
      SELECT * FROM (
        SELECT 'ENQUIRY'::text AS "subjectType", enquiry.id AS "subjectId",
          COALESCE(
            NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', enquiry.first_name, enquiry.last_name)), ''),
            COALESCE(enquiry.service_type, 'Enquiry')
          ) AS label,
          enquiry.status::text AS status,
          enquiry.priority::text AS priority,
          enquiry.next_follow_up_at AS "nextActionAt"
        FROM public.enquiries AS enquiry
        WHERE enquiry.organisation_id = ${context.organisationId}::uuid
          AND enquiry.assigned_to_user_id = ${context.userId}::uuid
          AND enquiry.status NOT IN ('CONVERTED', 'CLOSED', 'SPAM')
          AND enquiry.deleted_at IS NULL
        UNION ALL
        SELECT 'MATTER'::text AS "subjectType", matter.id AS "subjectId",
          matter.title AS label, matter.status::text AS status,
          matter.priority::text AS priority,
          COALESCE(matter.next_action_at, matter.critical_deadline_at) AS "nextActionAt"
        FROM public.matters AS matter
        WHERE matter.organisation_id = ${context.organisationId}::uuid
          AND (matter.assigned_to_user_id = ${context.userId}::uuid
            OR matter.supervisor_user_id = ${context.userId}::uuid)
          AND matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
          AND matter.deleted_at IS NULL
          AND private.can_read_matter(matter.organisation_id, matter.id)
      ) AS record
      ORDER BY record."nextActionAt" NULLS LAST, record.priority DESC
      LIMIT 12
    `;

    return {
      summary,
      tasks: tasks.map((task) => ({
        ...task,
        dueAt: task.dueAt === null ? null : iso(task.dueAt),
      })),
      deadlines: deadlines.map((deadline) => ({
        ...deadline,
        dueAt: iso(deadline.dueAt),
      })),
      records: records.map((record) => ({
        ...record,
        nextActionAt: nullableIso(record.nextActionAt),
      })),
    };
  }

  private workspaceSuggestions(workload: WorkloadContext): string[] {
    const suggestions: string[] = [];
    if (workload.summary.overdueTasks > 0) {
      suggestions.push('Prioritise my overdue tasks and explain the risk.');
    }
    if (workload.summary.deadlinesNextSevenDays > 0) {
      suggestions.push('Prepare a seven-day deadline plan for my workload.');
    }
    if (workload.summary.assignedEnquiries > 0) {
      suggestions.push('Which assigned enquiries need attention first?');
    }
    suggestions.push(
      'Prepare my daily brief with the three most important next steps.',
    );
    return [...new Set(suggestions)].slice(0, 4);
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private async runSafely<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;

      const code = postgresCode(error);
      if (code === '42501') {
        throw new ForbiddenException(
          'You do not have permission to use this AI capability.',
        );
      }
      if (code === 'P0002') throw new NotFoundException('AI record not found.');
      if (code === '23505') {
        throw new ConflictException(
          'This AI command was already accepted. Refresh the workspace.',
        );
      }
      if (code === '40001') {
        throw new ConflictException(
          'The AI record changed. Refresh and try again.',
        );
      }
      if (['22023', '23503', '23514'].includes(code ?? '')) {
        throw new BadRequestException(
          'The AI request could not be accepted safely.',
        );
      }

      this.logger.error(
        `Personal AI operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The personal AI service is temporarily unavailable.',
      );
    }
  }
}
