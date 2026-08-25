import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { CommunicationDeliveryWorkerConfig } from './communication-delivery-worker.config';
import { CommunicationProviderGateway } from './providers/communication-provider-gateway.service';
import {
  ProviderOperationError,
  type DeliveryJob,
} from './providers/provider.types';

type ClaimedDeliveryJob = DeliveryJob;

@Injectable()
export class CommunicationDeliveryWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CommunicationDeliveryWorkerService.name);
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopping = false;

  constructor(
    private readonly database: PrismaService,
    private readonly config: CommunicationDeliveryWorkerConfig,
    private readonly providers: CommunicationProviderGateway,
  ) {
    this.workerId = `${config.workerIdPrefix}-${hostname().slice(0, 40)}-${
      process.pid
    }-${randomUUID().slice(0, 8)}`.slice(0, 160);
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log(
        'Communication delivery worker is disabled; queued provider messages remain fail-closed.',
      );
      return;
    }
    this.logger.log('Communication delivery worker enabled.');
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
      await this.database.$queryRaw<{ materialised: number }[]>`
        SELECT private.materialise_due_communication_reminders(25)
          AS materialised
      `;

      const [job] = await this.database.$queryRaw<ClaimedDeliveryJob[]>`
        SELECT
          message_id AS "messageId",
          organisation_id AS "organisationId",
          channel,
          connection_id AS "connectionId",
          provider,
          secret_reference AS "secretReference",
          mailbox_address AS "mailboxAddress",
          phone_number AS "phoneNumber",
          recipient_addresses AS "recipientAddresses",
          subject,
          body_text AS "bodyText",
          idempotency_key AS "idempotencyKey",
          attempt,
          max_attempts AS "maxAttempts"
        FROM private.claim_gate_l_delivery_job(
          ${this.workerId},
          ${this.config.leaseSeconds}
        )
      `;

      if (!job) return false;

      await this.deliver(job);
      return true;
    } finally {
      this.busy = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error: unknown) => {
          this.logger.error(
            `Communication worker cycle failed; errorType=${
              error instanceof Error ? error.name : 'unknown'
            }`,
          );
        })
        .finally(() => this.schedule(this.config.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }

  private async deliver(job: ClaimedDeliveryJob): Promise<void> {
    try {
      const receipt = await this.providers.send(job);

      await this.database.$queryRaw`
        SELECT *
        FROM private.complete_communication_delivery_job(
          ${job.messageId}::uuid,
          ${this.workerId},
          ${receipt.provider},
          ${receipt.messageId}
        )
      `;

      this.logger.log(
        `Communication delivery accepted; messageId=${job.messageId}; attempt=${job.attempt}`,
      );
    } catch (error: unknown) {
      await this.database.$queryRaw`
        SELECT *
        FROM private.fail_communication_delivery_job(
          ${job.messageId}::uuid,
          ${this.workerId},
          ${
            error instanceof ProviderOperationError
              ? error.code
              : 'COMMUNICATION_PROVIDER_UNAVAILABLE'
          },
          'The configured communication provider did not accept the message.',
          ${error instanceof ProviderOperationError ? error.retryable : true}
        )
      `;

      this.logger.warn(
        `Communication delivery failed; messageId=${job.messageId}; attempt=${job.attempt}; errorType=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
}
