import { z } from "zod";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTime = z.string().datetime({ offset: true });
const nullableDate = date.nullable();
const nullableDateTime = dateTime.nullable();
const nullableText = z.string().nullable();
const moneyMinor = z.string().regex(/^\d+$/);

export const financeSettingsSchema = z.object({
  id: uuid,
  organisationId: uuid,
  legalName: nullableText,
  addressLine1: nullableText,
  addressLine2: nullableText,
  city: nullableText,
  region: nullableText,
  postalCode: nullableText,
  countryCode: z.string().length(2),
  vatScheme: z.enum([
    "NOT_REGISTERED",
    "STANDARD",
    "CASH_ACCOUNTING",
    "FLAT_RATE",
  ]),
  vatRegistrationNumber: nullableText,
  baseCurrency: z.string().length(3),
  invoicePrefix: z.string(),
  creditNotePrefix: z.string(),
  paymentPrefix: z.string(),
  paymentTermsDays: z.number().int().min(0).max(365),
  paymentInstructions: nullableText,
  version: z.number().int().positive(),
  updatedAt: dateTime,
});

export const financeDocumentLineSchema = z.object({
  id: uuid,
  position: z.number().int().positive(),
  description: z.string(),
  quantityMilli: z.number().int().positive(),
  unitAmountMinor: moneyMinor,
  taxCategory: z.string(),
  vatRateBasisPoints: z.number().int().nonnegative(),
  netMinor: moneyMinor,
  taxMinor: moneyMinor,
  grossMinor: moneyMinor,
});

export const financeDocumentSchema = z.object({
  id: uuid,
  organisationId: uuid,
  clientId: uuid,
  clientName: z.string(),
  clientNumber: z.string(),
  matterId: uuid.nullable(),
  matterNumber: nullableText,
  documentType: z.enum(["INVOICE", "CREDIT_NOTE"]),
  status: z.string(),
  documentNumber: nullableText,
  relatedDocumentId: uuid.nullable(),
  currencyCode: z.string().length(3),
  issueDate: nullableDate,
  dueDate: nullableDate,
  reference: nullableText,
  notes: nullableText,
  sellerSnapshot: z.record(z.string(), z.unknown()),
  customerSnapshot: z.record(z.string(), z.unknown()),
  subtotalMinor: moneyMinor,
  taxMinor: moneyMinor,
  totalMinor: moneyMinor,
  allocatedMinor: moneyMinor,
  creditedMinor: moneyMinor,
  balanceMinor: moneyMinor,
  clientVisible: z.boolean(),
  version: z.number().int().positive(),
  issuedAt: nullableDateTime,
  voidedAt: nullableDateTime,
  voidReason: nullableText,
  createdAt: dateTime,
  updatedAt: dateTime,
  lines: z.array(financeDocumentLineSchema),
});
export type FinanceDocument = z.infer<typeof financeDocumentSchema>;

export const financePaymentSchema = z.object({
  id: uuid,
  organisationId: uuid,
  clientId: uuid,
  clientName: z.string(),
  paymentNumber: z.string(),
  paymentType: z.enum(["RECEIPT", "REFUND"]),
  method: z.string(),
  status: z.string(),
  currencyCode: z.string().length(3),
  amountMinor: moneyMinor,
  occurredAt: dateTime,
  reference: nullableText,
  provider: nullableText,
  providerReference: nullableText,
  relatedPaymentId: uuid.nullable(),
  createdAt: dateTime,
  allocations: z.array(
    z.object({
      documentId: uuid,
      documentNumber: nullableText,
      amountMinor: moneyMinor,
    }),
  ),
});

export const financeDashboardSchema = z.object({
  settings: financeSettingsSchema,
  summary: z.object({
    draftCount: z.number().int().nonnegative(),
    openCount: z.number().int().nonnegative(),
    overdueCount: z.number().int().nonnegative(),
    receivableMinor: moneyMinor,
    received30DaysMinor: moneyMinor,
  }),
  clients: z.array(
    z.object({
      id: uuid,
      clientNumber: z.string(),
      displayName: z.string(),
      email: nullableText,
    }),
  ),
  matters: z.array(
    z.object({
      id: uuid,
      matterNumber: z.string(),
      title: z.string(),
      clientId: uuid,
    }),
  ),
  documents: z.array(financeDocumentSchema),
  payments: z.array(financePaymentSchema),
  journal: z.array(
    z.object({
      id: uuid,
      entryNumber: z.string(),
      source: z.string(),
      sourceId: uuid,
      entryDate: date,
      description: z.string(),
      postedAt: dateTime,
      debitMinor: moneyMinor,
      creditMinor: moneyMinor,
    }),
  ),
});
export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;

export const financeReadQuerySchema = z.object({ organisationId: uuid });

const settingsPayload = financeSettingsSchema
  .omit({ id: true, organisationId: true, updatedAt: true })
  .extend({ expectedVersion: z.number().int().positive() })
  .omit({ version: true });

const documentLineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantityMilli: z.number().int().min(1).max(1_000_000),
  unitAmountMinor: z.number().int().min(0).max(100_000_000_000),
  taxCategory: z.enum([
    "STANDARD",
    "REDUCED",
    "ZERO",
    "EXEMPT",
    "OUTSIDE_SCOPE",
  ]),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
});

export const financeMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("settings.update"),
    organisationId: uuid,
    payload: settingsPayload,
  }),
  z.object({
    operation: z.literal("document.create"),
    organisationId: uuid,
    payload: z.object({
      clientId: uuid,
      matterId: uuid.optional(),
      documentType: z.enum(["INVOICE", "CREDIT_NOTE"]),
      relatedDocumentId: uuid.optional(),
      currencyCode: z.string().length(3),
      issueDate: date.optional(),
      dueDate: date.optional(),
      reference: z.string().trim().max(120).nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
      clientVisible: z.boolean().optional(),
      lines: z.array(documentLineInput).min(1).max(100),
    }),
  }),
  z.object({
    operation: z.literal("document.issue"),
    organisationId: uuid,
    documentId: uuid,
    payload: z.object({ expectedVersion: z.number().int().positive() }),
  }),
  z.object({
    operation: z.literal("document.void"),
    organisationId: uuid,
    documentId: uuid,
    payload: z.object({
      expectedVersion: z.number().int().positive(),
      reason: z.string().trim().min(3).max(1000),
    }),
  }),
  z.object({
    operation: z.literal("payment.record"),
    organisationId: uuid,
    payload: z.object({
      clientId: uuid,
      paymentType: z.enum(["RECEIPT", "REFUND"]),
      method: z.enum([
        "BANK_TRANSFER",
        "CARD",
        "CASH",
        "DIRECT_DEBIT",
        "CHEQUE",
        "OTHER",
      ]),
      currencyCode: z.string().length(3),
      amountMinor: z.number().int().positive().max(100_000_000_000),
      occurredAt: dateTime,
      reference: z.string().trim().max(240).nullable().optional(),
      provider: z.string().trim().max(80).nullable().optional(),
      providerReference: z.string().trim().max(240).nullable().optional(),
      relatedPaymentId: uuid.optional(),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/),
      allocations: z
        .array(
          z.object({
            documentId: uuid,
            amountMinor: z.number().int().positive().max(100_000_000_000),
          }),
        )
        .min(1)
        .max(100),
    }),
  }),
]);
export type FinanceMutation = z.infer<typeof financeMutationSchema>;
