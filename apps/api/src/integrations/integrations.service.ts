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
  CreateIntakeFormDto,
  ExternalCommunicationIntakeDto,
  PublicIntakeSubmissionDto,
  RotateIntegrationSecretDto,
  SetIntakeFormStatusDto,
  SetIntegrationConnectionStatusDto,
} from './dto/integrations.dto';
import { IntegrationSigningService } from './integration-signing.service';
import type {
  ExternalEnquiryResultRow,
  ExternalCommunicationResultRow,
  IngressContextRow,
  IntegrationRecord,
  PublicIntakeFormRow,
  PublicIntakeResultRow,
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
      if (['WORDPRESS', 'GENERIC'].includes(dto.provider)) {
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

  getGateHDashboard(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<unknown> {
    return this.runSafely('gate-h.dashboard.read', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<{ dashboard: unknown }[]>`
          SELECT private.get_gate_h_dashboard() AS dashboard
        `,
      );
      if (rows.length !== 1 || rows[0]?.dashboard === undefined) {
        throw new InternalServerErrorException(
          'The intake operations dashboard returned an invalid response.',
        );
      }
      return rows[0].dashboard;
    });
  }

  createIntakeForm(
    dto: CreateIntakeFormDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<IntegrationRecord> {
    return this.runSafely('intake-form.create', async () => {
      this.validateFormSchema(dto.formSchema);
      const origins = dto.allowedOrigins.map((value) =>
        this.normaliseAllowedOrigin(value),
      );
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<IntegrationRecord[]>`
          SELECT id, organisation_id AS "organisationId",
            connection_id AS "connectionId", public_id AS "publicId",
            key, name, description, status,
            form_schema AS "formSchema",
            privacy_notice_url AS "privacyNoticeUrl",
            privacy_notice_version AS "privacyNoticeVersion",
            allowed_origins AS "allowedOrigins", version,
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM private.create_intake_form(
            ${dto.connectionId}::uuid, ${dto.key}, ${dto.name},
            ${dto.description ?? ''}, ${JSON.stringify(dto.formSchema)}::jsonb,
            ${dto.privacyNoticeUrl}, ${dto.privacyNoticeVersion}, ${origins}::text[]
          )
        `,
      );
      return this.requireOne(rows, 'intake form');
    });
  }

  setIntakeFormStatus(
    formId: string,
    dto: SetIntakeFormStatusDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<IntegrationRecord> {
    return this.runSafely('intake-form.status', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<IntegrationRecord[]>`
          SELECT id, organisation_id AS "organisationId",
            connection_id AS "connectionId", public_id AS "publicId",
            key, name, description, status,
            form_schema AS "formSchema",
            privacy_notice_url AS "privacyNoticeUrl",
            privacy_notice_version AS "privacyNoticeVersion",
            allowed_origins AS "allowedOrigins", version,
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM private.set_intake_form_status(
            ${formId}::uuid, ${dto.status}::public.intake_form_status,
            ${dto.expectedVersion}
          )
        `,
      );
      return this.requireOne(rows, 'intake form');
    });
  }

  async getPublicIntakeForm(
    publicId: string,
    origin: string | undefined,
  ): Promise<Omit<PublicIntakeFormRow, 'organisationId' | 'connectionId'>> {
    const form = await this.loadPublicForm(publicId);
    this.assertAllowedOrigin(form.allowedOrigins, origin);
    const {
      organisationId: _organisationId,
      connectionId: _connectionId,
      ...safe
    } = form;
    return safe;
  }

  async submitPublicIntakeForm(input: {
    publicId: string;
    origin: string | undefined;
    rawBody: Buffer | undefined;
    dto: PublicIntakeSubmissionDto;
  }): Promise<{
    accepted: true;
    duplicate: boolean;
    enquiryId?: string;
    submissionId: string;
    correlationId?: string;
  }> {
    if (
      !input.rawBody ||
      input.rawBody.length === 0 ||
      input.rawBody.length > 65_536
    ) {
      throw new BadRequestException('The form submission is invalid.');
    }
    const form = await this.loadPublicForm(input.publicId);
    this.assertAllowedOrigin(form.allowedOrigins, input.origin);
    this.validateFormSchema(form.formSchema);
    this.validateSubmissionAgainstForm(input.dto, form);

    const startedAt = new Date(input.dto.formStartedAt).getTime();
    const elapsed = Date.now() - startedAt;
    if (!Number.isFinite(startedAt) || elapsed > 86_400_000) {
      throw new BadRequestException('The form session is invalid or expired.');
    }

    const payloadHash = createHash('sha256')
      .update(input.rawBody)
      .digest('hex');
    const riskSignals = [
      ...(input.dto.companyWebsite ? ['HONEYPOT_COMPLETED'] : []),
      ...(elapsed < 800 ? ['IMPLAUSIBLE_COMPLETION_TIME'] : []),
    ];
    if (riskSignals.length > 0) {
      const [evidence] = await this.database.$queryRaw<
        { submissionId: string }[]
      >`
        SELECT private.quarantine_public_intake_submission(
          ${form.id}::uuid, ${input.dto.submissionId}, ${payloadHash},
          'AUTOMATION_RISK', ${JSON.stringify(riskSignals)}::jsonb
        ) AS "submissionId"
      `;
      if (!evidence) {
        throw new InternalServerErrorException(
          'The intake risk service returned an invalid response.',
        );
      }
      // Keep the response non-enumerating so automated abuse cannot tune
      // itself against individual detection rules.
      return { accepted: true, duplicate: false, ...evidence };
    }

    if (!input.dto.email && !input.dto.phone) {
      throw new BadRequestException(
        'An email address or phone number is required.',
      );
    }
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
    const [result] = await this.database.$queryRaw<PublicIntakeResultRow[]>`
      SELECT submission_id AS "submissionId", enquiry_id AS "enquiryId",
        duplicate, correlation_id AS "correlationId"
      FROM private.record_public_intake_submission(
        ${form.id}::uuid, ${input.dto.submissionId}, ${payloadHash},
        ${JSON.stringify(enquiry)}::jsonb, '[]'::jsonb
      )
    `;
    if (!result)
      throw new InternalServerErrorException(
        'The intake service returned an invalid response.',
      );
    return { accepted: true, ...result };
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

  async receiveExternalCommunication(input: {
    connectionId: string;
    eventId: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer | undefined;
    dto: ExternalCommunicationIntakeDto;
  }): Promise<{ accepted: true } & ExternalCommunicationResultRow> {
    if (
      !input.rawBody ||
      input.rawBody.length === 0 ||
      input.rawBody.length > 131_072
    ) {
      throw new BadRequestException('The webhook payload is invalid.');
    }
    const [context] = await this.database.$queryRaw<IngressContextRow[]>`
      SELECT organisation_id AS "organisationId", provider,
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
    const occurredAt = new Date(input.dto.occurredAt);
    if (Math.abs(Date.now() - occurredAt.getTime()) > 7 * 86_400_000) {
      throw new BadRequestException(
        'The communication timestamp is outside the accepted window.',
      );
    }
    const payloadHash = createHash('sha256')
      .update(input.rawBody)
      .digest('hex');
    const [result] = await this.database.$queryRaw<
      ExternalCommunicationResultRow[]
    >`
      SELECT event_id AS "eventId", conversation_id AS "conversationId",
        message_id AS "messageId", queued_for_matching AS "queuedForMatching",
        duplicate, correlation_id AS "correlationId"
      FROM private.record_external_communication(
        ${input.connectionId}::uuid, ${input.eventId}, ${payloadHash},
        ${input.dto.channel}::public.business_communication_channel,
        ${input.dto.providerMessageId}, ${input.dto.providerThreadId ?? ''},
        ${input.dto.sender}, ${input.dto.recipients}::text[],
        ${input.dto.subject ?? ''}, ${input.dto.body}, ${occurredAt}
      )
    `;
    if (!result)
      throw new InternalServerErrorException(
        'The communication intake service returned an invalid response.',
      );
    return { accepted: true, ...result };
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private async loadPublicForm(publicId: string): Promise<PublicIntakeFormRow> {
    const [form] = await this.database.$queryRaw<PublicIntakeFormRow[]>`
      SELECT id, organisation_id AS "organisationId",
        connection_id AS "connectionId", public_id AS "publicId", name,
        description, form_schema AS "formSchema",
        privacy_notice_url AS "privacyNoticeUrl",
        privacy_notice_version AS "privacyNoticeVersion",
        allowed_origins AS "allowedOrigins", success_message AS "successMessage",
        submit_button_label AS "submitButtonLabel",
        honeypot_field AS "honeypotField"
      FROM private.get_public_intake_form(${publicId}::uuid)
    `;
    if (!form) throw new NotFoundException('The form is unavailable.');
    return form;
  }

  private normaliseAllowedOrigin(value: string): string {
    try {
      const parsed = new URL(value);
      if (
        parsed.protocol !== 'https:' &&
        parsed.hostname !== 'localhost' &&
        parsed.hostname !== '127.0.0.1'
      ) {
        throw new Error('secure origin required');
      }
      if (
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error('origin only');
      }
      return parsed.origin;
    } catch {
      throw new BadRequestException(
        'Each allowed origin must be a secure website origin.',
      );
    }
  }

  private assertAllowedOrigin(
    allowed: string[],
    origin: string | undefined,
  ): void {
    if (allowed.length === 0) return;
    let hostedOrigin: string | undefined;
    try {
      hostedOrigin = process.env.WEB_APP_URL
        ? new URL(process.env.WEB_APP_URL).origin
        : undefined;
    } catch {
      hostedOrigin = undefined;
    }
    if (!origin || (!allowed.includes(origin) && origin !== hostedOrigin)) {
      throw new ForbiddenException(
        'This website is not authorised to use the form.',
      );
    }
  }

  private validateFormSchema(value: unknown): void {
    if (
      !isRecord(value) ||
      !Array.isArray(value.fields) ||
      value.fields.length < 1 ||
      value.fields.length > 50
    ) {
      throw new BadRequestException('The form schema is invalid.');
    }
    const names = new Set<string>();
    const supported = new Set([
      'firstName',
      'lastName',
      'email',
      'phone',
      'country',
      'serviceType',
      'message',
      'marketingConsent',
    ]);
    for (const field of value.fields) {
      if (
        !isRecord(field) ||
        typeof field.name !== 'string' ||
        !supported.has(field.name) ||
        names.has(field.name)
      ) {
        throw new BadRequestException(
          'The form schema contains an unsupported or duplicate field.',
        );
      }
      if (
        typeof field.label !== 'string' ||
        field.label.trim().length < 1 ||
        field.label.length > 120
      ) {
        throw new BadRequestException(
          'Every form field requires a valid label.',
        );
      }
      names.add(field.name);
    }
    if (
      !names.has('firstName') ||
      (!names.has('email') && !names.has('phone'))
    ) {
      throw new BadRequestException(
        'Forms require first name and an email or phone field.',
      );
    }
  }

  private validateSubmissionAgainstForm(
    dto: PublicIntakeSubmissionDto,
    form: PublicIntakeFormRow,
  ): void {
    if (dto.privacyNoticeVersion !== form.privacyNoticeVersion) {
      throw new ConflictException(
        'The privacy notice changed. Reload the form and review it again.',
      );
    }
    const schema = form.formSchema as {
      fields: Array<{
        name: keyof PublicIntakeSubmissionDto;
        required?: boolean;
      }>;
    };
    for (const field of schema.fields) {
      if (
        field.required &&
        (dto[field.name] === undefined || dto[field.name] === '')
      ) {
        throw new BadRequestException(
          `The required field ${String(field.name)} is missing.`,
        );
      }
    }
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
