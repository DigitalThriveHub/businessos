import { z } from 'zod';

const runtimeDatabaseUrl = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);

      if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        ctx.addIssue({
          code: 'custom',
          message: 'DATABASE_URL must be a PostgreSQL URL',
        });
      }

      const databaseUser = decodeURIComponent(url.username).split('.')[0];

      if (databaseUser !== 'businessos_runtime') {
        ctx.addIssue({
          code: 'custom',
          message: 'DATABASE_URL must use businessos_runtime',
        });
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'DATABASE_URL is invalid',
      });
    }
  });

const webAppUrl = z
  .string()
  .url()
  .default('http://127.0.0.1:3000')
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);

      if (!['http:', 'https:'].includes(url.protocol)) {
        ctx.addIssue({
          code: 'custom',
          message: 'WEB_APP_URL must use HTTP or HTTPS',
        });
      }

      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      ) {
        ctx.addIssue({
          code: 'custom',
          message:
            'WEB_APP_URL must contain only the trusted application origin',
        });
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'WEB_APP_URL is invalid',
      });
    }
  });

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    DATABASE_URL: runtimeDatabaseUrl,

    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),

    SUPABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://'), {
        message: 'SUPABASE_URL must use HTTPS',
      }),

    SUPABASE_JWT_ISSUER: z.string().url(),

    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),

    WEB_APP_URL: webAppUrl,

    RESEND_API_KEY: z
      .string()
      .trim()
      .min(20)
      .max(512)
      .startsWith('re_', {
        message: 'RESEND_API_KEY must be a Resend API key',
      })
      .optional(),

    EMAIL_FROM_ADDRESS: z.string().trim().email().max(320).optional(),

    EMAIL_FROM_NAME: z.string().trim().min(1).max(100).default('BusinessOS'),

    EMAIL_REPLY_TO: z.string().trim().email().max(320).optional(),

    RESEND_WEBHOOK_SECRET: z
      .string()
      .trim()
      .min(24)
      .max(512)
      .startsWith('whsec_', {
        message:
          'RESEND_WEBHOOK_SECRET must be a Resend webhook signing secret',
      })
      .optional(),

    INVITATION_TOKEN_SECRET: z.string().min(32).max(512).optional(),

    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(72),

    PORTAL_INVITATION_TOKEN_SECRET: z.string().min(32).max(512).optional(),

    PORTAL_INVITATION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(336)
      .default(168),

    INTEGRATION_SIGNING_MASTER_SECRET: z.string().min(32).max(512).optional(),

    INTEGRATION_WEBHOOK_TOLERANCE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(300),

    STRIPE_SECRET_KEY: z
      .string()
      .trim()
      .regex(/^sk_(test|live)_[A-Za-z0-9_]{16,}$/)
      .optional(),

    STRIPE_WEBHOOK_SECRET: z
      .string()
      .trim()
      .regex(/^whsec_[A-Za-z0-9_]{16,}$/)
      .optional(),

    STRIPE_PLATFORM_ACCOUNT_ID: z
      .string()
      .trim()
      .regex(/^acct_[A-Za-z0-9]{8,}$/)
      .optional(),

    STRIPE_API_VERSION: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}(\.[A-Za-z0-9_-]+)?$/)
      .optional(),

    RELEASE_SHA: z.string().trim().min(7).max(64).optional(),

    SENTRY_DSN: z.string().url().optional(),

    AXIOM_TOKEN: z.string().trim().min(20).max(512).optional(),

    BACKUP_RESTORE_EVIDENCE_AT: z.string().datetime().optional(),
  })
  .superRefine((environment, ctx) => {
    if (environment.NODE_ENV === 'production') {
      const webUrl = new URL(environment.WEB_APP_URL);

      if (webUrl.protocol !== 'https:') {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_APP_URL'],
          message: 'WEB_APP_URL must use HTTPS in production',
        });
      }

      if (environment.TRUST_PROXY_HOPS < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY_HOPS'],
          message:
            'TRUST_PROXY_HOPS must identify the reviewed proxy chain in production',
        });
      }

      const databaseUrl = new URL(environment.DATABASE_URL);
      if (
        !['require', 'verify-ca', 'verify-full'].includes(
          databaseUrl.searchParams.get('sslmode') ?? '',
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must require TLS in production',
        });
      }

      const requiredProductionValues = [
        ['RESEND_API_KEY', environment.RESEND_API_KEY],
        ['EMAIL_FROM_ADDRESS', environment.EMAIL_FROM_ADDRESS],
        ['INVITATION_TOKEN_SECRET', environment.INVITATION_TOKEN_SECRET],
        [
          'PORTAL_INVITATION_TOKEN_SECRET',
          environment.PORTAL_INVITATION_TOKEN_SECRET,
        ],
        ['RESEND_WEBHOOK_SECRET', environment.RESEND_WEBHOOK_SECRET],
        [
          'INTEGRATION_SIGNING_MASTER_SECRET',
          environment.INTEGRATION_SIGNING_MASTER_SECRET,
        ],
        ['STRIPE_SECRET_KEY', environment.STRIPE_SECRET_KEY],
        ['STRIPE_WEBHOOK_SECRET', environment.STRIPE_WEBHOOK_SECRET],
        ['STRIPE_PLATFORM_ACCOUNT_ID', environment.STRIPE_PLATFORM_ACCOUNT_ID],
        ['STRIPE_API_VERSION', environment.STRIPE_API_VERSION],
        ['RELEASE_SHA', environment.RELEASE_SHA],
        ['SENTRY_DSN', environment.SENTRY_DSN],
        ['AXIOM_TOKEN', environment.AXIOM_TOKEN],
        ['BACKUP_RESTORE_EVIDENCE_AT', environment.BACKUP_RESTORE_EVIDENCE_AT],
      ] as const;

      for (const [
        environmentName,
        environmentValue,
      ] of requiredProductionValues) {
        if (!environmentValue) {
          ctx.addIssue({
            code: 'custom',
            path: [environmentName],
            message: `${environmentName} is required in production`,
          });
        }
      }

      if (
        environment.BACKUP_RESTORE_EVIDENCE_AT &&
        Date.now() -
          new Date(environment.BACKUP_RESTORE_EVIDENCE_AT).getTime() >
          92 * 24 * 60 * 60 * 1_000
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['BACKUP_RESTORE_EVIDENCE_AT'],
          message:
            'A successful backup restore exercise is required every 92 days',
        });
      }

      if (
        environment.STRIPE_SECRET_KEY &&
        !environment.STRIPE_SECRET_KEY.startsWith('sk_live_')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'STRIPE_SECRET_KEY must be a live key in production',
        });
      }
    }

    if (
      environment.INVITATION_TOKEN_SECRET &&
      environment.PORTAL_INVITATION_TOKEN_SECRET &&
      environment.INVITATION_TOKEN_SECRET ===
        environment.PORTAL_INVITATION_TOKEN_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PORTAL_INVITATION_TOKEN_SECRET'],
        message:
          'Portal and workforce invitation token secrets must be different',
      });
    }

    if (
      environment.INTEGRATION_SIGNING_MASTER_SECRET &&
      [
        environment.INVITATION_TOKEN_SECRET,
        environment.PORTAL_INVITATION_TOKEN_SECRET,
        environment.RESEND_WEBHOOK_SECRET,
        environment.STRIPE_WEBHOOK_SECRET,
      ].includes(environment.INTEGRATION_SIGNING_MASTER_SECRET)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTEGRATION_SIGNING_MASTER_SECRET'],
        message: 'The integration signing master secret must be independent',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  configuration: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(configuration);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Environment validation failed: ${errors}`);
  }

  return result.data;
}
