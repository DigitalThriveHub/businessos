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
  PilotAcceptanceInput,
  PilotFeedbackInput,
  PilotFeedbackResolutionInput,
} from './pilot-readiness.types';

function postgresCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): string | undefined => {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value))
      return undefined;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ['originalCode', 'sqlState', 'sqlstate', 'code']) {
      if (
        typeof record[key] === 'string' &&
        /^[0-9A-Z]{5}$/.test(record[key] as string)
      ) {
        return record[key] as string;
      }
    }
    for (const nested of [
      'cause',
      'meta',
      'driverAdapterError',
      'originalError',
      'error',
    ]) {
      const found = visit(record[nested], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(error, 0);
}

@Injectable()
export class PilotReadinessService {
  private readonly logger = new Logger(PilotReadinessService.name);
  constructor(private readonly rls: RlsTransactionService) {}

  private transaction<T>(
    context: Readonly<OrganisationAccessContext>,
    work: Parameters<RlsTransactionService['run']>[1],
  ) {
    return this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      work,
    ) as Promise<T>;
  }

  async dashboard(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.safe('dashboard.read', async () => {
      const rows = await this.transaction<{ dashboard: unknown }[]>(
        context,
        (tx) =>
          tx.$queryRaw<
            { dashboard: unknown }[]
          >`SELECT private.get_local_pilot_readiness() AS dashboard`,
      );
      if (rows.length !== 1 || rows[0]?.dashboard === undefined) {
        throw new InternalServerErrorException(
          'Pilot readiness returned an invalid response.',
        );
      }
      return rows[0].dashboard;
    });
  }

  async recordAcceptance(
    input: PilotAcceptanceInput,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.safe('acceptance.update', () =>
      this.transaction(
        context,
        (tx) => tx.$queryRaw`
        SELECT * FROM private.upsert_pilot_acceptance(
          ${input.key}, ${input.roleName}, ${input.scenarioName},
          ${input.status}::public.pilot_acceptance_status,
          ${input.evidenceNote ?? ''}, ${input.evidenceReference ?? ''},
          ${input.expectedVersion ?? null}
        )
      `,
      ),
    );
  }

  async createFeedback(
    input: PilotFeedbackInput,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.safe('feedback.create', () =>
      this.transaction(
        context,
        (tx) => tx.$queryRaw`
        SELECT * FROM private.create_pilot_feedback(
          ${input.affectedRole}, ${input.severity}::public.pilot_feedback_severity,
          ${input.title}, ${input.detail}, ${input.reproductionSteps}
        )
      `,
      ),
    );
  }

  async resolveFeedback(
    id: string,
    input: PilotFeedbackResolutionInput,
    context: Readonly<OrganisationAccessContext>,
  ) {
    return this.safe('feedback.resolve', () =>
      this.transaction(
        context,
        (tx) => tx.$queryRaw`
        SELECT * FROM private.resolve_pilot_feedback(
          ${id}::uuid, ${input.status}::public.pilot_feedback_status,
          ${input.resolution}, ${input.expectedVersion}
        )
      `,
      ),
    );
  }

  private async safe<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) throw error;
      const code = postgresCode(error);
      if (code === '42501')
        throw new ForbiddenException(
          'You do not have pilot readiness authority.',
        );
      if (code === '40001')
        throw new ConflictException(
          'Pilot evidence changed; refresh and retry.',
        );
      if (code === '22023')
        throw new BadRequestException(
          'The submitted pilot readiness information is invalid.',
        );
      if (code === 'P0002')
        throw new NotFoundException('Pilot record was not found.');
      this.logger.error(
        `Pilot readiness operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The pilot readiness service is temporarily unavailable.',
      );
    }
  }
}
