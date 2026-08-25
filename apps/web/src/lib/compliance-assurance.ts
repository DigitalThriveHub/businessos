import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();
const positiveVersion = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();

export const dataSubjectRequestTypes = [
  "ACCESS",
  "RECTIFICATION",
  "ERASURE",
  "RESTRICTION",
  "PORTABILITY",
  "OBJECTION",
  "AUTOMATED_DECISION_REVIEW",
] as const;

export const dataSubjectRequestStatuses = [
  "RECEIVED",
  "IDENTITY_VERIFICATION",
  "IN_PROGRESS",
  "ON_HOLD",
  "READY_FOR_REVIEW",
  "COMPLETED",
  "REFUSED",
  "WITHDRAWN",
] as const;

export const identityProofStatuses = [
  "NOT_STARTED",
  "PENDING",
  "VERIFIED",
  "FAILED",
] as const;

export const privacyIncidentSeverities = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export const privacyIncidentStatuses = [
  "OPEN",
  "CONTAINING",
  "INVESTIGATING",
  "NOTIFICATION_DECISION",
  "RESOLVED",
  "CLOSED",
] as const;

export const breachNotificationDecisions = [
  "UNASSESSED",
  "NOT_REPORTABLE",
  "ICO_REQUIRED",
  "ICO_NOTIFIED",
  "SUBJECTS_REQUIRED",
  "SUBJECTS_NOTIFIED",
] as const;

export const retentionActions = [
  "REVIEW",
  "RETAIN",
  "ARCHIVE",
  "ANONYMISE",
  "DELETE",
] as const;

export const retentionReviewStatuses = [
  "DUE",
  "IN_REVIEW",
  "BLOCKED",
  "APPROVED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const assuranceEvidenceStatuses = [
  "NOT_TESTED",
  "SUBMITTED",
  "PASS",
  "FAIL",
  "BLOCKED",
  "EXPIRED",
] as const;

const rightSchema = z.object({
  id: uuid,
  requestReference: z.string(),
  requestType: z.enum(dataSubjectRequestTypes),
  status: z.enum(dataSubjectRequestStatuses),
  identityStatus: z.enum(identityProofStatuses),
  subjectName: z.string(),
  subjectEmail: z.string().nullable(),
  subjectPhone: z.string().nullable(),
  clientId: uuid.nullable(),
  requestDetails: z.string(),
  receivedAt: dateTime,
  dueAt: dateTime,
  extendedDueAt: nullableDateTime,
  effectiveDueAt: dateTime,
  daysRemaining: z.number().int(),
  ownerUserId: uuid.nullable(),
  ownerName: z.string().nullable(),
  responseReference: z.string().nullable(),
  completedAt: nullableDateTime,
  version: positiveVersion,
  updatedAt: dateTime,
});

const incidentSchema = z.object({
  id: uuid,
  incidentReference: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(privacyIncidentSeverities),
  status: z.enum(privacyIncidentStatuses),
  personalDataBreach: z.boolean(),
  dataCategories: z.array(z.string()),
  approximatePeopleAffected: nonNegativeInteger,
  discoveredAt: dateTime,
  notificationDeadlineAt: nullableDateTime,
  notificationHoursRemaining: z.number().int().nullable(),
  containedAt: nullableDateTime,
  riskAssessment: z.string().nullable(),
  notificationDecision: z.enum(breachNotificationDecisions),
  icoReference: z.string().nullable(),
  icoNotifiedAt: nullableDateTime,
  subjectNotificationEvidence: z.string().nullable(),
  subjectsNotifiedAt: nullableDateTime,
  resolution: z.string().nullable(),
  resolvedAt: nullableDateTime,
  ownerUserId: uuid.nullable(),
  ownerName: z.string().nullable(),
  version: positiveVersion,
  updatedAt: dateTime,
});

const retentionPolicySchema = z.object({
  id: uuid,
  policyKey: z.string(),
  name: z.string(),
  resourceType: z.string(),
  triggerEvent: z.string(),
  retentionDays: z.number().int().positive(),
  action: z.enum(retentionActions),
  lawfulReason: z.string(),
  isActive: z.boolean(),
  version: positiveVersion,
  updatedAt: dateTime,
});

const retentionReviewSchema = z.object({
  id: uuid,
  policyId: uuid,
  policyName: z.string(),
  resourceType: z.string(),
  resourceId: uuid,
  status: z.enum(retentionReviewStatuses),
  decision: z.enum(retentionActions).nullable(),
  dueAt: dateTime,
  legalHoldId: uuid.nullable(),
  ownerUserId: uuid.nullable(),
  decisionNotes: z.string().nullable(),
  completionEvidenceReference: z.string().nullable(),
  decidedAt: nullableDateTime,
  completedAt: nullableDateTime,
  version: positiveVersion,
  updatedAt: dateTime,
});

const legalHoldSchema = z.object({
  id: uuid,
  scopeType: z.enum(["ORGANISATION", "CLIENT", "MATTER", "DOCUMENT"]),
  scopeId: uuid.nullable(),
  reason: z.string(),
  startsAt: dateTime,
  expiresAt: nullableDateTime,
  releasedAt: nullableDateTime,
  releaseReason: z.string().nullable(),
  version: positiveVersion,
  updatedAt: dateTime,
});

const evidenceSchema = z.object({
  id: uuid,
  evidenceKey: z.string(),
  title: z.string(),
  category: z.string(),
  mandatory: z.boolean(),
  status: z.enum(assuranceEvidenceStatuses),
  effectiveStatus: z.enum(assuranceEvidenceStatuses),
  evidenceReference: z.string().nullable(),
  evidenceSha256: z.string().nullable(),
  assessorName: z.string().nullable(),
  assessorOrganisation: z.string().nullable(),
  // Mandatory NOT_TESTED controls are initially seeded without evidence scope.
  // Submitted evidence is still required to provide scope by the server.
  scope: z.record(z.string(), z.unknown()),
  testedAt: nullableDateTime,
  expiresAt: nullableDateTime,
  notes: z.string().nullable(),
  recordedByUserId: uuid.nullable(),
  reviewedByUserId: uuid.nullable(),
  reviewedAt: nullableDateTime,
  reviewNote: z.string().nullable(),
  version: positiveVersion,
  updatedAt: dateTime,
});

const blockerSchema = z.object({
  code: z.string(),
  subject: z.string(),
  detail: z.string(),
});

const releaseSchema = z.object({
  id: uuid,
  releaseReference: z.string(),
  environment: z.enum(["PRODUCTION", "STAGING"]),
  decision: z.enum(["BLOCKED", "APPROVED", "REVOKED"]),
  rationale: z.string(),
  changeReference: z.string().nullable(),
  blockerSnapshot: z.array(blockerSchema),
  decidedByUserId: uuid,
  decidedAt: dateTime,
});

export const complianceAssuranceDashboardSchema = z.object({
  generatedAt: dateTime,
  access: z.object({
    assuranceLevel: z.enum(["AAL1", "AAL2"]),
    rightsManage: z.boolean(),
    incidentsRead: z.boolean(),
    incidentsManage: z.boolean(),
    retentionRead: z.boolean(),
    retentionManage: z.boolean(),
    assuranceRead: z.boolean(),
    assuranceManage: z.boolean(),
    releaseApprove: z.boolean(),
  }),
  summary: z.object({
    openRights: nonNegativeInteger,
    rightsDueSevenDays: nonNegativeInteger,
    rightsOverdue: nonNegativeInteger,
    openIncidents: nonNegativeInteger,
    notificationClocks: nonNegativeInteger,
    dueRetentionReviews: nonNegativeInteger,
    activeLegalHolds: nonNegativeInteger,
    mandatoryEvidencePassed: nonNegativeInteger,
    mandatoryEvidenceTotal: nonNegativeInteger,
    releaseBlockerCount: nonNegativeInteger,
    releaseEligible: z.boolean(),
  }),
  rights: z.array(rightSchema),
  incidents: z.array(incidentSchema),
  retention: z.object({
    policies: z.array(retentionPolicySchema),
    reviews: z.array(retentionReviewSchema),
    legalHolds: z.array(legalHoldSchema),
  }),
  assurance: z.object({
    evidence: z.array(evidenceSchema),
    blockers: z.array(blockerSchema),
    latestRelease: releaseSchema.nullable(),
    releaseEligible: z.boolean(),
    certificationBoundary: z.string(),
  }),
});

export type ComplianceAssuranceDashboard = z.infer<
  typeof complianceAssuranceDashboardSchema
>;
export type DataSubjectRight = z.infer<typeof rightSchema>;
export type PrivacyIncident = z.infer<typeof incidentSchema>;
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export type RetentionReview = z.infer<typeof retentionReviewSchema>;
export type LegalHold = z.infer<typeof legalHoldSchema>;
export type AssuranceEvidence = z.infer<typeof evidenceSchema>;

export const complianceAssuranceReadQuerySchema = z.object({
  organisationId: uuid,
  requestId: uuid.optional(),
});

const rightCreate = z.object({
  requestType: z.enum(dataSubjectRequestTypes),
  subjectName: z.string().trim().min(2).max(240),
  subjectEmail: z.string().trim().email().max(320).nullable(),
  subjectPhone: z.string().trim().max(50).nullable(),
  clientId: uuid.nullable(),
  receivedAt: dateTime.nullable(),
  requestDetails: z.string().trim().min(10).max(4000),
  ownerUserId: uuid.nullable(),
});

const rightTransition = z.object({
  status: z.enum(dataSubjectRequestStatuses),
  identityStatus: z.enum(identityProofStatuses).optional(),
  note: z.string().trim().min(10).max(4000),
  evidenceReference: z.string().trim().max(1000).nullable(),
  responseReference: z.string().trim().max(1000).nullable(),
  expectedVersion: positiveVersion,
});

const rightExtend = z.object({
  extendedDueAt: dateTime,
  reason: z.string().trim().min(20).max(2000),
  notificationReference: z.string().trim().min(8).max(1000),
  expectedVersion: positiveVersion,
});

const incidentCreate = z.object({
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().min(20).max(8000),
  severity: z.enum(privacyIncidentSeverities),
  personalDataBreach: z.boolean(),
  discoveredAt: dateTime,
  dataCategories: z.array(z.string().trim().min(1).max(120)).max(30),
  approximatePeopleAffected: z.number().int().min(0).max(100_000_000),
  ownerUserId: uuid.nullable(),
});

const incidentUpdate = z.object({
  status: z.enum(privacyIncidentStatuses),
  severity: z.enum(privacyIncidentSeverities),
  personalDataBreach: z.boolean(),
  notificationDecision: z.enum(breachNotificationDecisions),
  containedAt: dateTime.nullable(),
  riskAssessment: z.string().trim().min(20).max(8000),
  resolution: z.string().trim().max(4000).nullable(),
  icoReference: z.string().trim().max(240).nullable(),
  subjectNotificationEvidence: z.string().trim().max(1000).nullable(),
  eventNote: z.string().trim().min(10).max(4000),
  evidenceReference: z.string().trim().max(1000).nullable(),
  expectedVersion: positiveVersion,
});

const holdCreate = z.object({
  scopeType: z.enum(["ORGANISATION", "CLIENT", "MATTER", "DOCUMENT"]),
  scopeId: uuid.nullable(),
  reason: z.string().trim().min(10).max(4000),
  startsAt: dateTime,
  expiresAt: dateTime.nullable(),
});

const policyUpsert = z.object({
  policyKey: z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(180),
  resourceType: z.string().regex(/^[a-z][a-z0-9_]*$/),
  triggerEvent: z.string().trim().min(3).max(160),
  retentionDays: z.number().int().min(1).max(36_500),
  action: z.enum(retentionActions),
  lawfulReason: z.string().trim().min(10).max(2000),
  isActive: z.boolean(),
  expectedVersion: positiveVersion.optional(),
});

const retentionReviewCreate = z.object({
  resourceType: z.string().regex(/^[a-z][a-z0-9_]*$/),
  resourceId: uuid,
  policyId: uuid,
  dueAt: dateTime,
  ownerUserId: uuid.nullable(),
});

const retentionReviewDecision = z.object({
  status: z.enum(retentionReviewStatuses),
  decision: z.enum(retentionActions),
  notes: z.string().trim().min(10).max(4000),
  completionEvidenceReference: z.string().trim().max(1000).nullable(),
  expectedVersion: positiveVersion,
});

const evidenceRecord = z.object({
  evidenceKey: z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(180),
  category: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  evidenceReference: z.string().trim().min(8).max(1000),
  evidenceSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  assessorName: z.string().trim().min(2).max(240),
  assessorOrganisation: z.string().trim().max(240).nullable(),
  scope: z.record(z.string(), z.unknown()),
  testedAt: dateTime,
  expiresAt: dateTime,
  notes: z.string().trim().min(10).max(4000),
  expectedVersion: positiveVersion.optional(),
});

export const complianceAssuranceMutationSchema = z.discriminatedUnion(
  "operation",
  [
    z.object({
      operation: z.literal("right.create"),
      organisationId: uuid,
      payload: rightCreate,
    }),
    z.object({
      operation: z.literal("right.transition"),
      organisationId: uuid,
      requestId: uuid,
      payload: rightTransition,
    }),
    z.object({
      operation: z.literal("right.extend"),
      organisationId: uuid,
      requestId: uuid,
      payload: rightExtend,
    }),
    z.object({
      operation: z.literal("incident.create"),
      organisationId: uuid,
      payload: incidentCreate,
    }),
    z.object({
      operation: z.literal("incident.update"),
      organisationId: uuid,
      incidentId: uuid,
      payload: incidentUpdate,
    }),
    z.object({
      operation: z.literal("hold.create"),
      organisationId: uuid,
      payload: holdCreate,
    }),
    z.object({
      operation: z.literal("hold.release"),
      organisationId: uuid,
      holdId: uuid,
      payload: z.object({
        releaseReason: z.string().trim().min(10).max(4000),
        expectedVersion: positiveVersion,
      }),
    }),
    z.object({
      operation: z.literal("policy.upsert"),
      organisationId: uuid,
      payload: policyUpsert,
    }),
    z.object({
      operation: z.literal("retention-review.create"),
      organisationId: uuid,
      payload: retentionReviewCreate,
    }),
    z.object({
      operation: z.literal("retention-review.decide"),
      organisationId: uuid,
      reviewId: uuid,
      payload: retentionReviewDecision,
    }),
    z.object({
      operation: z.literal("evidence.record"),
      organisationId: uuid,
      payload: evidenceRecord,
    }),
    z.object({
      operation: z.literal("evidence.review"),
      organisationId: uuid,
      evidenceId: uuid,
      payload: z.object({
        status: z.enum(["PASS", "FAIL", "BLOCKED"]),
        reviewNote: z.string().trim().min(10).max(4000),
        expectedVersion: positiveVersion,
      }),
    }),
    z.object({
      operation: z.literal("release.decide"),
      organisationId: uuid,
      payload: z.object({
        releaseReference: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{6,127}$/),
        environment: z.enum(["PRODUCTION", "STAGING"]),
        decision: z.enum(["BLOCKED", "APPROVED", "REVOKED"]),
        rationale: z.string().trim().min(20).max(4000),
        changeReference: z.string().trim().max(1000).nullable(),
      }),
    }),
  ],
);

export const complianceMutationResultSchema = z
  .object({
    id: uuid,
  })
  .passthrough();

export const dataSubjectExportCandidateSchema = z.object({
  schemaVersion: z.literal("businessos.data-subject-export-candidate.v1"),
  generatedAt: dateTime,
  request: z.record(z.string(), z.unknown()),
  reviewControl: z.object({
    candidateOnly: z.literal(true),
    requiresHumanReview: z.literal(true),
    automaticallyDelivered: z.literal(false),
    scopeNotice: z.string(),
  }),
  clients: z.array(z.record(z.string(), z.unknown())),
  enquiries: z.array(z.record(z.string(), z.unknown())),
  matters: z.array(z.record(z.string(), z.unknown())),
  documentMetadata: z.array(z.record(z.string(), z.unknown())),
  communications: z.array(z.record(z.string(), z.unknown())),
  financialDocuments: z.array(z.record(z.string(), z.unknown())),
  payments: z.array(z.record(z.string(), z.unknown())),
});
