import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

type SnapshotRow = {
  communication_ready: bigint | number | string;
  scanner_ready: bigint | number | string;
  scanner_dead_letter: bigint | number | string;
  workflow_ready: bigint | number | string;
  integration_failed_24_hours: bigint | number | string;
};

export type OperationalDiagnostics = {
  status: 'operational' | 'degraded';
  generatedAt: string;
  release: string;
  databaseLatencyMs: number;
  backupRestoreEvidenceAt: string | null;
  recovery: { rpoMinutes: number; rtoMinutes: number; pitrEnabled: boolean };
  workers: {
    automation: boolean;
    communicationDelivery: boolean;
    documentScanner: boolean;
  };
  queues: {
    communicationReady: number;
    scannerReady: number;
    scannerDeadLetter: number;
    workflowReady: number;
    integrationFailed24Hours: number;
  };
  alerts: string[];
};

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

@Injectable()
export class OperationalReadinessService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService,
  ) {}

  authorise(token: string | undefined): void {
    const expected = this.config.get<string>('OPERATIONS_HEALTH_TOKEN');
    if (!expected || !token) throw new Error('unauthorised');
    const suppliedBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new Error('unauthorised');
    }
  }

  async diagnostics(): Promise<OperationalDiagnostics> {
    const started = performance.now();
    const snapshot = await this.database.$queryRaw<SnapshotRow[]>`
      SELECT * FROM private.get_operational_readiness_snapshot()
    `;
    const row = snapshot[0];

    const queues = {
      communicationReady: Number(row?.communication_ready ?? 0),
      scannerReady: Number(row?.scanner_ready ?? 0),
      scannerDeadLetter: Number(row?.scanner_dead_letter ?? 0),
      workflowReady: Number(row?.workflow_ready ?? 0),
      integrationFailed24Hours: Number(row?.integration_failed_24_hours ?? 0),
    };
    const workers = {
      automation: enabled(this.config.get<string>('AUTOMATION_WORKER_ENABLED')),
      communicationDelivery: enabled(
        this.config.get<string>('COMMUNICATION_DELIVERY_ENABLED'),
      ),
      documentScanner: enabled(
        this.config.get<string>('DOCUMENT_SCANNER_ENABLED'),
      ),
    };
    const alerts: string[] = [];
    if (!workers.automation) alerts.push('AUTOMATION_WORKER_DISABLED');
    if (!workers.communicationDelivery)
      alerts.push('COMMUNICATION_DELIVERY_DISABLED');
    if (!workers.documentScanner) alerts.push('DOCUMENT_SCANNER_DISABLED');
    if (queues.scannerDeadLetter > 0) alerts.push('SCANNER_DEAD_LETTERS');
    if (queues.integrationFailed24Hours > 0)
      alerts.push('INTEGRATION_FAILURES_24_HOURS');
    if (queues.communicationReady > 1000)
      alerts.push('COMMUNICATION_BACKLOG_HIGH');
    if (queues.scannerReady > 500) alerts.push('SCANNER_BACKLOG_HIGH');
    if (queues.workflowReady > 1000) alerts.push('WORKFLOW_BACKLOG_HIGH');

    return {
      status: alerts.length === 0 ? 'operational' : 'degraded',
      generatedAt: new Date().toISOString(),
      release: this.config.get<string>('RELEASE_SHA', 'development'),
      databaseLatencyMs: Math.round(performance.now() - started),
      backupRestoreEvidenceAt:
        this.config.get<string>('BACKUP_RESTORE_EVIDENCE_AT') ?? null,
      recovery: {
        rpoMinutes: this.config.get<number>(
          'RECOVERY_POINT_OBJECTIVE_MINUTES',
          5,
        ),
        rtoMinutes: this.config.get<number>(
          'RECOVERY_TIME_OBJECTIVE_MINUTES',
          60,
        ),
        pitrEnabled: enabled(this.config.get<string>('SUPABASE_PITR_ENABLED')),
      },
      workers,
      queues,
      alerts,
    };
  }
}
