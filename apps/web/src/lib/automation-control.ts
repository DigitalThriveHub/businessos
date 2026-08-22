import { z } from "zod";

export const AUTOMATION_SUBJECT_TYPES = [
  "ENQUIRY",
  "CLIENT",
  "MATTER",
] as const;

export const WORK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const WORKFLOW_ACTION_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
] as const;
export const WORKFLOW_RUN_STATUSES = [
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
] as const;
export const SLA_INSTANCE_STATUSES = [
  "ACTIVE",
  "AT_RISK",
  "BREACHED",
  "SATISFIED",
  "CANCELLED",
] as const;
export const ESCALATION_EVENT_STATUSES = [
  "RECORDED",
  "ACKNOWLEDGED",
  "RESOLVED",
] as const;
export const APPROVAL_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export const APPROVAL_RISK_LEVELS = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;

export const automationSubjectTypeSchema = z.enum(AUTOMATION_SUBJECT_TYPES);
export const workPrioritySchema = z.enum(WORK_PRIORITIES);
export const workflowActionStatusSchema = z.enum(WORKFLOW_ACTION_STATUSES);
export const workflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);
export const slaInstanceStatusSchema = z.enum(SLA_INSTANCE_STATUSES);
export const escalationEventStatusSchema = z.enum(
  ESCALATION_EVENT_STATUSES,
);
export const approvalRequestStatusSchema = z.enum(APPROVAL_REQUEST_STATUSES);
export const approvalRiskLevelSchema = z.enum(APPROVAL_RISK_LEVELS);
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);

const uuid = z.string().uuid();
const version = z.number().int().positive();
const nullableUuid = uuid.nullable();
const nullableText = z.string().nullable();
const nullableDateTime = z.string().datetime().nullable();

export const automationSummarySchema = z.object({
  readyWorkItems: z.number().int().nonnegative(),
  atRiskSlas: z.number().int().nonnegative(),
  breachedSlas: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  openEscalations: z.number().int().nonnegative(),
});

export const automationWorkItemSchema = z.object({
  id: uuid,
  workflowRunId: uuid,
  workflowName: z.string(),
  actionKey: z.string(),
  title: z.string(),
  description: nullableText,
  status: workflowActionStatusSchema,
  priority: workPrioritySchema,
  ownerUserId: nullableUuid,
  ownerName: nullableText,
  dueAt: nullableDateTime,
  version,
  subjectType: automationSubjectTypeSchema,
  subjectId: uuid,
  subjectLabel: z.string(),
});
export type AutomationWorkItem = z.infer<typeof automationWorkItemSchema>;

export const slaInstanceSchema = z.object({
  id: uuid,
  policyName: z.string(),
  status: slaInstanceStatusSchema,
  ownerUserId: nullableUuid,
  ownerName: nullableText,
  warningAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  atRiskAt: nullableDateTime,
  breachedAt: nullableDateTime,
  version,
  subjectType: automationSubjectTypeSchema,
  subjectId: uuid,
  subjectLabel: z.string(),
});
export type SlaInstance = z.infer<typeof slaInstanceSchema>;

export const escalationSchema = z.object({
  id: uuid,
  level: z.number().int().positive(),
  actionKey: z.string(),
  status: escalationEventStatusSchema,
  occurredAt: z.string().datetime(),
  policyName: z.string(),
  subjectType: automationSubjectTypeSchema,
  subjectId: uuid,
  subjectLabel: z.string(),
});
export type Escalation = z.infer<typeof escalationSchema>;

export const approvalSchema = z.object({
  id: uuid,
  title: z.string(),
  summary: z.string(),
  actionKey: z.string(),
  riskLevel: approvalRiskLevelSchema,
  status: approvalRequestStatusSchema,
  requestedByName: nullableText,
  approverName: nullableText,
  expiresAt: z.string().datetime(),
  decidedAt: nullableDateTime,
  version,
  subjectType: automationSubjectTypeSchema,
  subjectId: uuid,
  subjectLabel: z.string(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const slaPolicySchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  targetSeconds: z.number().int().min(60).max(2_592_000),
  warningSeconds: z.number().int().min(0).max(2_592_000),
  timezone: z.string(),
  isActive: z.boolean(),
  version,
});
export type SlaPolicy = z.infer<typeof slaPolicySchema>;

export const automationControlSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: automationSummarySchema,
  workItems: z.array(automationWorkItemSchema),
  slas: z.array(slaInstanceSchema),
  escalations: z.array(escalationSchema),
  approvals: z.array(approvalSchema),
  policies: z.array(slaPolicySchema),
});
export type AutomationControl = z.infer<typeof automationControlSchema>;

export const completedWorkItemSchema = z.object({
  actionId: uuid,
  workflowRunId: uuid,
  actionStatus: workflowActionStatusSchema,
  runStatus: workflowRunStatusSchema,
  actionVersion: version,
  completedAt: z.string().datetime(),
});

export const approvalDecisionResultSchema = z.object({
  approvalRequestId: uuid,
  approvalStatus: approvalRequestStatusSchema,
  approvalVersion: version,
  decisionId: uuid,
  decidedAt: z.string().datetime(),
});

export const automationControlReadQuerySchema = z.object({
  organisationId: uuid,
});

const completeActionMutation = z.object({
  operation: z.literal("action.complete"),
  organisationId: uuid,
  actionId: uuid,
  payload: z.object({
    expectedVersion: version,
    completionNote: z.string().trim().max(2000).optional(),
  }),
});

const createApprovalMutation = z.object({
  operation: z.literal("approval.create"),
  organisationId: uuid,
  payload: z
    .object({
      subjectType: automationSubjectTypeSchema,
      subjectId: uuid,
      title: z.string().trim().min(3).max(240),
      summary: z.string().trim().min(3).max(4000),
      actionKey: z
        .string()
        .trim()
        .max(160)
        .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
      riskLevel: approvalRiskLevelSchema,
      approverUserId: uuid,
      expiresAt: z.string().datetime(),
      allowSelfApproval: z.boolean().optional(),
      proposedPayload: z.record(z.string(), z.unknown()).optional(),
      workflowRunId: uuid.optional(),
      workflowActionId: uuid.optional(),
    })
    .refine((value) => !value.workflowActionId || value.workflowRunId, {
      path: ["workflowRunId"],
      message: "A linked action requires its workflow run.",
    })
    .refine(
      (value) =>
        !value.allowSelfApproval ||
        (value.riskLevel !== "HIGH" && value.riskLevel !== "CRITICAL"),
      {
        path: ["allowSelfApproval"],
        message: "High-risk requests cannot allow self approval.",
      },
    ),
});

const decideApprovalMutation = z.object({
  operation: z.literal("approval.decide"),
  organisationId: uuid,
  approvalId: uuid,
  payload: z.object({
    expectedVersion: version,
    decision: approvalDecisionSchema,
    reason: z.string().trim().min(3).max(2000),
  }),
});

const updateSlaPolicyMutation = z.object({
  operation: z.literal("sla-policy.update"),
  organisationId: uuid,
  policyId: uuid,
  payload: z.object({
    expectedVersion: version,
    targetSeconds: z.number().int().min(60).max(2_592_000).optional(),
    warningSeconds: z.number().int().min(0).max(2_592_000).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const automationControlMutationSchema = z.discriminatedUnion(
  "operation",
  [
    completeActionMutation,
    createApprovalMutation,
    decideApprovalMutation,
    updateSlaPolicyMutation,
  ],
);
export type AutomationControlMutation = z.infer<
  typeof automationControlMutationSchema
>;
