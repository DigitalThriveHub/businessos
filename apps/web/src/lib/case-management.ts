import { z } from "zod";

export const CLIENT_KINDS = ["INDIVIDUAL", "ORGANISATION"] as const;
export const CLIENT_STATUSES = [
  "ONBOARDING",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;
export const CLIENT_RISK_RATINGS = [
  "NOT_ASSESSED",
  "LOW",
  "MEDIUM",
  "HIGH",
] as const;
export const IDENTITY_VERIFICATION_STATUSES = [
  "NOT_STARTED",
  "PENDING",
  "VERIFIED",
  "FAILED",
  "EXPIRED",
] as const;
export const PROCESSING_LAWFUL_BASES = [
  "CONTRACT",
  "LEGAL_OBLIGATION",
  "LEGITIMATE_INTEREST",
  "CONSENT",
  "VITAL_INTEREST",
  "PUBLIC_TASK",
] as const;
export const COMMUNICATION_CHANNELS = [
  "EMAIL",
  "PHONE",
  "SMS",
  "WHATSAPP",
  "POST",
  "NONE",
] as const;
export const MATTER_STATUSES = [
  "INTAKE",
  "CONFLICT_CHECK",
  "CLIENT_CARE",
  "AWAITING_DOCUMENTS",
  "ACTIVE",
  "SUBMITTED",
  "DECISION_RECEIVED",
  "ON_HOLD",
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
] as const;
export const MATTER_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const ADDITIONAL_MATTER_PARTY_ROLES = [
  "DEPENDANT",
  "SPONSOR",
  "EMPLOYER",
  "REPRESENTATIVE",
  "OTHER",
] as const;
export const CONFLICT_CHECK_STATUSES = [
  "NOT_STARTED",
  "PENDING",
  "CLEARED",
  "FLAGGED",
  "WAIVED",
] as const;
export const AML_CHECK_STATUSES = [
  "NOT_REQUIRED",
  "NOT_STARTED",
  "PENDING",
  "VERIFIED",
  "FAILED",
  "EXPIRED",
] as const;
export const CLIENT_CARE_STATUSES = [
  "NOT_SENT",
  "SENT",
  "ACCEPTED",
  "DECLINED",
] as const;

export const CLIENT_STATUS_LABELS = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
} as const;

export const MATTER_STATUS_LABELS = {
  INTAKE: "Intake",
  CONFLICT_CHECK: "Conflict check",
  CLIENT_CARE: "Client care",
  AWAITING_DOCUMENTS: "Awaiting documents",
  ACTIVE: "Active",
  SUBMITTED: "Submitted",
  DECISION_RECEIVED: "Decision received",
  ON_HOLD: "On hold",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
} as const;

export const clientKindSchema = z.enum(CLIENT_KINDS);
export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export const clientRiskRatingSchema = z.enum(CLIENT_RISK_RATINGS);
export const identityVerificationStatusSchema = z.enum(
  IDENTITY_VERIFICATION_STATUSES,
);
export const processingLawfulBasisSchema = z.enum(PROCESSING_LAWFUL_BASES);
export const communicationChannelSchema = z.enum(COMMUNICATION_CHANNELS);
export const matterStatusSchema = z.enum(MATTER_STATUSES);
export const matterPrioritySchema = z.enum(MATTER_PRIORITIES);
export const additionalMatterPartyRoleSchema = z.enum(
  ADDITIONAL_MATTER_PARTY_ROLES,
);
export const conflictCheckStatusSchema = z.enum(CONFLICT_CHECK_STATUSES);
export const amlCheckStatusSchema = z.enum(AML_CHECK_STATUSES);
export const clientCareStatusSchema = z.enum(CLIENT_CARE_STATUSES);

export type ClientKind = z.infer<typeof clientKindSchema>;
export type ClientStatus = z.infer<typeof clientStatusSchema>;
export type MatterStatus = z.infer<typeof matterStatusSchema>;
export type MatterPriority = z.infer<typeof matterPrioritySchema>;

const nullableText = z.string().nullable();
const nullableDateTime = z.string().datetime().nullable();
const nullableUuid = z.string().uuid().nullable();

export const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const clientSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  clientNumber: z.string(),
  sourceEnquiryId: nullableUuid,
  kind: clientKindSchema,
  status: clientStatusSchema,
  displayName: z.string(),
  firstName: nullableText,
  lastName: nullableText,
  organisationName: nullableText,
  email: nullableText,
  phone: nullableText,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  nationality: nullableText,
  countryOfResidenceCode: nullableText,
  addressLine1: nullableText,
  addressLine2: nullableText,
  city: nullableText,
  region: nullableText,
  postalCode: nullableText,
  addressCountryCode: nullableText,
  preferredLanguage: z.string(),
  preferredCommunication: communicationChannelSchema,
  processingLawfulBasis: processingLawfulBasisSchema,
  privacyNoticeVersion: nullableText,
  privacyNoticeAcknowledgedAt: nullableDateTime,
  marketingConsent: z.boolean(),
  marketingConsentAt: nullableDateTime,
  marketingConsentSource: nullableText,
  riskRating: clientRiskRatingSchema,
  identityVerificationStatus: identityVerificationStatusSchema,
  identityVerifiedAt: nullableDateTime,
  identityVerificationExpiresAt: nullableDateTime,
  assignedToUserId: nullableUuid,
  assignedToName: nullableText,
  lastContactedAt: nullableDateTime,
  retentionReviewAt: nullableDateTime,
  archivedAt: nullableDateTime,
  archiveReason: nullableText,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Client = z.infer<typeof clientSchema>;

export const clientListSchema = z.object({
  items: z.array(clientSchema),
  pagination: paginationSchema,
});
export type ClientList = z.infer<typeof clientListSchema>;

export const matterSummarySchema = z.object({
  id: z.string().uuid(),
  matterNumber: z.string(),
  title: z.string(),
  serviceType: z.string(),
  status: matterStatusSchema,
  priority: matterPrioritySchema,
  primaryClientId: z.string().uuid(),
  primaryClientName: z.string(),
  assignedToUserId: nullableUuid,
  assignedToName: nullableText,
  departmentId: nullableUuid,
  teamId: nullableUuid,
  nextActionAt: nullableDateTime,
  criticalDeadlineAt: nullableDateTime,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MatterSummary = z.infer<typeof matterSummarySchema>;

export const matterComplianceSchema = z.object({
  id: z.string().uuid(),
  conflictStatus: conflictCheckStatusSchema,
  conflictReference: nullableText,
  conflictCheckedAt: nullableDateTime,
  conflictCheckedByUserId: nullableUuid,
  amlStatus: amlCheckStatusSchema,
  amlReference: nullableText,
  amlCheckedAt: nullableDateTime,
  amlCheckedByUserId: nullableUuid,
  clientCareStatus: clientCareStatusSchema,
  clientCareSentAt: nullableDateTime,
  clientCareRespondedAt: nullableDateTime,
  riskRating: clientRiskRatingSchema,
  riskReason: nullableText,
  riskReviewedAt: nullableDateTime,
  riskReviewedByUserId: nullableUuid,
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export const matterPartySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientNumber: z.string(),
  clientName: z.string(),
  role: z.enum(["PRIMARY_CLIENT", ...ADDITIONAL_MATTER_PARTY_ROLES]),
  isPrimary: z.boolean(),
  roleDescription: nullableText,
  updatedAt: z.string().datetime(),
});

export const matterStatusHistorySchema = z.object({
  id: z.string().uuid(),
  fromStatus: matterStatusSchema.nullable(),
  toStatus: matterStatusSchema,
  reason: z.string(),
  changedByUserId: z.string().uuid(),
  changedByName: z.string(),
  occurredAt: z.string().datetime(),
});

export const matterSchema = matterSummarySchema.extend({
  organisationId: z.string().uuid(),
  sourceEnquiryId: nullableUuid,
  description: nullableText,
  jurisdictionCountryCode: nullableText,
  externalReference: nullableText,
  supervisorUserId: nullableUuid,
  supervisorName: nullableText,
  nextActionSummary: nullableText,
  targetCompletionAt: nullableDateTime,
  openedAt: z.string().datetime(),
  closedAt: nullableDateTime,
  closureReason: nullableText,
  outcome: nullableText,
  archivedAt: nullableDateTime,
  archiveReason: nullableText,
  compliance: matterComplianceSchema,
  parties: z.array(matterPartySchema),
  statusHistory: z.array(matterStatusHistorySchema),
});
export type Matter = z.infer<typeof matterSchema>;

export const matterListSchema = z.object({
  items: z.array(matterSummarySchema),
  pagination: paginationSchema,
});
export type MatterList = z.infer<typeof matterListSchema>;

const optionSchema = z.object({ id: z.string().uuid(), label: z.string() });
export const caseManagementOptionsSchema = z.object({
  departments: z.array(optionSchema),
  teams: z.array(optionSchema.extend({ departmentId: nullableUuid })),
  members: z.array(optionSchema),
  clients: z.array(optionSchema.extend({ clientNumber: z.string() })),
  convertibleEnquiries: z.array(
    optionSchema.extend({
      status: z.enum(["QUALIFIED", "CONSULTATION_BOOKED"]),
      serviceType: nullableText,
    }),
  ),
});
export type CaseManagementOptions = z.infer<
  typeof caseManagementOptionsSchema
>;

export const conversionResultSchema = z.object({
  enquiryId: z.string().uuid(),
  clientId: z.string().uuid(),
  matterId: z.string().uuid(),
  clientNumber: z.string(),
  matterNumber: z.string(),
  repeated: z.boolean(),
});
export type ConversionResult = z.infer<typeof conversionResultSchema>;

const optionalNullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const optionalNullableDateTime = nullableDateTime.optional();
const optionalNullableUuid = nullableUuid.optional();
const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

export const createClientPayloadSchema = z
  .object({
    kind: clientKindSchema,
    firstName: optionalNullableText(100),
    lastName: optionalNullableText(100),
    organisationName: optionalNullableText(240),
    email: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
    phone: optionalNullableText(50),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    nationality: optionalNullableText(100),
    countryOfResidenceCode: countryCode.nullable().optional(),
    addressLine1: optionalNullableText(240),
    addressLine2: optionalNullableText(240),
    city: optionalNullableText(120),
    region: optionalNullableText(120),
    postalCode: optionalNullableText(30),
    addressCountryCode: countryCode.nullable().optional(),
    preferredLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).optional(),
    preferredCommunication: communicationChannelSchema.optional(),
    processingLawfulBasis: processingLawfulBasisSchema,
    privacyNoticeVersion: optionalNullableText(40),
    privacyNoticeAcknowledgedAt: optionalNullableDateTime,
    marketingConsent: z.boolean().optional(),
    marketingConsentAt: optionalNullableDateTime,
    marketingConsentSource: optionalNullableText(120),
    riskRating: clientRiskRatingSchema.optional(),
    identityVerificationStatus: identityVerificationStatusSchema.optional(),
    identityVerifiedAt: optionalNullableDateTime,
    identityVerificationExpiresAt: optionalNullableDateTime,
    assignedToUserId: optionalNullableUuid,
    retentionReviewAt: optionalNullableDateTime,
  })
  .strict();

export const updateClientPayloadSchema = createClientPayloadSchema
  .omit({ kind: true })
  .required()
  .extend({
    firstName: nullableText,
    lastName: nullableText,
    organisationName: nullableText,
    email: z.string().email().max(320).nullable(),
    phone: nullableText,
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    nationality: nullableText,
    countryOfResidenceCode: countryCode.nullable(),
    addressLine1: nullableText,
    addressLine2: nullableText,
    city: nullableText,
    region: nullableText,
    postalCode: nullableText,
    addressCountryCode: countryCode.nullable(),
    privacyNoticeVersion: nullableText,
    privacyNoticeAcknowledgedAt: nullableDateTime,
    marketingConsentAt: nullableDateTime,
    marketingConsentSource: nullableText,
    identityVerifiedAt: nullableDateTime,
    identityVerificationExpiresAt: nullableDateTime,
    assignedToUserId: nullableUuid,
    retentionReviewAt: nullableDateTime,
    status: z.enum(["ONBOARDING", "ACTIVE", "INACTIVE"]),
    expectedVersion: z.number().int().positive(),
  });

export const createMatterPayloadSchema = z
  .object({
    primaryClientId: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    description: optionalNullableText(10_000),
    serviceType: z.string().trim().min(1).max(160),
    jurisdictionCountryCode: countryCode.nullable().optional(),
    externalReference: optionalNullableText(120),
    priority: matterPrioritySchema.optional(),
    nextActionSummary: optionalNullableText(500),
    nextActionAt: optionalNullableDateTime,
    criticalDeadlineAt: optionalNullableDateTime,
    targetCompletionAt: optionalNullableDateTime,
    departmentId: optionalNullableUuid,
    teamId: optionalNullableUuid,
    assignedToUserId: optionalNullableUuid,
    supervisorUserId: optionalNullableUuid,
  })
  .strict();

export const updateMatterPayloadSchema = createMatterPayloadSchema
  .omit({ primaryClientId: true })
  .required()
  .extend({
    description: nullableText,
    jurisdictionCountryCode: countryCode.nullable(),
    externalReference: nullableText,
    nextActionSummary: nullableText,
    nextActionAt: nullableDateTime,
    criticalDeadlineAt: nullableDateTime,
    targetCompletionAt: nullableDateTime,
    departmentId: nullableUuid,
    teamId: nullableUuid,
    assignedToUserId: nullableUuid,
    supervisorUserId: nullableUuid,
    expectedVersion: z.number().int().positive(),
  });

const organisationOperation = z.object({ organisationId: z.string().uuid() });

export const caseManagementMutationSchema = z.discriminatedUnion("operation", [
  organisationOperation.extend({
    operation: z.literal("client.create"),
    payload: createClientPayloadSchema,
  }),
  organisationOperation.extend({
    operation: z.literal("client.update"),
    clientId: z.string().uuid(),
    payload: updateClientPayloadSchema,
  }),
  organisationOperation.extend({
    operation: z.literal("client.archive"),
    clientId: z.string().uuid(),
    payload: z.object({
      reason: z.string().trim().min(10).max(1_000),
      expectedVersion: z.number().int().positive(),
    }),
  }),
  organisationOperation.extend({
    operation: z.literal("matter.create"),
    payload: createMatterPayloadSchema,
  }),
  organisationOperation.extend({
    operation: z.literal("matter.update"),
    matterId: z.string().uuid(),
    payload: updateMatterPayloadSchema,
  }),
  organisationOperation.extend({
    operation: z.literal("matter.status"),
    matterId: z.string().uuid(),
    payload: z.object({
      toStatus: matterStatusSchema,
      reason: z.string().trim().min(3).max(1_000),
      outcome: nullableText.optional(),
      expectedVersion: z.number().int().positive(),
    }),
  }),
  organisationOperation.extend({
    operation: z.literal("matter.compliance"),
    matterId: z.string().uuid(),
    payload: z.object({
      conflictStatus: conflictCheckStatusSchema,
      conflictReference: nullableText,
      amlStatus: amlCheckStatusSchema,
      amlReference: nullableText,
      clientCareStatus: clientCareStatusSchema,
      riskRating: clientRiskRatingSchema,
      riskReason: nullableText,
      expectedVersion: z.number().int().positive(),
    }),
  }),
  organisationOperation.extend({
    operation: z.literal("matter.party.add"),
    matterId: z.string().uuid(),
    payload: z.object({
      clientId: z.string().uuid(),
      role: additionalMatterPartyRoleSchema,
      roleDescription: nullableText.optional(),
    }),
  }),
  organisationOperation.extend({
    operation: z.literal("matter.party.remove"),
    matterId: z.string().uuid(),
    partyId: z.string().uuid(),
    payload: z.object({ reason: z.string().trim().min(3).max(500) }),
  }),
  organisationOperation.extend({
    operation: z.literal("enquiry.convert"),
    enquiryId: z.string().uuid(),
    payload: z.object({
      idempotencyKey: z.string().uuid(),
      existingClientId: nullableUuid.optional(),
      clientKind: clientKindSchema.optional(),
      clientOrganisationName: nullableText.optional(),
      processingLawfulBasis: processingLawfulBasisSchema,
      privacyNoticeVersion: nullableText.optional(),
      privacyNoticeAcknowledgedAt: nullableDateTime.optional(),
      clientAssignedToUserId: nullableUuid.optional(),
      matterTitle: z.string().trim().min(1).max(240),
      matterDescription: nullableText.optional(),
      serviceType: z.string().trim().min(1).max(160),
      priority: matterPrioritySchema.optional(),
      jurisdictionCountryCode: countryCode.nullable().optional(),
      departmentId: nullableUuid.optional(),
      teamId: nullableUuid.optional(),
      assignedToUserId: nullableUuid.optional(),
      supervisorUserId: nullableUuid.optional(),
      nextActionSummary: nullableText.optional(),
      nextActionAt: nullableDateTime.optional(),
      criticalDeadlineAt: nullableDateTime.optional(),
      targetCompletionAt: nullableDateTime.optional(),
    }),
  }),
]);

export type CaseManagementMutation = z.infer<
  typeof caseManagementMutationSchema
>;

export const caseManagementReadQuerySchema = z.object({
  organisationId: z.string().uuid(),
  resource: z.enum(["options", "clients", "client", "matters", "matter"]),
  id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.string().max(40).optional(),
  priority: z.string().max(20).optional(),
  assignedToUserId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});