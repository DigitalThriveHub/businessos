import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });

export const myAiWorkspaceSchema = z.object({
  generatedAt: dateTime,
  availability: z.object({
    plan: z.enum(["FREE", "AI_ENABLED"]),
    state: z.enum(["FREE_MODE", "READY", "CONFIGURATION_REQUIRED"]),
    commandAvailable: z.boolean(),
    providerCallsEnabled: z.boolean(),
    upgradeRequired: z.boolean(),
    message: z.string().min(1).max(1_000),
    freeCapabilities: z.array(z.string().min(1).max(300)).max(8),
    upgradeCapabilities: z.array(z.string().min(1).max(300)).max(8),
  }),
  identity: z.object({
    displayName: z.string().min(1),
    jobTitle: z.string().nullable(),
    agentName: z.string().min(1),
    authorityCeiling: z.string().min(1),
  }),
  workload: z.object({
    openTasks: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
    deadlinesNextSevenDays: z.number().int().nonnegative(),
    assignedEnquiries: z.number().int().nonnegative(),
    activeMatters: z.number().int().nonnegative(),
    pendingApprovals: z.number().int().nonnegative(),
  }),
  conversations: z.array(
    z.object({
      id: uuid,
      title: z.string().min(1),
      status: z.enum(["ACTIVE", "ARCHIVED"]),
      lastMessageAt: dateTime,
      createdAt: dateTime,
    }),
  ),
  activeConversationId: uuid.nullable(),
  messages: z.array(
    z.object({
      id: uuid,
      runId: uuid,
      role: z.enum(["USER", "ASSISTANT"]),
      content: z.string().min(1),
      createdAt: dateTime,
    }),
  ),
  actions: z.array(
    z.object({
      id: uuid,
      toolKey: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().min(1),
      riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      status: z.enum([
        "PROPOSED",
        "PENDING_APPROVAL",
        "BLOCKED",
        "APPROVED",
        "REJECTED",
        "EXPIRED",
        "CANCELLED",
      ]),
      subjectType: z.enum(["ENQUIRY", "CLIENT", "MATTER"]),
      subjectId: uuid,
      approvalRequestId: uuid.nullable(),
      approvalVersion: z.number().int().positive().nullable(),
      createdAt: dateTime,
    }),
  ),
  suggestions: z.array(z.string().min(1)).max(4),
});

export type MyAiWorkspace = z.infer<typeof myAiWorkspaceSchema>;

export const myAiReadQuerySchema = z.object({
  organisationId: uuid,
  conversationId: uuid.optional(),
});

const commandPayloadSchema = z.object({
  clientRequestId: uuid,
  conversationId: uuid.optional(),
  mode: z.enum(["CHAT", "DAILY_BRIEF"]),
  message: z.string().trim().min(2).max(4_000),
});

export const myAiMutationSchema = z.object({
  operation: z.literal("command.run"),
  organisationId: uuid,
  payload: commandPayloadSchema,
});

export type MyAiMutation = z.infer<typeof myAiMutationSchema>;

export const myAiCommandResultSchema = z.object({
  runId: uuid,
  conversationId: uuid,
  status: z.literal("COMPLETED"),
  completedAt: dateTime,
  actionCount: z.number().int().nonnegative(),
  approvalCount: z.number().int().nonnegative(),
});

export type MyAiCommandResult = z.infer<typeof myAiCommandResultSchema>;
