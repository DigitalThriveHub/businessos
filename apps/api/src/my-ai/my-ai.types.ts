import { z } from 'zod';

export const MY_AI_ACTION_TOOL_KEYS = [
  'matter.task.propose',
  'matter.document-request.propose',
  'communication.draft',
  'record.escalate',
] as const;

export type MyAiActionToolKey = (typeof MY_AI_ACTION_TOOL_KEYS)[number];

export const myAiProviderOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(12_000),
    summary: z.string().trim().min(1).max(500),
    followUpQuestions: z.array(z.string().trim().min(1).max(240)).max(3),
    suggestedActions: z
      .array(
        z
          .object({
            toolKey: z.enum(MY_AI_ACTION_TOOL_KEYS),
            subjectType: z.enum(['ENQUIRY', 'CLIENT', 'MATTER']),
            subjectId: z.string().uuid(),
            title: z.string().trim().min(3).max(240),
            summary: z.string().trim().min(3).max(4_000),
            riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
            payload: z
              .object({
                dueAt: z.string().datetime({ offset: true }).nullable(),
                assigneeUserId: z.string().uuid().nullable(),
                draftText: z.string().max(4_000).nullable(),
                documentTypes: z.array(z.string().min(1).max(120)).max(20),
                targetStatus: z.string().max(80).nullable(),
                note: z.string().max(1_000).nullable(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

export type MyAiProviderOutput = z.infer<typeof myAiProviderOutputSchema>;

export interface MyAiProviderUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface MyAiProviderResult {
  responseId: string;
  requestId: string | null;
  model: string;
  latencyMs: number;
  output: MyAiProviderOutput;
  usage: MyAiProviderUsage;
}

export interface AgentPolicyContext {
  toolKey: string;
  requiredPermissionKey: string;
  authorityLevel: string;
  maximumDataScope: string;
  requiresApproval: boolean;
  requiresMfa: boolean;
  maxActionsPerRun: number;
}

export interface AgentIdentityContext {
  displayName: string;
  jobTitle: string | null;
  roles: string[];
  agentProfileId: string | null;
  agentName: string;
  behaviourInstructions: string;
  authorityCeiling: string;
  requiresHumanReview: boolean;
  approverUserId: string | null;
}

export interface WorkloadTaskContext {
  id: string;
  matterId: string;
  matterTitle: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
}

export interface WorkloadDeadlineContext {
  id: string;
  matterId: string;
  matterTitle: string;
  title: string;
  dueAt: string;
  isCritical: boolean;
}

export interface WorkloadRecordContext {
  subjectType: 'ENQUIRY' | 'MATTER';
  subjectId: string;
  label: string;
  status: string;
  priority: string;
  nextActionAt: string | null;
}

export interface WorkloadContext {
  summary: {
    openTasks: number;
    overdueTasks: number;
    deadlinesNextSevenDays: number;
    assignedEnquiries: number;
    activeMatters: number;
    pendingApprovals: number;
  };
  tasks: WorkloadTaskContext[];
  deadlines: WorkloadDeadlineContext[];
  records: WorkloadRecordContext[];
}

export interface ConversationHistoryItem {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export interface MyAiRuntimeContext {
  identity: AgentIdentityContext;
  policies: AgentPolicyContext[];
  workload: WorkloadContext;
  history: ConversationHistoryItem[];
}

export interface MyAiAvailabilityView {
  plan: 'FREE' | 'AI_ENABLED';
  state: 'FREE_MODE' | 'READY' | 'CONFIGURATION_REQUIRED';
  commandAvailable: boolean;
  providerCallsEnabled: boolean;
  upgradeRequired: boolean;
  message: string;
  freeCapabilities: string[];
  upgradeCapabilities: string[];
}

export interface MyAiWorkspaceView {
  generatedAt: string;
  availability: MyAiAvailabilityView;
  identity: {
    displayName: string;
    jobTitle: string | null;
    agentName: string;
    authorityCeiling: string;
  };
  workload: WorkloadContext['summary'];
  conversations: Array<{
    id: string;
    title: string;
    status: string;
    lastMessageAt: string;
    createdAt: string;
  }>;
  activeConversationId: string | null;
  messages: Array<{
    id: string;
    runId: string;
    role: 'USER' | 'ASSISTANT';
    content: string;
    createdAt: string;
  }>;
  actions: Array<{
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
    createdAt: string;
  }>;
  suggestions: string[];
}

export interface MyAiCommandResultView {
  runId: string;
  conversationId: string;
  status: 'COMPLETED';
  completedAt: string;
  actionCount: number;
  approvalCount: number;
}
