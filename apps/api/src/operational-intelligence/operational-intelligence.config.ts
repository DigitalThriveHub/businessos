import { Injectable } from '@nestjs/common';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', '']);

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  throw new Error('DOCUMENT_INTELLIGENCE_ENABLED must be true or false.');
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
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

@Injectable()
export class OperationalIntelligenceConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly model: string;
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly providerTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxFileBytes: number;
  readonly inputCostPerMillionMinor: number;
  readonly outputCostPerMillionMinor: number;
  readonly workerIdPrefix: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.enabled = booleanValue(
      environment.DOCUMENT_INTELLIGENCE_ENABLED,
      false,
    );
    this.pollIntervalMs = integerValue(
      environment.DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS,
      5_000,
      1_000,
      300_000,
      'DOCUMENT_INTELLIGENCE_POLL_INTERVAL_MS',
    );
    this.leaseSeconds = integerValue(
      environment.DOCUMENT_INTELLIGENCE_LEASE_SECONDS,
      300,
      30,
      1_800,
      'DOCUMENT_INTELLIGENCE_LEASE_SECONDS',
    );
    this.providerTimeoutMs = integerValue(
      environment.DOCUMENT_INTELLIGENCE_TIMEOUT_MS,
      60_000,
      5_000,
      180_000,
      'DOCUMENT_INTELLIGENCE_TIMEOUT_MS',
    );
    this.maxOutputTokens = integerValue(
      environment.DOCUMENT_INTELLIGENCE_MAX_OUTPUT_TOKENS,
      2_400,
      512,
      8_000,
      'DOCUMENT_INTELLIGENCE_MAX_OUTPUT_TOKENS',
    );
    this.maxFileBytes = integerValue(
      environment.DOCUMENT_INTELLIGENCE_MAX_FILE_BYTES,
      20_971_520,
      1,
      50_000_000,
      'DOCUMENT_INTELLIGENCE_MAX_FILE_BYTES',
    );
    this.inputCostPerMillionMinor = integerValue(
      environment.DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR,
      0,
      0,
      100_000_000,
      'DOCUMENT_INTELLIGENCE_INPUT_COST_PER_MILLION_MINOR',
    );
    this.outputCostPerMillionMinor = integerValue(
      environment.DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR,
      0,
      0,
      100_000_000,
      'DOCUMENT_INTELLIGENCE_OUTPUT_COST_PER_MILLION_MINOR',
    );
    this.workerIdPrefix =
      (environment.DOCUMENT_INTELLIGENCE_WORKER_ID_PREFIX ?? 'businessos-api')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .slice(0, 60) || 'businessos-api';

    const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';
    const model = (
      environment.DOCUMENT_INTELLIGENCE_MODEL ??
      environment.OPENAI_AGENT_MODEL ??
      ''
    ).trim();
    if (this.enabled) {
      if (environment.DOCUMENT_SCANNER_ENABLED !== 'true') {
        throw new Error(
          'DOCUMENT_SCANNER_ENABLED must be true before document intelligence is enabled.',
        );
      }
      if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
        throw new Error(
          'OPENAI_API_KEY is required when document intelligence is enabled.',
        );
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(model)) {
        throw new Error(
          'DOCUMENT_INTELLIGENCE_MODEL or OPENAI_AGENT_MODEL is required.',
        );
      }
      if (this.leaseSeconds * 1_000 <= this.providerTimeoutMs + 30_000) {
        throw new Error(
          'DOCUMENT_INTELLIGENCE_LEASE_SECONDS must exceed the provider timeout by at least 30 seconds.',
        );
      }
    }
    this.apiKey = apiKey;
    this.model = model;
  }
}
