import { Injectable } from '@nestjs/common';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', '']);

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  throw new Error('COMMUNICATION_DELIVERY_ENABLED must be true or false.');
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
export class CommunicationDeliveryWorkerConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly workerIdPrefix: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.enabled = booleanValue(
      environment.COMMUNICATION_DELIVERY_ENABLED,
      false,
    );
    this.pollIntervalMs = integerValue(
      environment.COMMUNICATION_DELIVERY_POLL_INTERVAL_MS,
      5_000,
      1_000,
      300_000,
      'COMMUNICATION_DELIVERY_POLL_INTERVAL_MS',
    );
    this.leaseSeconds = integerValue(
      environment.COMMUNICATION_DELIVERY_LEASE_SECONDS,
      120,
      30,
      1_800,
      'COMMUNICATION_DELIVERY_LEASE_SECONDS',
    );
    this.workerIdPrefix =
      (environment.COMMUNICATION_DELIVERY_WORKER_ID_PREFIX ?? 'businessos-api')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .slice(0, 60) || 'businessos-api';

    if (this.enabled) {
      if (!environment.RESEND_API_KEY?.startsWith('re_')) {
        throw new Error(
          'RESEND_API_KEY is required when communication delivery is enabled.',
        );
      }
      if (!environment.EMAIL_FROM_ADDRESS?.includes('@')) {
        throw new Error(
          'EMAIL_FROM_ADDRESS is required when communication delivery is enabled.',
        );
      }
    }
  }
}
