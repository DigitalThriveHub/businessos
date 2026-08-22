import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();

export const portalDocumentSchema = z.object({
  id: uuid,
  organisationId: uuid,
  matterId: uuid,
  requestItemId: uuid.nullable(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  versionId: uuid,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  storageBucket: z.string(),
  storagePath: z.string(),
  uploadedAt: nullableDateTime,
  scanStatus: z.string(),
});

const portalMessageSchema = z.object({
  id: uuid,
  direction: z.string(),
  actorType: z.string(),
  subject: z.string().nullable(),
  bodyText: z.string(),
  status: z.string(),
  deliveredAt: nullableDateTime,
  readAt: nullableDateTime,
  createdAt: dateTime,
});

export const clientPortalDashboardSchema = z.object({
  profile: z
    .object({ id: uuid, email: z.string().email(), displayName: z.string() })
    .nullable(),
  accessGrants: z.array(
    z.object({
      id: uuid,
      organisationId: uuid,
      organisationName: z.string(),
      organisationSlug: z.string(),
      timezone: z.string(),
      clientId: uuid,
      clientNumber: z.string(),
      clientName: z.string(),
      clientEmail: z.string().email().nullable(),
      scopes: z.array(z.string()),
    }),
  ),
  matters: z.array(
    z.object({
      accessGrantId: uuid,
      organisationId: uuid,
      clientId: uuid,
      id: uuid,
      matterNumber: z.string(),
      title: z.string(),
      serviceType: z.string(),
      status: z.string(),
      priority: z.string(),
      openedAt: dateTime,
      targetCompletionAt: nullableDateTime,
      closedAt: nullableDateTime,
    }),
  ),
  updates: z.array(
    z.object({
      id: uuid,
      organisationId: uuid,
      matterId: uuid,
      title: z.string(),
      summary: z.string(),
      stageKey: z.string().nullable(),
      progressPercent: z.number().int().min(0).max(100).nullable(),
      publishedAt: dateTime,
    }),
  ),
  documentRequests: z.array(
    z.object({
      id: uuid,
      organisationId: uuid,
      matterId: uuid,
      title: z.string(),
      message: z.string().nullable(),
      status: z.string(),
      dueAt: nullableDateTime,
      sentAt: nullableDateTime,
      completedAt: nullableDateTime,
      items: z.array(
        z.object({
          id: uuid,
          category: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          isRequired: z.boolean(),
          status: z.string(),
          statusReason: z.string().nullable(),
        }),
      ),
    }),
  ),
  documents: z.array(portalDocumentSchema),
  conversations: z.array(
    z.object({
      id: uuid,
      organisationId: uuid,
      matterId: uuid,
      clientId: uuid,
      subject: z.string(),
      status: z.string(),
      lastMessageAt: nullableDateTime,
      messages: z.array(portalMessageSchema),
    }),
  ),
  notifications: z.array(
    z.object({
      id: uuid,
      organisationId: uuid,
      matterId: uuid.nullable(),
      type: z.string(),
      title: z.string(),
      body: z.string(),
      readAt: nullableDateTime,
      createdAt: dateTime,
    }),
  ),
  invoices: z.array(
    z.object({
      id: uuid,
      organisationId: uuid,
      matterId: uuid,
      matterNumber: z.string(),
      documentType: z.enum(["INVOICE", "CREDIT_NOTE"]),
      documentNumber: z.string(),
      status: z.string(),
      currencyCode: z.string().length(3),
      issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      reference: z.string().nullable(),
      subtotalMinor: z.string().regex(/^\d+$/),
      taxMinor: z.string().regex(/^\d+$/),
      totalMinor: z.string().regex(/^\d+$/),
      balanceMinor: z.string().regex(/^\d+$/),
      sellerName: z.string().nullable(),
      paymentInstructions: z.string().nullable(),
    }),
  ),
});
export type ClientPortalDashboard = z.infer<typeof clientPortalDashboardSchema>;

const idempotency = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/);

export const clientPortalMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("invitation.accept"),
    payload: z.object({
      token: z.string().regex(/^bop_v1_[A-Za-z0-9_-]{43}$/),
    }),
  }),
  z.object({
    operation: z.literal("message.post"),
    conversationId: uuid,
    payload: z.object({
      bodyText: z.string().trim().min(1).max(10_000),
      idempotencyKey: idempotency,
    }),
  }),
  z.object({
    operation: z.literal("document.register"),
    payload: z.object({
      requestItemId: uuid,
      originalFileName: z
        .string()
        .trim()
        .min(1)
        .max(255)
        .regex(/^[^\\/]+$/),
      contentType: z.enum([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ]),
      sizeBytes: z.number().int().min(1).max(52_428_800),
      sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  }),
  z.object({
    operation: z.literal("document.finalise"),
    payload: z.object({ documentId: uuid, versionId: uuid }),
  }),
  z.object({
    operation: z.literal("notification.read"),
    notificationId: uuid,
    payload: z.object({}),
  }),
]);
export type ClientPortalMutation = z.infer<typeof clientPortalMutationSchema>;

export const portalInvitationAcceptanceSchema = z.object({
  invitationId: uuid,
  accessGrantId: uuid,
  organisationId: uuid,
  organisationName: z.string(),
  clientId: uuid,
  clientName: z.string(),
  matterIds: z.array(uuid),
  scopes: z.array(z.string()),
  status: z.literal("ACCEPTED"),
});

export const portalMessageResultSchema = z.object({
  messageId: uuid,
  conversationId: uuid,
  status: z.string(),
  createdAt: dateTime,
});

export const portalUploadRegistrationSchema = z.object({
  documentId: uuid,
  versionId: uuid,
  storageBucket: z.string(),
  storagePath: z.string(),
  documentStatus: z.string(),
  scanStatus: z.string(),
});

export const portalUploadFinalisationSchema = z.object({
  documentId: uuid,
  versionId: uuid,
  documentStatus: z.string(),
  scanStatus: z.string(),
});

export const portalNotificationReadSchema = z.object({
  notificationId: uuid,
  readAt: dateTime,
});
