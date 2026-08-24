import { z } from "zod";

const fieldName = z.enum([
  "firstName",
  "lastName",
  "email",
  "phone",
  "country",
  "serviceType",
  "message",
  "marketingConsent",
]);

export const intakeFieldSchema = z.object({
  name: fieldName,
  label: z.string().min(1).max(120),
  type: z.enum(["text", "email", "tel", "textarea", "checkbox", "select"]),
  required: z.boolean().optional().default(false),
  placeholder: z.string().max(240).optional(),
  options: z.array(z.string().min(1).max(120)).max(100).optional(),
});

export const publicIntakeFormSchema = z.object({
  id: z.string().uuid(),
  publicId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  formSchema: z.object({ fields: z.array(intakeFieldSchema).min(1).max(50) }),
  privacyNoticeUrl: z.string().url(),
  privacyNoticeVersion: z.string(),
  allowedOrigins: z.array(z.string()),
  successMessage: z.string(),
  submitButtonLabel: z.string(),
  honeypotField: z.string(),
});
export type PublicIntakeForm = z.infer<typeof publicIntakeFormSchema>;

export const publicIntakeResultSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  submissionId: z.string(),
  enquiryId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
});
