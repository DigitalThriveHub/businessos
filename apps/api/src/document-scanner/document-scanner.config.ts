import { Injectable } from '@nestjs/common';
import { isAbsolute } from 'node:path';

import { ScannerPipelineError } from './document-scanner.types';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', '']);

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  throw new Error('DOCUMENT_SCANNER_ENABLED must be true or false.');
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
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  const normalised = value?.trim();
  if (!normalised) throw new Error(`${name} is required when document scanning is enabled.`);
  return normalised;
}

@Injectable()
export class DocumentScannerConfig {
  readonly enabled: boolean;
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;
  readonly clamavSocketPath: string | null;
  readonly clamavHost: string | null;
  readonly clamavPort: number;
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly connectTimeoutMs: number;
  readonly scanTimeoutMs: number;
  readonly storageTimeoutMs: number;
  readonly maxFileBytes: number;
  readonly workerIdPrefix: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.enabled = booleanValue(environment.DOCUMENT_SCANNER_ENABLED, false);
    this.pollIntervalMs = integerValue(
      environment.DOCUMENT_SCANNER_POLL_INTERVAL_MS,
      5_000,
      1_000,
      300_000,
      'DOCUMENT_SCANNER_POLL_INTERVAL_MS',
    );
    this.leaseSeconds = integerValue(
      environment.DOCUMENT_SCANNER_LEASE_SECONDS,
      300,
      30,
      1_800,
      'DOCUMENT_SCANNER_LEASE_SECONDS',
    );
    this.connectTimeoutMs = integerValue(
      environment.CLAMAV_CONNECT_TIMEOUT_MS,
      5_000,
      500,
      60_000,
      'CLAMAV_CONNECT_TIMEOUT_MS',
    );
    this.scanTimeoutMs = integerValue(
      environment.CLAMAV_SCAN_TIMEOUT_MS,
      120_000,
      5_000,
      900_000,
      'CLAMAV_SCAN_TIMEOUT_MS',
    );
    this.storageTimeoutMs = integerValue(
      environment.DOCUMENT_SCANNER_STORAGE_TIMEOUT_MS,
      120_000,
      5_000,
      900_000,
      'DOCUMENT_SCANNER_STORAGE_TIMEOUT_MS',
    );
    this.maxFileBytes = integerValue(
      environment.DOCUMENT_SCANNER_MAX_FILE_BYTES,
      52_428_800,
      1,
      52_428_800,
      'DOCUMENT_SCANNER_MAX_FILE_BYTES',
    );
    this.clamavPort = integerValue(
      environment.CLAMAV_PORT,
      3310,
      1,
      65_535,
      'CLAMAV_PORT',
    );
    const minimumLeaseMilliseconds =
      this.storageTimeoutMs +
      this.connectTimeoutMs +
      this.scanTimeoutMs +
      30_000;
    if (this.leaseSeconds * 1_000 <= minimumLeaseMilliseconds) {
      throw new Error(
        'DOCUMENT_SCANNER_LEASE_SECONDS must exceed the combined scanner timeouts by at least 30 seconds.',
      );
    }
    this.workerIdPrefix = (environment.DOCUMENT_SCANNER_WORKER_ID_PREFIX ?? 'businessos-api')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(0, 60) || 'businessos-api';

    if (!this.enabled) {
      this.supabaseUrl = '';
      this.supabaseServiceRoleKey = '';
      this.clamavSocketPath = null;
      this.clamavHost = null;
      return;
    }

    const rawUrl = required(environment.SUPABASE_URL, 'SUPABASE_URL');
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'https:' && environment.NODE_ENV === 'production') {
      throw new Error('SUPABASE_URL must use HTTPS in production.');
    }
    if (
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash ||
      parsedUrl.pathname !== '/'
    ) {
      throw new Error('SUPABASE_URL must be an origin without credentials, query or path.');
    }
    this.supabaseUrl = parsedUrl.toString().replace(/\/$/, '');
    this.supabaseServiceRoleKey = required(
      environment.SUPABASE_SERVICE_ROLE_KEY,
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    if (this.supabaseServiceRoleKey.length < 24) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is invalid.');
    }

    this.clamavSocketPath = environment.CLAMAV_SOCKET_PATH?.trim() || null;
    this.clamavHost = environment.CLAMAV_HOST?.trim() || null;
    if (!this.clamavSocketPath && !this.clamavHost) {
      throw new Error('CLAMAV_SOCKET_PATH or CLAMAV_HOST is required.');
    }
    if (this.clamavSocketPath && this.clamavHost) {
      throw new Error('Configure only one of CLAMAV_SOCKET_PATH or CLAMAV_HOST.');
    }
    if (this.clamavSocketPath && !isAbsolute(this.clamavSocketPath)) {
      throw new Error('CLAMAV_SOCKET_PATH must be an absolute path.');
    }
    if (
      this.clamavHost &&
      (!/^[a-zA-Z0-9._:-]{1,253}$/.test(this.clamavHost) ||
        this.clamavHost === '0.0.0.0' ||
        this.clamavHost === '::')
    ) {
      throw new Error('CLAMAV_HOST is invalid.');
    }
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw new ScannerPipelineError(
        'SCANNER_DISABLED',
        'The document scanner is disabled.',
        false,
      );
    }
  }
}