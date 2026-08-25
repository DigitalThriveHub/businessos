import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { GateLOperationsService } from './gate-l-operations.service';
import { ProviderSyncWorkerConfig } from './provider-sync-worker.config';

@Injectable()
export class ProviderSyncWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ProviderSyncWorkerService.name);
  private readonly workerId =
    `gate-l-sync-${hostname().slice(0, 40)}-${process.pid}-${randomUUID().slice(0, 8)}`.slice(
      0,
      160,
    );
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopping = false;

  constructor(
    private readonly database: PrismaService,
    private readonly gateL: GateLOperationsService,
    private readonly config: ProviderSyncWorkerConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Gate L mailbox sync worker is disabled.');
      return;
    }
    this.logger.log('Gate L mailbox sync worker enabled.');
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async runOnce(): Promise<boolean> {
    if (!this.config.enabled || this.busy || this.stopping) return false;
    this.busy = true;
    try {
      const [job] = await this.database.$queryRaw<
        Array<{ connectionId: string }>
      >`
        SELECT connection_id AS "connectionId"
        FROM private.claim_provider_sync_job(
          ${this.workerId}, ${this.config.leaseSeconds}, ${this.config.minimumSyncAgeSeconds}
        )
      `;
      if (!job) return false;
      try {
        const processed = await this.gateL.syncConnection(job.connectionId);
        this.logger.log(
          `Mailbox sync completed; connectionId=${job.connectionId}; processed=${processed}`,
        );
      } catch (error) {
        this.logger.warn(
          `Mailbox sync failed; connectionId=${job.connectionId}; errorType=${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
      return true;
    } finally {
      this.busy = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() =>
        this.schedule(this.config.pollIntervalMs),
      );
    }, delayMs);
    this.timer.unref();
  }
}
