import { z } from 'zod';

const runtimeDatabaseUrl = z.string().min(1).superRefine((value, ctx) => {
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

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

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