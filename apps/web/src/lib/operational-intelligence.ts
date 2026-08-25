import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nonNegativeInteger = z.number().int().nonnegative();

export const documentCategories = [
  "GENERAL",
  "IDENTITY",
  "FINANCIAL",
  "LEGAL",
  "EVIDENCE",
  "CLIENT_CARE",
  "SUBMISSION",
  "DECISION",
  "CORRESPONDENCE",
  "OTHER",
] as const;

const workItemSchema = z.object({
  kind: z.enum(["TASK", "DEADLINE"]),
  id: uuid,
  matterId: uuid,
  matterNumber: z.string(),
  title: z.string(),
  dueAt: dateTime.nullable(),
  priority: z.string(),
  status: z.string(),
});

export const documentIntelligenceItemSchema = z.object({
  analysisId: uuid,
  documentId: uuid,
  matterId: uuid,
  matterNumber: z.string(),
  matterTitle: z.string(),
  documentTitle: z.string(),
  currentCategory: z.enum(documentCategories),
  detectedCategory: z.enum(documentCategories).nullable(),
  categoryConfidenceBps: z.number().int().min(0).max(10_000).nullable(),
  status: z.enum(["PENDING", "PROCESSING", "READY", "ERROR"]),
  reviewPriority: z.enum(["ROUTINE", "ATTENTION", "URGENT"]),
  summary: z.string().nullable(),
  suggestedExpiryDate: dateOnly.nullable(),
  missingPages: z.array(z.number().int().positive()),
  missingInformation: z.array(z.string()),
  inconsistencies: z.array(z.string()),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: dateTime,
  completedAt: dateTime.nullable(),
  errorCode: z.string().nullable(),
  jobStatus: z
    .enum([
      "QUEUED",
      "LEASED",
      "SUCCEEDED",
      "CANCELLED",
      "FAILED",
      "DEAD_LETTER",
    ])
    .nullable(),
  canReview: z.boolean(),
});

const controlTowerSchema = z.object({
  summary: z.object({
    newEnquiriesThirtyDays: nonNegativeInteger,
    conversionsThirtyDays: nonNegativeInteger,
    openMatters: nonNegativeInteger,
    completedThirtyDays: nonNegativeInteger,
    unassignedMatters: nonNegativeInteger,
    noNextAction: nonNegativeInteger,
    overdueTasks: nonNegativeInteger,
    slaAtRisk: nonNegativeInteger,
    slaBreached: nonNegativeInteger,
    pendingApprovals: nonNegativeInteger,
    documentReviewBacklog: nonNegativeInteger,
  }),
  workload: z.array(
    z.object({
      userId: uuid,
      displayName: z.string(),
      jobTitle: z.string().nullable(),
      openMatters: nonNegativeInteger,
      openTasks: nonNegativeInteger,
      overdueTasks: nonNegativeInteger,
    }),
  ),
  matterStages: z.record(z.string(), nonNegativeInteger),
  enquiryStages: z.record(z.string(), nonNegativeInteger),
});

const benchmarkSchema = z.object({
  id: uuid,
  eventKey: z.string(),
  label: z.string(),
  category: z.string(),
  manualMinutes: nonNegativeInteger,
  automatedMinutes: nonNegativeInteger,
  hourlyCostMinor: z.string().regex(/^\d+$/),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: dateTime,
});

const operationalValueSchema = z.object({
  periodDays: z.number().int().positive(),
  estimateBasis: z.literal("ORGANISATION_CONFIGURABLE_BENCHMARKS"),
  disclaimer: z.string(),
  estimatedMinutesSaved: z.string().regex(/^\d+$/),
  estimatedValueMinor: z.string().regex(/^\d+$/),
  eventCount: nonNegativeInteger,
  benchmarks: z.array(benchmarkSchema),
  recentEvents: z.array(
    z.object({
      id: uuid,
      eventKey: z.string(),
      category: z.string(),
      sourceType: z.string(),
      estimatedMinutesSaved: nonNegativeInteger,
      estimatedValueMinor: z.string().regex(/^\d+$/),
      occurredAt: dateTime,
    }),
  ),
});

export const operationalIntelligenceDashboardSchema = z.object({
  generatedAt: dateTime,
  access: z.object({
    documentIntelligence: z.boolean(),
    documentReview: z.boolean(),
    controlTower: z.boolean(),
    operationalValue: z.boolean(),
    operationalValueManage: z.boolean(),
    assuranceLevel: z.enum(["AAL1", "AAL2"]),
  }),
  provider: z.object({
    state: z.enum(["FREE_MODE", "READY"]),
    generationEnabled: z.boolean(),
    manualReviewAvailable: z.literal(true),
    model: z.string().nullable(),
    costRatesConfigured: z.boolean(),
  }),
  myWork: z.object({
    summary: z.object({
      openTasks: nonNegativeInteger,
      overdueTasks: nonNegativeInteger,
      deadlinesNextSevenDays: nonNegativeInteger,
      pendingApprovals: nonNegativeInteger,
      waitingOnCustomer: nonNegativeInteger,
      documentReviews: nonNegativeInteger,
    }),
    items: z.array(workItemSchema),
  }),
  documents: z.object({
    summary: z.object({
      awaitingAnalysis: nonNegativeInteger,
      processing: nonNegativeInteger,
      readyForReview: nonNegativeInteger,
      urgent: nonNegativeInteger,
      failed: nonNegativeInteger,
      expiringThirtyDays: nonNegativeInteger,
    }),
    items: z.array(documentIntelligenceItemSchema),
  }),
  controlTower: controlTowerSchema.nullable(),
  value: operationalValueSchema.nullable(),
});

export type OperationalIntelligenceDashboard = z.infer<
  typeof operationalIntelligenceDashboardSchema
>;
export type DocumentIntelligenceItem = z.infer<
  typeof documentIntelligenceItemSchema
>;
export type OperationalValueBenchmark = z.infer<typeof benchmarkSchema>;

export const operationalIntelligenceReadQuerySchema = z.object({
  organisationId: uuid,
});

const reviewPayloadSchema = z.object({
  decision: z.enum(["ACCEPTED", "CORRECTED", "REJECTED"]),
  confirmedCategory: z.enum(documentCategories),
  confirmedExpiryDate: dateOnly.nullable(),
  corrections: z.record(z.string(), z.unknown()),
  notes: z.string().trim().min(3).max(2000),
  createFollowUpTask: z.boolean(),
  expectedVersion: z.number().int().positive(),
});

const benchmarkPayloadSchema = z
  .object({
    estimatedManualMinutes: z.number().int().min(0).max(1440),
    estimatedAutomatedMinutes: z.number().int().min(0).max(1440),
    hourlyCostMinor: z.number().int().min(0).max(10_000_000),
    isActive: z.boolean(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (value) => value.estimatedAutomatedMinutes <= value.estimatedManualMinutes,
    {
      path: ["estimatedAutomatedMinutes"],
      message: "Automated minutes cannot exceed manual minutes.",
    },
  );

export const operationalIntelligenceMutationSchema = z.discriminatedUnion(
  "operation",
  [
    z.object({
      operation: z.literal("document.review"),
      organisationId: uuid,
      analysisId: uuid,
      payload: reviewPayloadSchema,
    }),
    z.object({
      operation: z.literal("benchmark.update"),
      organisationId: uuid,
      benchmarkId: uuid,
      payload: benchmarkPayloadSchema,
    }),
  ],
);

export const documentReviewResultSchema = z.object({
  analysisId: uuid,
  reviewId: uuid,
  documentId: uuid,
  status: z.enum(["REVIEWED", "REJECTED"]),
  decision: z.enum(["ACCEPTED", "CORRECTED", "REJECTED"]),
  followUpTaskId: uuid.nullable(),
  reviewedAt: dateTime,
  version: z.number().int().positive(),
});

export const benchmarkUpdateResultSchema = z.object({
  id: uuid,
  eventKey: z.string(),
  manualMinutes: nonNegativeInteger,
  automatedMinutes: nonNegativeInteger,
  hourlyCostMinor: z.string().regex(/^\d+$/),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: dateTime,
});
