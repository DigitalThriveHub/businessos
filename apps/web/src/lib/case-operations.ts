import { z } from "zod";

export const CASE_TASK_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;
export const CASE_TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const MATTER_DEADLINE_TYPES = [
  "INTERNAL",
  "CLIENT",
  "STATUTORY",
  "COURT",
  "TRIBUNAL",
  "REGULATORY",
  "OTHER",
] as const;
export const MATTER_DEADLINE_STATUSES = [
  "OPEN",
  "SATISFIED",
  "MISSED",
  "CANCELLED",
] as const;
export const DOCUMENT_CATEGORIES = [
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
export const DOCUMENT_SECURITY_CLASSIFICATIONS = [
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
  "LEGALLY_PRIVILEGED",
] as const;
export const DOCUMENT_STATUSES = [
  "PENDING_UPLOAD",
  "PENDING_SCAN",
  "AVAILABLE",
  "QUARANTINED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;
export const DOCUMENT_SCAN_STATUSES = [
  "NOT_SCANNED",
  "PENDING",
  "CLEAN",
  "INFECTED",
  "ERROR",
] as const;
export const DOCUMENT_REQUEST_STATUSES = [
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;
export const DOCUMENT_REQUEST_ITEM_STATUSES = [
  "REQUESTED",
  "RECEIVED",
  "ACCEPTED",
  "REJECTED",
  "WAIVED",
] as const;

export const taskStatusSchema = z.enum(CASE_TASK_STATUSES);
export const taskPrioritySchema = z.enum(CASE_TASK_PRIORITIES);
export const deadlineTypeSchema = z.enum(MATTER_DEADLINE_TYPES);
export const deadlineStatusSchema = z.enum(MATTER_DEADLINE_STATUSES);
export const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);
export const documentClassificationSchema = z.enum(
  DOCUMENT_SECURITY_CLASSIFICATIONS,
);
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export const documentScanStatusSchema = z.enum(DOCUMENT_SCAN_STATUSES);
export const documentRequestStatusSchema = z.enum(DOCUMENT_REQUEST_STATUSES);
export const documentRequestItemStatusSchema = z.enum(
  DOCUMENT_REQUEST_ITEM_STATUSES,
);

const nullableText = z.string().nullable();
const nullableUuid = z.string().uuid().nullable();
const nullableDateTime = z.string().datetime().nullable();
const version = z.number().int().positive();

export const matterOperationHeaderSchema = z.object({
  id: z.string().uuid(),
  matterNumber: z.string(),
  title: z.string(),
  serviceType: z.string(),
  status: z.string(),
  priority: z.string(),
  primaryClientId: z.string().uuid(),
  primaryClientName: z.string(),
});

export const organisationMemberOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
});

export const matterTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: nullableText,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assignedToUserId: nullableUuid,
  assignedToName: nullableText,
  dueAt: nullableDateTime,
  reminderAt: nullableDateTime,
  blockedReason: nullableText,
  completionNote: nullableText,
  completedAt: nullableDateTime,
  cancellationReason: nullableText,
  version,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MatterTask = z.infer<typeof matterTaskSchema>;

export const matterDeadlineSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: nullableText,
  deadlineType: deadlineTypeSchema,
  status: deadlineStatusSchema,
  dueAt: z.string().datetime(),
  timezone: z.string(),
  isCritical: z.boolean(),
  ownerUserId: nullableUuid,
  ownerName: nullableText,
  sourceReference: nullableText,
  satisfactionNote: nullableText,
  missedReason: nullableText,
  cancellationReason: nullableText,
  version,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MatterDeadline = z.infer<typeof matterDeadlineSchema>;

export const documentRequestItemSchema = z.object({
  id: z.string().uuid(),
  category: documentCategorySchema,
  title: z.string(),
  description: nullableText,
  isRequired: z.boolean(),
  status: documentRequestItemStatusSchema,
  statusReason: nullableText,
});

export const documentRequestSchema = z.object({
  id: z.string().uuid(),
  recipientClientId: nullableUuid,
  recipientClientName: nullableText,
  title: z.string(),
  message: nullableText,
  status: documentRequestStatusSchema,
  dueAt: nullableDateTime,
  sentAt: nullableDateTime,
  completedAt: nullableDateTime,
  statusReason: nullableText,
  version,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  items: z.array(documentRequestItemSchema),
});
export type DocumentRequest = z.infer<typeof documentRequestSchema>;

export const matterDocumentVersionSchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  originalFileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
  storageBucket: z.string(),
  storagePath: z.string(),
  status: documentStatusSchema,
  scanStatus: documentScanStatusSchema,
  uploadedAt: nullableDateTime,
  scanCompletedAt: nullableDateTime,
});

export const matterDocumentSchema = z.object({
  id: z.string().uuid(),
  requestItemId: nullableUuid,
  title: z.string(),
  category: documentCategorySchema,
  securityClassification: documentClassificationSchema,
  status: documentStatusSchema,
  clientVisible: z.boolean(),
  retentionReviewAt: nullableDateTime,
  version,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentVersion: matterDocumentVersionSchema.nullable(),
  pendingVersion: matterDocumentVersionSchema.nullable(),
});
export type MatterDocument = z.infer<typeof matterDocumentSchema>;

export const matterTimelineEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  sourceType: z.string(),
  sourceId: nullableUuid,
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  actorType: z.enum([
    "USER",
    "AI_AGENT",
    "SERVICE",
    "SUPPORT",
    "SYSTEM",
    "ANONYMOUS",
  ]),
  actorUserId: nullableUuid,
  actorIdentifier: nullableText,
  actorName: z.string(),
  occurredAt: z.string().datetime(),
});

export const matterOperationsSchema = z.object({
  matter: matterOperationHeaderSchema,
  members: z.array(organisationMemberOptionSchema),
  tasks: z.array(matterTaskSchema),
  deadlines: z.array(matterDeadlineSchema),
  documentRequests: z.array(documentRequestSchema),
  documents: z.array(matterDocumentSchema),
  timeline: z.array(matterTimelineEventSchema),
});
export type MatterOperations = z.infer<typeof matterOperationsSchema>;

export const documentUploadRegistrationSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  storageBucket: z.literal("businessos-documents"),
  storagePath: z.string().min(1),
  expectedContentType: z.string().min(1),
  expectedSizeBytes: z.number().int().positive().max(52_428_800),
  status: z.literal("PENDING_UPLOAD"),
});
export type DocumentUploadRegistration = z.infer<
  typeof documentUploadRegistrationSchema
>;

export const documentProcessingSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  documentStatus: documentStatusSchema,
  scanStatus: documentScanStatusSchema,
});

export const caseOperationsReadQuerySchema = z.object({
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
});

const nullableInputText = z.string().trim().max(10_000).nullable().optional();
const nullableInputUuid = z.string().uuid().nullable().optional();
const nullableInputDateTime = z.string().datetime().nullable().optional();

const taskCreate = z.object({
  operation: z.literal("task.create"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  payload: z.object({
    title: z.string().trim().min(1).max(240),
    description: nullableInputText,
    priority: taskPrioritySchema.optional(),
    assignedToUserId: nullableInputUuid,
    dueAt: nullableInputDateTime,
    reminderAt: nullableInputDateTime,
  }),
});

const taskUpdate = z.object({
  operation: z.literal("task.update"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  taskId: z.string().uuid(),
  payload: z.object({
    version,
    title: z.string().trim().min(1).max(240).optional(),
    description: nullableInputText,
    priority: taskPrioritySchema.optional(),
    assignedToUserId: nullableInputUuid,
    dueAt: nullableInputDateTime,
    reminderAt: nullableInputDateTime,
  }),
});

const taskStatus = z.object({
  operation: z.literal("task.status"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  taskId: z.string().uuid(),
  payload: z.object({
    version,
    status: taskStatusSchema,
    blockedReason: z.string().trim().min(1).max(1000).nullable().optional(),
    completionNote: z.string().trim().max(2000).nullable().optional(),
    reason: z.string().trim().min(1).max(1000).nullable().optional(),
  }),
});

const deadlineCreate = z.object({
  operation: z.literal("deadline.create"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  payload: z.object({
    title: z.string().trim().min(1).max(240),
    description: nullableInputText,
    deadlineType: deadlineTypeSchema,
    dueAt: z.string().datetime(),
    timezone: z.string().trim().min(1).max(64).optional(),
    isCritical: z.boolean().optional(),
    ownerUserId: nullableInputUuid,
    sourceReference: z.string().trim().max(240).nullable().optional(),
  }),
});

const deadlineUpdate = z.object({
  operation: z.literal("deadline.update"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  deadlineId: z.string().uuid(),
  payload: z.object({
    version,
    title: z.string().trim().min(1).max(240).optional(),
    description: nullableInputText,
    deadlineType: deadlineTypeSchema.optional(),
    dueAt: z.string().datetime().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    isCritical: z.boolean().optional(),
    ownerUserId: nullableInputUuid,
    sourceReference: z.string().trim().max(240).nullable().optional(),
  }),
});

const deadlineStatus = z.object({
  operation: z.literal("deadline.status"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  deadlineId: z.string().uuid(),
  payload: z.object({
    version,
    status: deadlineStatusSchema,
    reason: z.string().trim().min(1).max(2000),
  }),
});

const requestCreate = z.object({
  operation: z.literal("document-request.create"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  payload: z.object({
    recipientClientId: nullableInputUuid,
    title: z.string().trim().min(1).max(240),
    message: nullableInputText,
    dueAt: nullableInputDateTime,
    items: z
      .array(
        z.object({
          category: documentCategorySchema,
          title: z.string().trim().min(1).max(240),
          description: z.string().trim().max(2000).nullable().optional(),
          isRequired: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(25),
  }),
});

const requestSend = z.object({
  operation: z.literal("document-request.send"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  requestId: z.string().uuid(),
  payload: z.object({ version }),
});

const requestStatus = z.object({
  operation: z.literal("document-request.status"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  requestId: z.string().uuid(),
  payload: z.object({
    version,
    status: z.enum(["COMPLETED", "CANCELLED", "EXPIRED"]),
    reason: z.string().trim().min(1).max(1000),
  }),
});

const fileMetadata = z.object({
  originalFileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(52_428_800),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
});

const documentRegister = z.object({
  operation: z.literal("document.register"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  payload: fileMetadata.extend({
    requestItemId: nullableInputUuid,
    title: z.string().trim().min(1).max(240),
    category: documentCategorySchema,
    securityClassification: documentClassificationSchema,
    clientVisible: z.boolean().optional(),
    retentionReviewAt: nullableInputDateTime,
  }),
});

const documentVersionRegister = z.object({
  operation: z.literal("document.version.register"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  payload: fileMetadata,
});

const documentFinalise = z.object({
  operation: z.literal("document.finalise"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  payload: z.object({}).strict(),
});

const documentUpdate = z.object({
  operation: z.literal("document.update"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  payload: z.object({
    version,
    title: z.string().trim().min(1).max(240).optional(),
    category: documentCategorySchema.optional(),
    securityClassification: documentClassificationSchema.optional(),
    clientVisible: z.boolean().optional(),
    retentionReviewAt: nullableInputDateTime,
  }),
});

const documentArchive = z.object({
  operation: z.literal("document.archive"),
  organisationId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  payload: z.object({ version, reason: z.string().trim().min(1).max(1000) }),
});

export const caseOperationsMutationSchema = z.discriminatedUnion("operation", [
  taskCreate,
  taskUpdate,
  taskStatus,
  deadlineCreate,
  deadlineUpdate,
  deadlineStatus,
  requestCreate,
  requestSend,
  requestStatus,
  documentRegister,
  documentVersionRegister,
  documentFinalise,
  documentUpdate,
  documentArchive,
]);
export type CaseOperationsMutation = z.infer<
  typeof caseOperationsMutationSchema
>;