import { createHash } from 'node:crypto';

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
import { PrismaService } from '../database/prisma.service';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  CreateIntegrationConnectionDto,
  ExternalEnquiryIntakeDto,
  RotateIntegrationSecretDto,
  SetIntegrationConnectionStatusDto,
} from './dto/integrations.dto';
import { IntegrationSigningService } from './integration-signing.service';
import type {
  ExternalEnquiryResultRow,
  IngressContextRow,
  IntegrationRecord,
} from './integrations.types';

function isRecord(value: unknown): value is IntegrationRecord {
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
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly rls: RlsTransactionService,
    private readonly signing: IntegrationSigningService,
  ) {}

  getDashboard(context: Readonly<OrganisationAccessContext>): Promise<unknown> {
    return this.runSafely('dashboard.read', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<{ dashboard: unknown }[]>`
          SELECT private.get_integrations_dashboard() AS dashboard
        `,
      );
      if (rows.length !== 1 || rows[0]?.dashboard === undefined) {
        throw new InternalServerErrorException(
          'The integrations dashboard returned an invalid response.',
        );
      }
      return rows[0].dashboard;
    });
  }

  createConnection(
    dto: CreateIntegrationConnectionDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<IntegrationRecord> {
    return this.runSafely('connection.create', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<IntegrationRecord[]>`
          SELECT
            id, organisation_id AS "organisationId", provider,
            display_name AS "displayName", status,
            external_account_reference AS "externalAccountReference",
            secret_version AS "secretVersion", version,
            created_at AS "createdAt"
          FROM private.create_integration_connection(
            ${dto.provider}::public.integration_provider,
            ${dto.displayName},
            ${dto.externalAccountReference ?? ''}
          )
        `,
      );
      const connection = this.requireOne(rows, 'integration connection');
      if (dto.provider !== 'STRIPE') {
        connection.signingSecret = this.signing.deriveConnectionSecret(
          String(connection.id),
          Number(connection.secretVersion),
        );
      }
      return connection;
    });
  }

  setStatus(
    connectionId: string,
    dto: SetIntegrationConnectionStatusDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<IntegrationRecord> {
    return this.runSafely('connection.status', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<IntegrationRecord[]>`
          SELECT
            id, organisation_id AS "organisationId", provider,
            display_name AS "displayName", status,
            external_account_reference AS "externalAccountReference",
            secret_version AS "secretVersion", version,
            updated_at AS "updatedAt"
          FROM private.set_integration_connection_status(
            ${connectionId}::uuid,
            ${dto.status}::public.integration_connection_status,
            ${dto.expectedVersion}
          )
        `,
      );
      return this.requireOne(rows, 'integration connection');
    });
  }

  rotateSecret(
    connectionId: string,
    dto: RotateIntegrationSecretDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<IntegrationRecord> {
    return this.runSafely('connection.secret.rotate', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<IntegrationRecord[]>`
          SELECT
            id, organisation_id AS "organisationId", provider,
            display_name AS "displayName", status,
            secret_version AS "secretVersion", version,
            updated_at AS "updatedAt"
          FROM private.rotate_integration_connection_secret(
            ${connectionId}::uuid,
            ${dto.expectedVersion}
          )
        `,
      );
      const connection = this.requireOne(rows, 'integration connection');
      connection.signingSecret = this.signing.deriveConnectionSecret(
        String(connection.id),
        Number(connection.secretVersion),
      );
      return connection;
    });
  }

  async receiveExternalEnquiry(input: {
    connectionId: string;
    eventId: string;
    eventType: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer | undefined;
    dto: ExternalEnquiryIntakeDto;
  }): Promise<{
    accepted: true;
    duplicate: boolean;
    enquiryId: string;
    eventId: string;
    correlationId: string;
  }> {
    if (
      !input.rawBody ||
      input.rawBody.length === 0 ||
      input.rawBody.length > 65_536
    ) {
      throw new BadRequestException('The webhook payload is invalid.');
    }

    if (!input.dto.email && !input.dto.phone) {
      throw new BadRequestException(
        'An email address or phone number is required.',
      );
    }

    const [context] = await this.database.$queryRaw<IngressContextRow[]>`
      SELECT
        organisation_id AS "organisationId", provider,
        display_name AS "displayName", secret_version AS "secretVersion"
      FROM private.get_integration_ingress_context(${input.connectionId}::uuid)
    `;
    if (!context)
      throw new NotFoundException('The integration endpoint was not found.');

    this.signing.verifyIntakeSignature({
      connectionId: input.connectionId,
      secretVersion: context.secretVersion,
      eventId: input.eventId,
      timestamp: input.timestamp,
      signature: input.signature,
      rawBody: input.rawBody,
    });

    const payloadHash = createHash('sha256')
      .update(input.rawBody)
      .digest('hex');
    const occurredAt = new Date(Number(input.timestamp) * 1_000);
    const enquiry = {
      firstName: input.dto.firstName,
      lastName: input.dto.lastName,
      email: input.dto.email,
      phone: input.dto.phone,
      country: input.dto.country,
      serviceType: input.dto.serviceType,
      message: input.dto.message,
      priority: input.dto.priority ?? 'NORMAL',
      lawfulBasis: input.dto.lawfulBasis,
      privacyNoticeAcknowledged: input.dto.privacyNoticeAcknowledged,
      privacyNoticeVersion: input.dto.privacyNoticeVersion,
      marketingConsent: input.dto.marketingConsent ?? false,
      marketingConsentCapturedAt: input.dto.marketingConsentCapturedAt,
    };

    const [result] = await this.database.$queryRaw<ExternalEnquiryResultRow[]>`
      SELECT event_id AS "eventId", enquiry_id AS "enquiryId",
        duplicate, correlation_id AS "correlationId"
      FROM private.record_external_enquiry(
        ${input.connectionId}::uuid,
        ${input.eventId}, ${input.eventType}, ${occurredAt},
        ${payloadHash}, ${JSON.stringify(enquiry)}::jsonb
      )
    `;
    if (!result) {
      throw new InternalServerErrorException(
        'The external intake service returned an invalid response.',
      );
    }

    return { accepted: true, ...result };
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private requireOne<T>(rows: T[], resource: string): T {
    if (rows.length !== 1 || !rows[0]) {
      throw new NotFoundException(`The ${resource} was not found.`);
    }
    return rows[0];
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
      )
        throw error;

      const code = postgresCode(error);
      if (code === '42501')
        throw new ForbiddenException(
          'You do not have permission to manage integrations, or MFA is required.',
        );
      if (['P0002', '02000'].includes(code ?? ''))
        throw new NotFoundException('The integration record was not found.');
      if (['23505', '40001'].includes(code ?? ''))
        throw new ConflictException(
          'The integration record already exists or changed.',
        );
      if (['22023', '23514', '23503'].includes(code ?? ''))
        throw new BadRequestException('The integration request is invalid.');

      this.logger.error(
        `Integration operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${error instanceof Error ? error.name : typeof error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'The integration service is temporarily unavailable.',
      );
    }
  }
}
