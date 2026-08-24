import { z } from "zod";

export const ENQUIRY_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONSULTATION_BOOKED",
  "CONVERTED",
  "CLOSED",
  "SPAM",
] as const;

export const ENQUIRY_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const enquiryStatusSchema = z.enum(ENQUIRY_STATUSES);
export const enquiryPrioritySchema = z.enum(ENQUIRY_PRIORITIES);

export type EnquiryStatus = z.infer<typeof enquiryStatusSchema>;
export type EnquiryPriority = z.infer<typeof enquiryPrioritySchema>;

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONSULTATION_BOOKED: "Consultation booked",
  CONVERTED: "Converted",
  CLOSED: "Closed",
  SPAM: "Spam",
};

export const ENQUIRY_PRIORITY_LABELS: Record<EnquiryPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

const optionalText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .optional()
    .transform((value) => value || undefined);

const nullableText = (maximumLength: number) =>
  z.string().max(maximumLength).nullable();

export const enquirySchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),

  firstName: z.string(),
  lastName: z.string().nullable(),

  email: z.string().nullable(),
  phone: z.string().nullable(),
  country: z.string().nullable(),

  serviceType: z.string().nullable(),
  source: z.string().nullable(),
  message: z.string().nullable(),

  status: enquiryStatusSchema,
  priority: enquiryPrioritySchema,

  nextFollowUpAt: z.string().datetime().nullable(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Enquiry = z.infer<typeof enquirySchema>;

export const enquiryListResponseSchema = z.object({
  items: z.array(enquirySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type EnquiryListResponse = z.infer<typeof enquiryListResponseSchema>;

export const enquiryQuerySchema = z.object({
  organisationId: z.string().uuid(),

  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || undefined),

  status: enquiryStatusSchema.optional(),
  priority: enquiryPrioritySchema.optional(),
  assignedToUserId: z.string().uuid().optional(),
});

export type EnquiryQuery = z.infer<typeof enquiryQuerySchema>;

export const createEnquirySchema = z.object({
  organisationId: z.string().uuid(),

  firstName: z.string().trim().min(1).max(100),
  lastName: optionalText(100),

  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal(""))
    .transform((value) => value || undefined),

  phone: optionalText(50),
  country: optionalText(100),

  serviceType: optionalText(160),
  source: optionalText(100),
  message: optionalText(10_000),

  status: enquiryStatusSchema.default("NEW"),
  priority: enquiryPrioritySchema.default("NORMAL"),

  nextFollowUpAt: z.string().datetime().optional(),
});

export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;

export const updateEnquirySchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),

    lastName: nullableText(100).optional(),

    email: z
      .union([z.string().trim().email().max(320), z.literal(""), z.null()])
      .optional(),

    phone: nullableText(50).optional(),
    country: nullableText(100).optional(),

    serviceType: nullableText(160).optional(),
    source: nullableText(100).optional(),
    message: nullableText(10_000).optional(),

    status: enquiryStatusSchema.optional(),
    priority: enquiryPrioritySchema.optional(),

    nextFollowUpAt: z.string().datetime().nullable().optional(),
    assignedToUserId: z.string().uuid().optional(),
    lastContactedAt: z.string().datetime().optional(),
  })
  .strict();

export type UpdateEnquiryInput = z.infer<typeof updateEnquirySchema>;
