import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();
const provider = z.enum(["WORDPRESS", "STRIPE", "GENERIC"]);
const status = z.enum(["ACTIVE", "DISABLED"]);

export const integrationConnectionSchema = z.object({
  id: uuid,
  organisationId: uuid,
  provider,
  displayName: z.string(),
  status,
  externalAccountReference: z.string().nullable().optional(),
  secretVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  createdAt: dateTime.optional(),
  updatedAt: dateTime.optional(),
  processed24Hours: z.number().int().nonnegative().optional(),
  failed24Hours: z.number().int().nonnegative().optional(),
  lastEventAt: nullableDateTime.optional(),
  signingSecret: z.string().optional(),
});
export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;

export const integrationsDashboardSchema = z.object({
  generatedAt: dateTime,
  connections: z.array(integrationConnectionSchema),
  recentEvents: z.array(
    z.object({
      id: uuid,
      connectionId: uuid,
      provider,
      direction: z.enum(["INBOUND", "OUTBOUND"]),
      externalEventId: z.string(),
      eventType: z.string(),
      status: z.enum(["RECEIVED", "PROCESSED", "FAILED", "IGNORED"]),
      payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
      correlationId: uuid,
      subjectType: z.string().nullable(),
      subjectId: uuid.nullable(),
      errorCode: z.string().nullable(),
      occurredAt: dateTime,
      receivedAt: dateTime,
      processedAt: nullableDateTime,
    }),
  ),
});
export type IntegrationsDashboard = z.infer<typeof integrationsDashboardSchema>;

export const integrationsReadQuerySchema = z.object({ organisationId: uuid });

export const integrationMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("connection.create"),
    organisationId: uuid,
    payload: z.object({
      provider,
      displayName: z.string().trim().min(2).max(160),
      externalAccountReference: z
        .string()
        .trim()
        .regex(/^acct_[A-Za-z0-9]{8,}$/)
        .optional(),
    }),
  }),
  z.object({
    operation: z.literal("connection.status"),
    organisationId: uuid,
    connectionId: uuid,
    payload: z.object({
      status,
      expectedVersion: z.number().int().positive(),
    }),
  }),
  z.object({
    operation: z.literal("connection.rotate-secret"),
    organisationId: uuid,
    connectionId: uuid,
    payload: z.object({ expectedVersion: z.number().int().positive() }),
  }),
]);
export type IntegrationMutation = z.infer<typeof integrationMutationSchema>;
