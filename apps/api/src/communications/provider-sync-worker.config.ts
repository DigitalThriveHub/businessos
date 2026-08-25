import { Injectable } from '@nestjs/common';

function booleanValue(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()))
    return true;
  if (['0', 'false', 'no', 'off', ''].includes(value.trim().toLowerCase()))
    return false;
  throw new Error('GATE_L_SYNC_ENABLED must be true or false.');
}

function integerValue(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

@Injectable()
export class ProviderSyncWorkerConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly minimumSyncAgeSeconds: number;
  readonly leaseSeconds: number;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.enabled = booleanValue(environment.GATE_L_SYNC_ENABLED);
    this.pollIntervalMs = integerValue(
      environment.GATE_L_SYNC_POLL_INTERVAL_MS,
      15_000,
      1_000,
      300_000,
      'GATE_L_SYNC_POLL_INTERVAL_MS',
    );
    this.minimumSyncAgeSeconds = integerValue(
      environment.GATE_L_SYNC_MINIMUM_AGE_SECONDS,
      60,
      15,
      3_600,
      'GATE_L_SYNC_MINIMUM_AGE_SECONDS',
    );
    this.leaseSeconds = integerValue(
      environment.GATE_L_SYNC_LEASE_SECONDS,
      180,
      30,
      1_800,
      'GATE_L_SYNC_LEASE_SECONDS',
    );
    if (this.enabled && !environment.GATE_L_PROVIDER_SECRETS_JSON?.trim()) {
      throw new Error(
        'GATE_L_PROVIDER_SECRETS_JSON is required when Gate L sync is enabled.',
      );
    }
  }
}
