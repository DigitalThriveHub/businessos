import { Injectable } from '@nestjs/common';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  throw new Error('AUTOMATION_WORKER_ENABLED must be true or false.');
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
export class AutomationWorkerConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly batchSize: number;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.enabled = booleanValue(environment.AUTOMATION_WORKER_ENABLED, true);
    this.pollIntervalMs = integerValue(
      environment.AUTOMATION_WORKER_POLL_INTERVAL_MS,
      5_000,
      1_000,
      300_000,
      'AUTOMATION_WORKER_POLL_INTERVAL_MS',
    );
    this.batchSize = integerValue(
      environment.AUTOMATION_WORKER_BATCH_SIZE,
      50,
      1,
      100,
      'AUTOMATION_WORKER_BATCH_SIZE',
    );
  }
}
