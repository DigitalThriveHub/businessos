import { z } from "zod";

export const COMMUNICATION_CHANNELS = ["PORTAL", "EMAIL", "WHATSAPP"] as const;
export const PORTAL_SCOPES = [
  "MATTER_PROGRESS",
  "DOCUMENTS",
  "MESSAGES",
  "NOTIFICATIONS",
  "BILLING",
] as const;

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();
const nullableText = z.string().nullable();
const channel = z.enum(COMMUNICATION_CHANNELS);
const activeChannel = z.enum(["PORTAL", "EMAIL"]);
const idempotency = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/);

export const communicationMessageSchema = z.object({
  id: uuid,
  direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL"]),
  actorType: z.enum(["STAFF", "CLIENT", "SYSTEM", "AI_AGENT"]),
  authorUserProfileId: nullableUuid.optional(),
  subject: nullableText,
  bodyText: z.string(),
  status: z.string(),
  recipientAddresses: z.array(z.string()).optional(),
  provider: nullableText.optional(),
  providerMessageId: nullableText.optional(),
  sentAt: nullableDateTime.optional(),
  deliveredAt: nullableDateTime,
  readAt: nullableDateTime.optional(),
  failedAt: nullableDateTime.optional(),
  failureCode: nullableText.optional(),
  failureDetail: nullableText.optional(),
  createdAt: dateTime,
});
export type CommunicationMessage = z.infer<typeof communicationMessageSchema>;

export const communicationConversationSchema = z.object({
  id: uuid,
  matterId: nullableUuid,
  matterNumber: nullableText.optional(),
  matterTitle: nullableText.optional(),
  clientId: nullableUuid,
  clientName: nullableText.optional(),
  channel,
  subject: z.string(),
  status: z.string(),
  assignedToUserId: nullableUuid.optional(),
  assignedToName: nullableText.optional(),
  lastMessageAt: nullableDateTime,
  version: z.number().int().positive().optional(),
  createdAt: dateTime,
  messages: z.array(communicationMessageSchema),
});
export type CommunicationConversation = z.infer<
  typeof communicationConversationSchema
>;

export const communicationTemplateSchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  description: nullableText,
  channel,
  subjectTemplate: nullableText,
  bodyTemplate: z.string(),
  allowedVariables: z.array(z.string()),
  status: z.string(),
  version: z.number().int().positive(),
  updatedAt: dateTime,
});

export const portalInvitationSchema = z.object({
  id: uuid,
  clientId: uuid,
  clientName: z.string(),
  email: z.string().email(),
  matterIds: z.array(uuid),
  scopes: z.array(z.enum(PORTAL_SCOPES)),
  status: z.string(),
  expiresAt: dateTime,
  deliveredAt: nullableDateTime,
  deliveryErrorCode: nullableText,
  createdAt: dateTime,
});

export const portalAccessGrantSchema = z.object({
  id: uuid,
  clientId: uuid,
  clientName: z.string(),
  userProfileId: uuid,
  email: z.string().email(),
  status: z.string(),
  scopes: z.array(z.enum(PORTAL_SCOPES)),
  startsAt: dateTime,
  expiresAt: nullableDateTime,
  lastAccessedAt: nullableDateTime,
  revokedAt: nullableDateTime,
  createdAt: dateTime,
  matters: z.array(
    z.object({
      id: uuid,
      matterNumber: z.string(),
      title: z.string(),
    }),
  ),
});

export const communicationReminderSchema = z.object({
  id: uuid,
  conversationId: uuid,
  matterId: nullableUuid,
  clientId: nullableUuid,
  channel,
  recipientAddress: nullableText,
  subject: nullableText,
  bodyText: z.string(),
  scheduledFor: dateTime,
  status: z.string(),
  messageId: nullableUuid,
  failureCode: nullableText,
  createdAt: dateTime,
});

export const communicationsDashboardSchema = z.object({
  conversations: z.array(communicationConversationSchema),
  templates: z.array(communicationTemplateSchema),
  invitations: z.array(portalInvitationSchema),
  accessGrants: z.array(portalAccessGrantSchema),
  reminders: z.array(communicationReminderSchema),
  deliveryEvents: z.array(
    z.object({
      id: uuid,
      messageId: uuid,
      conversationId: uuid,
      subject: z.string(),
      eventType: z.string(),
      provider: nullableText,
      occurredAt: dateTime,
    }),
  ),
});
export type CommunicationsDashboard = z.infer<
  typeof communicationsDashboardSchema
>;

export const communicationsReadQuerySchema = z.object({
  organisationId: uuid,
});

const conversationCreate = z.object({
  operation: z.literal("conversation.create"),
  organisationId: uuid,
  payload: z
    .object({
      matterId: uuid.optional(),
      clientId: uuid.optional(),
      channel: activeChannel,
      subject: z.string().trim().min(1).max(240),
      assignedToUserId: uuid.optional(),
    })
    .refine((value) => value.matterId || value.clientId, {
      message: "A client or matter is required.",
    })
    .refine(
      (value) =>
        value.channel !== "PORTAL" || Boolean(value.matterId && value.clientId),
      { message: "Portal conversations require both a client and matter." },
    ),
});

const messageSend = z.object({
  operation: z.literal("message.send"),
  organisationId: uuid,
  conversationId: uuid,
  payload: z.object({
    subject: z.string().trim().max(500).nullable().optional(),
    bodyText: z.string().trim().min(1).max(50_000),
    recipientAddresses: z.array(z.string().email()).max(20).optional(),
    scheduledAt: dateTime.optional(),
    idempotencyKey: idempotency,
  }),
});

const templateCreate = z.object({
  operation: z.literal("template.create"),
  organisationId: uuid,
  payload: z.object({
    key: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(180),
    description: z.string().trim().max(1000).nullable().optional(),
    channel: activeChannel,
    subjectTemplate: z.string().trim().max(500).nullable().optional(),
    bodyTemplate: z.string().trim().min(1).max(50_000),
    allowedVariables: z.array(z.string()).max(50).optional(),
    status: z.enum(["DRAFT", "ACTIVE"]).optional(),
  }),
});

const invitationCreate = z.object({
  operation: z.literal("invitation.create"),
  organisationId: uuid,
  payload: z.object({
    clientId: uuid,
    email: z.string().trim().email().max(320),
    matterIds: z.array(uuid).min(1).max(50),
    scopes: z.array(z.enum(PORTAL_SCOPES)).min(1).max(5).optional(),
    expiresInHours: z.number().int().min(1).max(336).optional(),
  }),
});

const reasonPayload = z.object({
  reason: z.string().trim().min(3).max(1000),
});

const invitationRevoke = z.object({
  operation: z.literal("invitation.revoke"),
  organisationId: uuid,
  invitationId: uuid,
  payload: reasonPayload,
});

const accessRevoke = z.object({
  operation: z.literal("access.revoke"),
  organisationId: uuid,
  accessGrantId: uuid,
  payload: reasonPayload,
});

const reminderCancel = z.object({
  operation: z.literal("reminder.cancel"),
  organisationId: uuid,
  reminderId: uuid,
  payload: reasonPayload,
});

const portalUpdatePublish = z.object({
  operation: z.literal("portal-update.publish"),
  organisationId: uuid,
  payload: z.object({
    matterId: uuid,
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(10_000),
    stageKey: z.string().trim().max(120).nullable().optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
  }),
});

const reminderSchedule = z.object({
  operation: z.literal("reminder.schedule"),
  organisationId: uuid,
  payload: z.object({
    conversationId: uuid,
    recipientAddress: z.string().trim().email().max(320).nullable().optional(),
    channel: activeChannel,
    subject: z.string().trim().max(500).nullable().optional(),
    bodyText: z.string().trim().min(1).max(50_000),
    scheduledFor: dateTime,
    idempotencyKey: idempotency,
  }),
});

export const communicationsMutationSchema = z.discriminatedUnion("operation", [
  conversationCreate,
  messageSend,
  templateCreate,
  invitationCreate,
  invitationRevoke,
  accessRevoke,
  portalUpdatePublish,
  reminderSchedule,
  reminderCancel,
]);
export type CommunicationsMutation = z.infer<
  typeof communicationsMutationSchema
>;

export const genericMutationResultSchema = z.record(z.string(), z.unknown());
