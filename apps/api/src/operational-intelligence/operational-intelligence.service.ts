import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import type {
  ReviewDocumentIntelligenceDto,
  UpdateOperationalValueBenchmarkDto,
} from './dto/operational-intelligence.dto';
import { OperationalIntelligenceConfig } from './operational-intelligence.config';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 6) return undefined;
  for (const key of ['originalCode', 'sqlState', 'sqlstate']) {
    const value = error[key];
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }
  for (const key of [
    'cause',
    'meta',
    'driverAdapterError',
    'originalError',
    'error',
  ]) {
    const code = postgresCode(error[key], depth + 1);
    if (code) return code;
  }
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined;
}

@Injectable()
export class OperationalIntelligenceService {
  private readonly logger = new Logger(OperationalIntelligenceService.name);

  constructor(
    private readonly rls: RlsTransactionService,
    private readonly config: OperationalIntelligenceConfig,
  ) {}

  async getDashboard(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    const dashboard = await this.runSafely('dashboard.read', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<Array<{ dashboard: unknown }>>`
            SELECT private.get_operational_intelligence_dashboard() AS dashboard
          `,
      );
      if (rows.length !== 1 || !isRecord(rows[0]?.dashboard)) {
        throw new InternalServerErrorException(
          'Operational intelligence returned an invalid response.',
        );
      }
      return rows[0].dashboard;
    });

    return {
      ...dashboard,
      provider: {
        state: this.config.enabled ? 'READY' : 'FREE_MODE',
        generationEnabled: this.config.enabled,
        manualReviewAvailable: true,
        model: this.config.enabled ? this.config.model : null,
        costRatesConfigured:
          this.config.inputCostPerMillionMinor > 0 ||
          this.config.outputCostPerMillionMinor > 0,
      },
    };
  }

  async reviewDocument(
    analysisId: string,
    dto: ReviewDocumentIntelligenceDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.runSafely('document.review', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<Array<{ result: unknown }>>`
            SELECT private.review_document_intelligence(
              ${analysisId}::uuid,
              ${dto.decision}::public.document_intelligence_review_decision,
              ${dto.confirmedCategory}::public.document_category,
              ${dto.confirmedExpiryDate ?? null}::date,
              ${JSON.stringify(dto.corrections)}::jsonb,
              ${dto.notes},
              ${dto.createFollowUpTask},
              ${dto.expectedVersion}
            ) AS result
          `,
      );
      if (rows.length !== 1 || !isRecord(rows[0]?.result)) {
        throw new InternalServerErrorException(
          'Document review returned an invalid response.',
        );
      }
      return rows[0].result;
    });
  }

  async updateBenchmark(
    benchmarkId: string,
    dto: UpdateOperationalValueBenchmarkDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    if (dto.estimatedAutomatedMinutes > dto.estimatedManualMinutes) {
      throw new BadRequestException(
        'Automated minutes cannot exceed manual minutes.',
      );
    }
    return this.runSafely('benchmark.update', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<Array<{ result: unknown }>>`
            SELECT private.update_operational_value_benchmark(
              ${benchmarkId}::uuid,
              ${dto.estimatedManualMinutes},
              ${dto.estimatedAutomatedMinutes},
              ${dto.hourlyCostMinor}::bigint,
              ${dto.isActive},
              ${dto.expectedVersion}
            ) AS result
          `,
      );
      if (rows.length !== 1 || !isRecord(rows[0]?.result)) {
        throw new InternalServerErrorException(
          'Benchmark update returned an invalid response.',
        );
      }
      return rows[0].result;
    });
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      supportGrantId: undefined,
      aal: context.aal,
    } as const;
  }

  private async runSafely<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const code = postgresCode(error);
      if (code === '42501') {
        throw new ForbiddenException(
          'You do not have permission to perform this operation.',
        );
      }
      if (code === 'P0002') {
        throw new NotFoundException('The requested record was not found.');
      }
      if (code === '22023' || code === '23514') {
        throw new BadRequestException(
          'The submitted operational-intelligence data is invalid.',
        );
      }
      if (['23505', '40001', '55006'].includes(code ?? '')) {
        throw new ConflictException(
          'The record changed or is currently in use. Refresh and try again.',
        );
      }
      this.logger.error(
        `Operational-intelligence operation failed; operation=${operation}; databaseCode=${
          code ?? 'unknown'
        }; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Operational intelligence is temporarily unavailable.',
      );
    }
  }
}
