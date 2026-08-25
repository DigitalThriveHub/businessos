import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { Environment } from '../../config/env.validation';
import { ProviderOperationError, type LiveProvider } from './provider.types';

const commonReference = z.string().min(1).max(512);

const microsoftSecret = z
  .object({
    provider: z.literal('MICROSOFT_365'),
    tenantId: commonReference,
    clientId: commonReference,
    clientSecret: commonReference,
    mailboxUserId: commonReference,
    webhookClientState: z.string().min(32).max(512),
  })
  .strict();

const googleSecret = z
  .object({
    provider: z.literal('GOOGLE_WORKSPACE'),
    clientId: commonReference,
    clientSecret: commonReference,
    refreshToken: commonReference,
    mailboxAddress: z.string().email(),
    pubsubAudience: z.string().url().optional(),
    pubsubServiceAccountEmail: z.string().email().optional(),
    pubsubTopic: z.string().min(3).max(1024).optional(),
    calendarId: z.string().min(1).max(512).default('primary'),
  })
  .strict();

const whatsappSecret = z
  .object({
    provider: z.literal('WHATSAPP_BUSINESS'),
    graphApiVersion: z.string().regex(/^v[1-9][0-9]*\.0$/),
    accessToken: commonReference,
    appSecret: z.string().min(16).max(512),
    phoneNumberId: commonReference,
    verifyToken: z.string().min(16).max(512),
    defaultTemplateName: z
      .string()
      .regex(/^[a-z0-9_]{1,512}$/)
      .optional(),
    defaultTemplateLanguage: z
      .string()
      .regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/)
      .default('en_GB'),
  })
  .strict();

const providerSecret = z.discriminatedUnion('provider', [
  microsoftSecret,
  googleSecret,
  whatsappSecret,
]);

const secretMap = z.record(
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/),
  providerSecret,
);

export type MicrosoftProviderSecret = z.infer<typeof microsoftSecret>;
export type GoogleProviderSecret = z.infer<typeof googleSecret>;
export type WhatsAppProviderSecret = z.infer<typeof whatsappSecret>;
export type ProviderSecret = z.infer<typeof providerSecret>;

@Injectable()
export class ProviderSecretResolver {
  private readonly secrets: Readonly<Record<string, ProviderSecret>>;
  private readonly liveEnabled: boolean;

  constructor(config: ConfigService<Environment, true>) {
    this.liveEnabled =
      config.get('GATE_L_LIVE_ENABLED', { infer: true }) === 'true';
    const raw = config.get('GATE_L_PROVIDER_SECRETS_JSON', { infer: true });
    if (!raw) {
      this.secrets = {};
      return;
    }

    const parsed = secretMap.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      throw new Error(
        `GATE_L_PROVIDER_SECRETS_JSON is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    this.secrets = Object.freeze(parsed.data);
  }

  resolve<TProvider extends LiveProvider>(
    reference: string,
    provider: TProvider,
  ): Extract<ProviderSecret, { provider: TProvider }> {
    if (!this.liveEnabled) {
      throw new ProviderOperationError(
        'GATE_L_LIVE_DISABLED',
        'Live provider operations are disabled.',
        false,
      );
    }
    const secret = this.secrets[reference];
    if (!secret || secret.provider !== provider) {
      throw new ProviderOperationError(
        'PROVIDER_SECRET_UNAVAILABLE',
        'The server-side provider credential is unavailable or does not match the configured provider.',
        false,
      );
    }
    return secret as Extract<ProviderSecret, { provider: TProvider }>;
  }

  has(reference: string, provider: LiveProvider): boolean {
    return this.liveEnabled && this.secrets[reference]?.provider === provider;
  }
}
