import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const nullableDateTime = dateTime.nullable();
const connectionProvider = z.enum([
  "WORDPRESS",
  "STRIPE",
  "GENERIC",
  "MICROSOFT_365",
  "GOOGLE_WORKSPACE",
  "WHATSAPP_BUSINESS",
]);
const configurableProvider = z.enum(["WORDPRESS", "STRIPE", "GENERIC"]);
const status = z.enum(["ACTIVE", "DISABLED"]);

export const integrationConnectionSchema = z.object({
  id: uuid,
  organisationId: uuid,
  provider: connectionProvider,
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
      provider: connectionProvider,
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

export const intakeFormSchema = z.object({
  id: uuid,
  organisationId: uuid.optional(),
  connectionId: uuid,
  publicId: uuid,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]),
  formSchema: z.object({
    fields: z.array(
      z.object({
        name: z.enum([
          "firstName",
          "lastName",
          "email",
          "phone",
          "country",
          "serviceType",
          "message",
          "marketingConsent",
        ]),
        label: z.string(),
        type: z.enum([
          "text",
          "email",
          "tel",
          "textarea",
          "checkbox",
          "select",
        ]),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        options: z.array(z.string()).optional(),
      }),
    ),
  }),
  privacyNoticeUrl: z.string().url(),
  privacyNoticeVersion: z.string(),
  allowedOrigins: z.array(z.string()),
  version: z.number().int().positive(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type IntakeForm = z.infer<typeof intakeFormSchema>;

export const gateHDashboardSchema = z.object({
  generatedAt: dateTime,
  forms: z.array(intakeFormSchema),
  submissionCounts: z.object({
    accepted24Hours: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
  }),
  unlinkedCommunications: z.number().int().nonnegative(),
  failedDeliveries: z.number().int().nonnegative(),
});
export type GateHDashboard = z.infer<typeof gateHDashboardSchema>;

export const integrationsReadQuerySchema = z.object({
  organisationId: uuid,
  view: z.enum(["connections", "gate-h"]).optional().default("connections"),
});

export const integrationMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("connection.create"),
    organisationId: uuid,
    payload: z.object({
      provider: configurableProvider,
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
  z.object({
    operation: z.literal("form.create"),
    organisationId: uuid,
    payload: z.object({
      connectionId: uuid,
      key: z
        .string()
        .trim()
        .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
      name: z.string().trim().min(2).max(180),
      description: z.string().trim().max(1000).optional(),
      privacyNoticeUrl: z.string().url(),
      privacyNoticeVersion: z.string().trim().min(1).max(80),
      allowedOrigins: z.array(z.string().url()).min(1).max(50),
      formSchema: z.object({
        fields: z
          .array(
            z.object({
              name: z.enum([
                "firstName",
                "lastName",
                "email",
                "phone",
                "country",
                "serviceType",
                "message",
                "marketingConsent",
              ]),
              label: z.string().min(1).max(120),
              type: z.enum([
                "text",
                "email",
                "tel",
                "textarea",
                "checkbox",
                "select",
              ]),
              required: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    }),
  }),
  z.object({
    operation: z.literal("form.status"),
    organisationId: uuid,
    formId: uuid,
    payload: z.object({
      status: z.enum(["DRAFT", "ACTIVE", "DISABLED"]),
      expectedVersion: z.number().int().positive(),
    }),
  }),
]);
export type IntegrationMutation = z.infer<typeof integrationMutationSchema>;
