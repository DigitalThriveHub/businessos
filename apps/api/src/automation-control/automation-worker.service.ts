import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { AutomationWorkerConfig } from './automation-worker.config';

export interface AutomationCycleResult {
  atRiskCount: number;
  breachedCount: number;
  escalationCount: number;
  expiredApprovalCount: number;
}

@Injectable()
export class AutomationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopping = false;

  constructor(
    private readonly database: PrismaService,
    private readonly config: AutomationWorkerConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Automation worker is disabled.');
      return;
    }
    this.logger.log('Automation worker enabled.');
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async runOnce(): Promise<AutomationCycleResult | null> {
    if (!this.config.enabled || this.busy || this.stopping) return null;
    this.busy = true;
    try {
      const [result] = await this.database.$queryRaw<AutomationCycleResult[]>`
        SELECT
          at_risk_count AS "atRiskCount",
          breached_count AS "breachedCount",
          escalation_count AS "escalationCount",
          expired_approval_count AS "expiredApprovalCount"
        FROM private.process_automation_cycle(${this.config.batchSize})
      `;
      return (
        result ?? {
          atRiskCount: 0,
          breachedCount: 0,
          escalationCount: 0,
          expiredApprovalCount: 0,
        }
      );
    } finally {
      this.busy = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .then((result) => {
          if (
            result &&
            (result.atRiskCount > 0 ||
              result.breachedCount > 0 ||
              result.escalationCount > 0 ||
              result.expiredApprovalCount > 0)
          ) {
            this.logger.log(
              `Automation cycle advanced; atRisk=${result.atRiskCount}; breached=${result.breachedCount}; escalations=${result.escalationCount}; approvalsExpired=${result.expiredApprovalCount}`,
            );
          }
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Automation worker cycle failed; errorType=${
              error instanceof Error ? error.name : 'unknown'
            }`,
          );
        })
        .finally(() => this.schedule(this.config.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }
}
