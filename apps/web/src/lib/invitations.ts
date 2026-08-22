import { z } from "zod";

export const INVITATION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "REVOKED",
] as const;

export const INVITATION_DELIVERY_STATUSES = [
  "QUEUED",
  "SENT",
  "FAILED",
] as const;

export const INVITATION_ROLE_SCOPES = [
  "ORGANISATION",
  "DEPARTMENT",
  "TEAM",
] as const;

export const invitationStatusSchema = z.enum(INVITATION_STATUSES);
export const invitationDeliveryStatusSchema = z.enum(
  INVITATION_DELIVERY_STATUSES,
);
export const invitationRoleScopeSchema = z.enum(INVITATION_ROLE_SCOPES);

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;
export type InvitationDeliveryStatus = z.infer<
  typeof invitationDeliveryStatusSchema
>;
export type InvitationRoleScope = z.infer<typeof invitationRoleScopeSchema>;

const roleKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,
    "Select a valid organisation role.",
  );

const organisationIdSchema = z.string().uuid();
const optionalUuidSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().uuid().optional(),
);
const optionalDateTimeSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().datetime({ offset: true }).optional(),
);

export const invitationSchema = z.object({
  id: z.string().uuid(),
  organisationId: organisationIdSchema,
  email: z.string().email().max(254),
  status: invitationStatusSchema,
  roleKeys: z.array(roleKeySchema).max(8),
  jobTitle: z.string().max(160).nullable(),
  deliveryStatus: invitationDeliveryStatusSchema,
  onboardingPlanId: z.string().uuid().nullable(),
  jobProfileId: z.string().uuid().nullable(),
  departmentId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable(),
  managerOrganisationMembershipId: z.string().uuid().nullable(),
  agentProfileId: z.string().uuid().nullable(),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  isDepartmentManager: z.boolean(),
  isTeamLead: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }),
  acceptedAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  revocationReason: z.string().max(500).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Invitation = z.infer<typeof invitationSchema>;

export const invitationListSchema = z.object({
  items: z.array(invitationSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type InvitationList = z.infer<typeof invitationListSchema>;

export const assignableInvitationRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string().min(1).max(160),
  description: z.string().nullable(),
  scope: invitationRoleScopeSchema,
  isSystem: z.boolean(),
});

export type AssignableInvitationRole = z.infer<
  typeof assignableInvitationRoleSchema
>;

export const assignableInvitationRoleListSchema = z.object({
  items: z.array(assignableInvitationRoleSchema),
  total: z.number().int().nonnegative(),
});

export const invitationJobProfileOptionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  description: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  isManagerial: z.boolean(),
  activeDutyCount: z.number().int().nonnegative(),
  activeKpiCount: z.number().int().nonnegative(),
});

export const invitationDepartmentOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(160),
  code: z.string().max(50).nullable(),
});

export const invitationTeamOptionSchema = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(160),
  code: z.string().max(50).nullable(),
});

export const invitationManagerOptionSchema = z.object({
  organisationMembershipId: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  email: z.string().email().max(254),
  jobTitle: z.string().max(160).nullable(),
});

export const invitationAgentProfileOptionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  departmentId: z.string().uuid().nullable(),
  authorityCeiling: z.enum([
    "DISABLED",
    "READ",
    "DRAFT",
    "PROPOSE",
    "EXECUTE_WITH_APPROVAL",
    "EXECUTE_AUTOMATIC",
  ]),
  requiresHumanReview: z.boolean(),
});

export const invitationWorkforceOptionsSchema = z.object({
  configurationReady: z.boolean(),
  assignableRoleCount: z.number().int().nonnegative(),
  jobProfiles: z.array(invitationJobProfileOptionSchema),
  departments: z.array(invitationDepartmentOptionSchema),
  teams: z.array(invitationTeamOptionSchema),
  managers: z.array(invitationManagerOptionSchema),
  agentProfiles: z.array(invitationAgentProfileOptionSchema),
});

export type InvitationWorkforceOptions = z.infer<
  typeof invitationWorkforceOptionsSchema
>;
export type InvitationJobProfileOption = z.infer<
  typeof invitationJobProfileOptionSchema
>;
export type InvitationDepartmentOption = z.infer<
  typeof invitationDepartmentOptionSchema
>;
export type InvitationTeamOption = z.infer<typeof invitationTeamOptionSchema>;
export type InvitationManagerOption = z.infer<
  typeof invitationManagerOptionSchema
>;
export type InvitationAgentProfileOption = z.infer<
  typeof invitationAgentProfileOptionSchema
>;

export const invitationQuerySchema = z.object({
  organisationId: organisationIdSchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const invitationRoleQuerySchema = z.object({
  organisationId: organisationIdSchema,
});

export const invitationWorkforceOptionsQuerySchema = invitationRoleQuerySchema;

export const createInvitationRequestSchema = z
  .object({
    organisationId: organisationIdSchema,
    email: z
      .string()
      .trim()
      .min(1, "Email address is required.")
      .email("Enter a valid email address.")
      .max(254)
      .transform((value) => value.toLowerCase()),
    roleKeys: z
      .array(roleKeySchema)
      .min(1, "Select at least one role.")
      .max(8, "No more than eight roles can be assigned."),
    jobProfileId: z.string().uuid("Select a valid job profile."),
    jobTitle: z
      .string()
      .trim()
      .max(160, "Job title must contain no more than 160 characters.")
      .optional()
      .transform((value) => value || undefined),
    departmentId: optionalUuidSchema,
    teamId: optionalUuidSchema,
    managerOrganisationMembershipId: optionalUuidSchema,
    agentProfileId: optionalUuidSchema,
    startsAt: optionalDateTimeSchema,
    isDepartmentManager: z.boolean().optional().default(false),
    isTeamLead: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.roleKeys).size !== input.roleKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roleKeys"],
        message: "Each selected role must be unique.",
      });
    }

    if (input.isDepartmentManager && !input.departmentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departmentId"],
        message: "Select a department for a department manager.",
      });
    }

    if (input.isTeamLead && !input.teamId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teamId"],
        message: "Select a team for a team lead.",
      });
    }
  });

export const revokeInvitationRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "Enter a reason for revoking the invitation.")
      .max(
        500,
        "The revocation reason must contain no more than 500 characters.",
      ),
  })
  .strict();

export const invitationIdSchema = z.string().uuid();