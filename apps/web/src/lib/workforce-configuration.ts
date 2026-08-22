import { z } from "zod";

export const KPI_VALUE_TYPES = [
  "NUMBER",
  "PERCENTAGE",
  "CURRENCY",
  "DURATION_SECONDS",
  "RATING",
] as const;

export const KPI_DIRECTIONS = [
  "HIGHER_IS_BETTER",
  "LOWER_IS_BETTER",
  "TARGET_RANGE",
] as const;

export const KPI_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
  "CASE_BASED",
] as const;

export const AGENT_AUTHORITY_LEVELS = [
  "DISABLED",
  "READ",
  "DRAFT",
  "PROPOSE",
  "EXECUTE_WITH_APPROVAL",
  "EXECUTE_AUTOMATIC",
] as const;

export const PERMISSION_DATA_SCOPES = [
  "OWN",
  "ASSIGNED",
  "TEAM",
  "DEPARTMENT",
  "ORGANISATION",
  "SHARED",
  "PLATFORM",
] as const;

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const configurationKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const decimalSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(?:\.\d{1,4})?$/);
const optionalDecimalSchema = decimalSchema.nullable().optional();
const optionalIdSchema = idSchema.nullable().optional();
const nullableIdSchema = idSchema.nullable();
const optionalTextSchema = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();
const nullableTextSchema = (maximum: number) =>
  z.string().trim().max(maximum).nullable();

export const workforceConfigurationQuerySchema = z
  .object({ organisationId: idSchema })
  .strict();

export const workforceDepartmentSchema = z
  .object({
    id: idSchema,
    parentId: idSchema.nullable(),
    name: z.string().min(1).max(160),
    code: z.string().max(50).nullable(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

export const workforceTeamSchema = z
  .object({
    id: idSchema,
    departmentId: idSchema.nullable(),
    name: z.string().min(1).max(160),
    code: z.string().max(50).nullable(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

export const jobProfileDutySchema = z
  .object({
    id: idSchema,
    code: configurationKeySchema,
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    position: z.number().int().min(1).max(32_767),
    isCritical: z.boolean(),
    requiresEvidence: z.boolean(),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

export const jobProfileKpiSchema = z
  .object({
    id: idSchema,
    kpiDefinitionId: idSchema,
    targetValue: decimalSchema.nullable(),
    minimumValue: decimalSchema.nullable(),
    maximumValue: decimalSchema.nullable(),
    weightPercent: decimalSchema,
    startsAt: timestampSchema,
    endsAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

export const jobProfileSchema = z
  .object({
    id: idSchema,
    departmentId: idSchema.nullable(),
    key: configurationKeySchema,
    name: z.string().min(1).max(160),
    description: z.string().nullable(),
    purpose: z.string().nullable(),
    version: z.number().int().positive(),
    isManagerial: z.boolean(),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
    duties: z.array(jobProfileDutySchema),
    kpis: z.array(jobProfileKpiSchema),
  })
  .strict();

export const kpiDefinitionSchema = z
  .object({
    id: idSchema,
    departmentId: idSchema.nullable(),
    key: configurationKeySchema,
    name: z.string().min(1).max(180),
    description: z.string().min(1),
    valueType: z.enum(KPI_VALUE_TYPES),
    direction: z.enum(KPI_DIRECTIONS),
    frequency: z.enum(KPI_FREQUENCIES),
    unitLabel: z.string().max(40).nullable(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
    measurementSource: z.string().min(1).max(120),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

export const agentPolicySchema = z
  .object({
    id: idSchema,
    toolKey: configurationKeySchema,
    requiredPermissionKey: configurationKeySchema,
    authorityLevel: z.enum(AGENT_AUTHORITY_LEVELS),
    maximumDataScope: z.enum(PERMISSION_DATA_SCOPES),
    requiresApproval: z.boolean(),
    requiresMfa: z.boolean(),
    maxActionsPerRun: z.number().int().min(1).max(250),
    configuration: z.record(z.string(), z.unknown()),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

export const agentProfileSchema = z
  .object({
    id: idSchema,
    departmentId: idSchema.nullable(),
    key: configurationKeySchema,
    name: z.string().min(1).max(160),
    description: z.string().min(1),
    behaviourInstructions: z.string().min(1).max(20_000),
    authorityCeiling: z.enum(AGENT_AUTHORITY_LEVELS),
    requiresHumanReview: z.boolean(),
    version: z.number().int().positive(),
    isActive: z.boolean(),
    updatedAt: timestampSchema,
    policies: z.array(agentPolicySchema),
  })
  .strict();

export const aiPermissionOptionSchema = z
  .object({
    key: configurationKeySchema,
    name: z.string().min(1).max(180),
    description: z.string().nullable(),
    resource: z.string().min(1).max(100),
    action: z.string().min(1).max(80),
    dataScope: z.enum(PERMISSION_DATA_SCOPES).nullable(),
    requiresMfa: z.boolean(),
  })
  .strict();

export const workforceConfigurationSnapshotSchema = z
  .object({
    organisationId: idSchema,
    generatedAt: timestampSchema,
    departments: z.array(workforceDepartmentSchema),
    teams: z.array(workforceTeamSchema),
    jobProfiles: z.array(jobProfileSchema),
    kpiDefinitions: z.array(kpiDefinitionSchema),
    agentProfiles: z.array(agentProfileSchema),
    aiPermissions: z.array(aiPermissionOptionSchema),
  })
  .strict();

export const workforceMutationResultSchema = z
  .object({
    resource: z.enum([
      "department",
      "team",
      "job_profile",
      "job_profile_duty",
      "kpi_definition",
      "job_profile_kpi",
      "agent_profile",
      "agent_policy",
    ]),
    id: idSchema,
    version: z.number().int().positive().nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

const createDepartmentPayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    code: optionalTextSchema(50),
    description: optionalTextSchema(4_000),
    parentId: optionalIdSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

const updateDepartmentPayloadSchema = createDepartmentPayloadSchema
  .extend({
    code: nullableTextSchema(50),
    description: nullableTextSchema(4_000),
    parentId: nullableIdSchema,
    isActive: z.boolean(),
    expectedUpdatedAt: timestampSchema,
  })
  .strict();

const createTeamPayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    code: optionalTextSchema(50),
    description: optionalTextSchema(4_000),
    departmentId: optionalIdSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

const updateTeamPayloadSchema = createTeamPayloadSchema
  .extend({
    code: nullableTextSchema(50),
    description: nullableTextSchema(4_000),
    departmentId: nullableIdSchema,
    isActive: z.boolean(),
    expectedUpdatedAt: timestampSchema,
  })
  .strict();

const kpiDefinitionFields = {
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(4_000),
  valueType: z.enum(KPI_VALUE_TYPES),
  direction: z.enum(KPI_DIRECTIONS),
  frequency: z.enum(KPI_FREQUENCIES),
  unitLabel: optionalTextSchema(40),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
  measurementSource: z.string().trim().min(1).max(120),
};

const createKpiDefinitionPayloadSchema = z
  .object({
    key: configurationKeySchema,
    departmentId: optionalIdSchema,
    ...kpiDefinitionFields,
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.valueType === "CURRENCY" && !value.currencyCode) {
      context.addIssue({
        code: "custom",
        path: ["currencyCode"],
        message: "Enter a three-letter currency code.",
      });
    }
  });

const updateKpiDefinitionPayloadSchema = z
  .object({
    ...kpiDefinitionFields,
    unitLabel: nullableTextSchema(40),
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    isActive: z.boolean(),
    expectedUpdatedAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.valueType === "CURRENCY" && !value.currencyCode) {
      context.addIssue({
        code: "custom",
        path: ["currencyCode"],
        message: "Enter a three-letter currency code.",
      });
    }
  });

const createJobProfilePayloadSchema = z
  .object({
    key: configurationKeySchema,
    name: z.string().trim().min(1).max(160),
    description: optionalTextSchema(4_000),
    purpose: optionalTextSchema(4_000),
    departmentId: optionalIdSchema,
    isManagerial: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const updateJobProfilePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: nullableTextSchema(4_000),
    purpose: nullableTextSchema(4_000),
    isManagerial: z.boolean(),
    isActive: z.boolean(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const createDutyPayloadSchema = z
  .object({
    code: configurationKeySchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4_000),
    position: z.number().int().min(1).max(32_767),
    isCritical: z.boolean().optional(),
    requiresEvidence: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const updateDutyPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4_000),
    position: z.number().int().min(1).max(32_767),
    isCritical: z.boolean(),
    requiresEvidence: z.boolean(),
    isActive: z.boolean(),
    expectedUpdatedAt: timestampSchema,
  })
  .strict();

const kpiAssignmentValues = {
  targetValue: optionalDecimalSchema,
  minimumValue: optionalDecimalSchema,
  maximumValue: optionalDecimalSchema,
  weightPercent: z.number().min(0).max(100),
};

const createJobProfileKpiPayloadSchema = z
  .object({
    kpiDefinitionId: idSchema,
    ...kpiAssignmentValues,
    startsAt: timestampSchema.optional(),
    endsAt: timestampSchema.nullable().optional(),
  })
  .strict();

const updateJobProfileKpiPayloadSchema = z
  .object({
    ...kpiAssignmentValues,
    targetValue: decimalSchema.nullable(),
    minimumValue: decimalSchema.nullable(),
    maximumValue: decimalSchema.nullable(),
    endsAt: timestampSchema.nullable(),
    expectedUpdatedAt: timestampSchema,
  })
  .strict();

const createAgentProfilePayloadSchema = z
  .object({
    key: configurationKeySchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    behaviourInstructions: z.string().trim().min(1).max(20_000),
    departmentId: optionalIdSchema,
    authorityCeiling: z.enum(AGENT_AUTHORITY_LEVELS),
    requiresHumanReview: z.boolean(),
    isActive: z.boolean().optional(),
  })
  .strict();

const updateAgentProfilePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    behaviourInstructions: z.string().trim().min(1).max(20_000),
    authorityCeiling: z.enum(AGENT_AUTHORITY_LEVELS),
    requiresHumanReview: z.boolean(),
    isActive: z.boolean(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const agentPolicyFields = {
  requiredPermissionKey: configurationKeySchema,
  authorityLevel: z.enum(AGENT_AUTHORITY_LEVELS),
  maximumDataScope: z.enum(PERMISSION_DATA_SCOPES),
  requiresApproval: z.boolean(),
  requiresMfa: z.boolean(),
  maxActionsPerRun: z.number().int().min(1).max(250),
  configuration: z.record(z.string(), z.unknown()).optional(),
};

const createAgentPolicyPayloadSchema = z
  .object({
    toolKey: configurationKeySchema,
    ...agentPolicyFields,
    isActive: z.boolean().optional(),
  })
  .strict();

const updateAgentPolicyPayloadSchema = z
  .object({
    ...agentPolicyFields,
    configuration: z.record(z.string(), z.unknown()),
    isActive: z.boolean(),
    expectedUpdatedAt: timestampSchema,
  })
  .strict();

const mutationBase = { organisationId: idSchema };

export const workforceMutationRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        ...mutationBase,
        operation: z.literal("department.create"),
        payload: createDepartmentPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("department.update"),
        departmentId: idSchema,
        payload: updateDepartmentPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("team.create"),
        payload: createTeamPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("team.update"),
        teamId: idSchema,
        payload: updateTeamPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("kpi_definition.create"),
        payload: createKpiDefinitionPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("kpi_definition.update"),
        kpiDefinitionId: idSchema,
        payload: updateKpiDefinitionPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("job_profile.create"),
        payload: createJobProfilePayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("job_profile.update"),
        jobProfileId: idSchema,
        payload: updateJobProfilePayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("job_profile_duty.create"),
        jobProfileId: idSchema,
        payload: createDutyPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("job_profile_duty.update"),
        jobProfileId: idSchema,
        dutyId: idSchema,
        payload: updateDutyPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("job_profile_kpi.create"),
        jobProfileId: idSchema,
        payload: createJobProfileKpiPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("job_profile_kpi.update"),
        jobProfileId: idSchema,
        assignmentId: idSchema,
        payload: updateJobProfileKpiPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("agent_profile.create"),
        payload: createAgentProfilePayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("agent_profile.update"),
        agentProfileId: idSchema,
        payload: updateAgentProfilePayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("agent_policy.create"),
        agentProfileId: idSchema,
        payload: createAgentPolicyPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...mutationBase,
        operation: z.literal("agent_policy.update"),
        agentProfileId: idSchema,
        policyId: idSchema,
        payload: updateAgentPolicyPayloadSchema,
      })
      .strict(),
  ],
);

export type WorkforceConfigurationSnapshot = z.infer<
  typeof workforceConfigurationSnapshotSchema
>;
export type WorkforceDepartment = z.infer<typeof workforceDepartmentSchema>;
export type WorkforceTeam = z.infer<typeof workforceTeamSchema>;
export type JobProfile = z.infer<typeof jobProfileSchema>;
export type JobProfileDuty = z.infer<typeof jobProfileDutySchema>;
export type JobProfileKpi = z.infer<typeof jobProfileKpiSchema>;
export type KpiDefinition = z.infer<typeof kpiDefinitionSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentPolicy = z.infer<typeof agentPolicySchema>;
export type WorkforceMutationRequest = z.infer<
  typeof workforceMutationRequestSchema
>;
type WithoutOrganisation<T> = T extends { organisationId: string }
  ? Omit<T, "organisationId">
  : never;
export type WorkforceMutation = WithoutOrganisation<WorkforceMutationRequest>;
export type WorkforceMutationResult = z.infer<
  typeof workforceMutationResultSchema
>;
export type AgentAuthorityLevel = (typeof AGENT_AUTHORITY_LEVELS)[number];
export type PermissionDataScope = (typeof PERMISSION_DATA_SCOPES)[number]