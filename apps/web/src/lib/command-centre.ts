import { z } from "zod";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });

export const commandCentreDashboardSchema = z.object({
  generatedAt: dateTime,
  summary: z.object({
    newEnquiries: z.number().int().nonnegative(),
    openMatters: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
    criticalDeadlines7Days: z.number().int().nonnegative(),
    slaAtRisk: z.number().int().nonnegative(),
    slaBreached: z.number().int().nonnegative(),
    pendingApprovals: z.number().int().nonnegative(),
    receivableMinor: z.string().regex(/^\d+$/),
    overdueInvoices: z.number().int().nonnegative(),
    integrationFailures24Hours: z.number().int().nonnegative(),
    communicationFailures24Hours: z.number().int().nonnegative(),
    scannerDeadLetters: z.number().int().nonnegative(),
  }),
  urgentWork: z.array(
    z.object({
      kind: z.enum(["TASK", "DEADLINE"]),
      id: uuid,
      matterId: uuid,
      title: z.string(),
      priority: z.string(),
      dueAt: dateTime,
      status: z.string(),
    }),
  ),
  serviceHealth: z.object({
    integrations: z.array(
      z.object({
        provider: z.enum([
          "WORDPRESS",
          "STRIPE",
          "GENERIC",
          "MICROSOFT_365",
          "GOOGLE_WORKSPACE",
          "WHATSAPP_BUSINESS",
        ]),
        name: z.string(),
        status: z.enum(["ACTIVE", "DISABLED"]),
        lastEventAt: dateTime.nullable(),
        failed24Hours: z.number().int().nonnegative(),
      }),
    ),
    automationDeadLetters: z.number().int().nonnegative(),
    communicationFailures: z.number().int().nonnegative(),
  }),
});
export type CommandCentreDashboard = z.infer<
  typeof commandCentreDashboardSchema
>;

export const commandCentreReadQuerySchema = z.object({ organisationId: uuid });
