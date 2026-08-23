import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
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
export class CommandCentreService {
  private readonly logger = new Logger(CommandCentreService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  async getDashboard(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    try {
      const rows = await this.rls.run(
        {
          userId: context.userId,
          organisationId: context.organisationId,
          aal: context.aal,
        },
        (transaction) =>
          transaction.$queryRaw<{ dashboard: unknown }[]>`
            SELECT private.get_command_centre_dashboard() AS dashboard
          `,
      );
      if (rows.length !== 1 || rows[0]?.dashboard === undefined) {
        throw new InternalServerErrorException(
          'The command centre returned an invalid response.',
        );
      }
      return rows[0].dashboard;
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) throw error;
      const code = postgresCode(error);
      if (code === '42501') {
        throw new ForbiddenException(
          'You do not have permission to view the command centre.',
        );
      }
      this.logger.error(
        `Command-centre read failed; databaseCode=${code ?? 'unknown'}; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The command centre is temporarily unavailable.',
      );
    }
  }
}
