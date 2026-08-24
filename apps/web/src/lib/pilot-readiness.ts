import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
export const pilotReadinessSchema = z.object({
  generatedAt: dateTime,
  summary: z.object({
    systemChecksReady: z.number().int().nonnegative(),
    systemChecksTotal: z.number().int().positive(),
    roleAcceptancesPassed: z.number().int().nonnegative(),
    roleAcceptancesRequired: z.number().int().positive(),
    openHighCriticalDefects: z.number().int().nonnegative(),
    readyForPilot: z.boolean(),
  }),
  systemChecks: z.array(
    z.object({
      key: z.string(),
      category: z.string(),
      title: z.string(),
      ready: z.boolean(),
      detail: z.string(),
    }),
  ),
  requiredRoles: z.array(z.string()),
  roleAcceptances: z.array(
    z.object({
      id: uuid,
      key: z.string(),
      roleName: z.string(),
      scenarioName: z.string(),
      status: z.enum(["NOT_TESTED", "PASS", "FAIL", "BLOCKED"]),
      evidenceNote: z.string().nullable(),
      evidenceReference: z.string().nullable(),
      testedAt: dateTime.nullable(),
      version: z.number().int().positive(),
    }),
  ),
  feedback: z.array(
    z.object({
      id: uuid,
      affectedRole: z.string(),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      title: z.string(),
      detail: z.string(),
      reproductionSteps: z.string(),
      status: z.enum(["OPEN", "TRIAGED", "RESOLVED", "ACCEPTED_RISK"]),
      resolution: z.string().nullable(),
      createdAt: dateTime,
      version: z.number().int().positive(),
    }),
  ),
});
export type PilotReadiness = z.infer<typeof pilotReadinessSchema>;

const organisationId = z.string().uuid();
export const pilotReadinessQuerySchema = z.object({ organisationId });
export const pilotMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("acceptance.record"),
    organisationId,
    payload: z.object({
      key: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
      roleName: z.string().min(2).max(120),
      scenarioName: z.string().min(3).max(240),
      status: z.enum(["NOT_TESTED", "PASS", "FAIL", "BLOCKED"]),
      evidenceNote: z.string().max(2000).optional(),
      evidenceReference: z.string().max(1000).optional(),
      expectedVersion: z.number().int().positive().optional(),
    }),
  }),
  z.object({
    operation: z.literal("feedback.create"),
    organisationId,
    payload: z.object({
      affectedRole: z.string().min(2).max(120),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      title: z.string().min(3).max(240),
      detail: z.string().min(10).max(4000),
      reproductionSteps: z.string().min(10).max(4000),
    }),
  }),
  z.object({
    operation: z.literal("feedback.resolve"),
    organisationId,
    feedbackId: uuid,
    payload: z.object({
      status: z.enum(["RESOLVED", "ACCEPTED_RISK"]),
      resolution: z.string().min(10).max(4000),
      expectedVersion: z.number().int().positive(),
    }),
  }),
]);
