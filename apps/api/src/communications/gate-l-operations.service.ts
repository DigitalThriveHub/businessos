import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { PrismaService } from '../database/prisma.service';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  CancelBusinessCalendarEventDto,
  ConfigureProviderConnectionDto,
  CreateBusinessCalendarEventDto,
  RetryBusinessCalendarEventDto,
  SetBusinessCalendarOutcomeDto,
  SetProviderConnectionStatusDto,
} from './dto/communications.dto';
import { CommunicationProviderGateway } from './providers/communication-provider-gateway.service';
import {
  ProviderOperationError,
  type ProviderRuntimeContext,
} from './providers/provider.types';

type RecordValue = Record<string, unknown>;

type ProviderConfigRow = ProviderRuntimeContext & {
  displayName?: string;
  lastHealthCheckedAt?: Date | null;
  lastHealthyAt?: Date | null;
  lastSyncAt?: Date | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
  version?: number;
};

type CalendarRow = {
  id: string;
  organisationId: string;
  integrationConnectionId: string;
  clientId: string | null;
  matterId: string | null;
  conversationId: string | null;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  attendeeAddresses: string[];
  status: string;
  providerEventId: string | null;
  providerJoinUrl: string | null;
  idempotencyKey: string;
  reminderMinutesBefore: number | null;
  failureCode: string | null;
  failureDetail: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 6) return undefined;
  for (const key of ['originalCode', 'sqlState', 'sqlstate', 'code']) {
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
  return undefined;
}

@Injectable()
export class GateLOperationsService {
  private readonly logger = new Logger(GateLOperationsService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly rls: RlsTransactionService,
    private readonly providers: CommunicationProviderGateway,
  ) {}

  getDashboard(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('dashboard.read', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const providerConnections = await transaction.$queryRaw<RecordValue[]>`
          SELECT config.connection_id AS "connectionId",
            connection.provider::text AS provider,
            connection.display_name AS "displayName",
            connection.status::text AS "connectionStatus",
            config.state::text AS state,
            config.capabilities::text[] AS capabilities,
            config.mailbox_address AS "mailboxAddress",
            config.phone_number AS "phoneNumber",
            config.webhook_public_id AS "webhookPublicId",
            config.last_health_checked_at AS "lastHealthCheckedAt",
            config.last_healthy_at AS "lastHealthyAt",
            config.last_sync_at AS "lastSyncAt",
            config.last_error_code AS "lastErrorCode",
            config.last_error_detail AS "lastErrorDetail",
            config.version
          FROM public.provider_connection_configs AS config
          JOIN public.integration_connections AS connection
            ON connection.id = config.connection_id
           AND connection.organisation_id = config.organisation_id
          WHERE config.organisation_id = ${context.organisationId}::uuid
          ORDER BY connection.display_name
        `;
        const calendarEvents = await transaction.$queryRaw<RecordValue[]>`
          SELECT event.id, event.integration_connection_id AS "integrationConnectionId",
            connection.display_name AS "connectionName",
            connection.provider::text AS provider,
            event.client_id AS "clientId", client.display_name AS "clientName",
            event.matter_id AS "matterId", matter.matter_number AS "matterNumber",
            event.conversation_id AS "conversationId", event.title, event.description,
            event.starts_at AS "startsAt", event.ends_at AS "endsAt", event.timezone,
            event.location, event.attendee_addresses::text[] AS "attendeeAddresses",
            event.status::text AS status, event.provider_join_url AS "providerJoinUrl",
            event.reminder_minutes_before AS "reminderMinutesBefore",
            event.failure_code AS "failureCode", event.failure_detail AS "failureDetail",
            event.version, event.created_at AS "createdAt", event.updated_at AS "updatedAt"
          FROM public.business_calendar_events AS event
          JOIN public.integration_connections AS connection
            ON connection.id = event.integration_connection_id
           AND connection.organisation_id = event.organisation_id
          LEFT JOIN public.clients AS client ON client.id = event.client_id
            AND client.organisation_id = event.organisation_id
          LEFT JOIN public.matters AS matter ON matter.id = event.matter_id
            AND matter.organisation_id = event.organisation_id
          WHERE event.organisation_id = ${context.organisationId}::uuid
            AND event.starts_at >= pg_catalog.now() - interval '30 days'
            AND event.starts_at < pg_catalog.now() + interval '365 days'
          ORDER BY event.starts_at
          LIMIT 500
        `;
        return {
          providerConnections,
          calendarEvents,
          readiness: {
            readyConnections: providerConnections.filter(
              (row) => row.state === 'READY',
            ).length,
            degradedConnections: providerConnections.filter(
              (row) => row.state === 'DEGRADED',
            ).length,
            failedCalendarEvents: calendarEvents.filter(
              (row) => row.status === 'SYNC_FAILED',
            ).length,
          },
        };
      }),
    );
  }

  async configureProvider(
    dto: ConfigureProviderConnectionDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    const rows = await this.runSafely('provider.configure', () =>
      this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT connection_id AS "connectionId", provider, display_name AS "displayName",
            state, secret_reference AS "secretReference",
            mailbox_address AS "mailboxAddress", phone_number AS "phoneNumber",
            capabilities::text[] AS capabilities, webhook_public_id AS "webhookPublicId",
            version
          FROM private.upsert_provider_connection(
            ${dto.connectionId ?? null}::uuid,
            ${dto.provider}::public.integration_provider,
            ${dto.displayName}, ${dto.secretReference},
            ${dto.mailboxAddress ?? null}, ${dto.phoneNumber ?? null},
            ${dto.capabilities}::text[], ${dto.expectedVersion}
          )
        `,
      ),
    );
    const configured = this.requireOne(rows, 'provider configuration');
    const health = await this.checkConnection(String(configured.connectionId));
    return {
      ...configured,
      secretReference: undefined,
      credentialConfigured: true,
      health,
    };
  }

  async testProvider(
    connectionId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    await this.assertConnectionAccess(connectionId, context);
    return this.checkConnection(connectionId);
  }

  async setProviderStatus(
    connectionId: string,
    dto: SetProviderConnectionStatusDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    const rows = await this.runSafely('provider.status', () =>
      this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<RecordValue[]>`
          SELECT connection_id AS "connectionId",
            connection_status AS "connectionStatus", state, version
          FROM private.set_provider_connection_status(
            ${connectionId}::uuid,
            ${dto.status}::public.integration_connection_status,
            ${dto.reason},
            ${dto.expectedVersion}
          )
        `,
      ),
    );
    const result = this.requireOne(rows, 'provider status');
    if (dto.status === 'DISABLED') return result;
    const health = await this.checkConnection(connectionId);
    return { ...result, state: health.state, health };
  }

  async manualSync(
    connectionId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    await this.assertConnectionAccess(connectionId, context);
    const count = await this.syncConnection(connectionId);
    return { connectionId, accepted: true, processedMessages: count };
  }

  async syncConnection(connectionId: string): Promise<number> {
    const provider = await this.runtimeContext(connectionId);
    if (!provider.capabilities.includes('EMAIL')) {
      throw new BadRequestException(
        'This provider connection does not have mailbox sync enabled.',
      );
    }
    try {
      const result = await this.providers.sync(provider);
      let processed = 0;
      for (const message of result.messages) {
        const payloadHash = createHash('sha256')
          .update(
            JSON.stringify({
              id: message.providerMessageId,
              thread: message.providerThreadId,
              sender: message.sender,
              recipients: message.recipients,
              subject: message.subject,
              body: message.bodyText,
              occurredAt: message.occurredAt.toISOString(),
            }),
          )
          .digest('hex');
        const [recorded] = await this.database.$queryRaw<
          Array<{
            conversationId: string;
            messageId: string;
            duplicate: boolean;
          }>
        >`
          SELECT conversation_id AS "conversationId", message_id AS "messageId", duplicate
          FROM private.record_external_communication(
            ${connectionId}::uuid, ${message.externalEventId}, ${payloadHash},
            'EMAIL'::public.business_communication_channel,
            ${message.providerMessageId}, ${message.providerThreadId}, ${message.sender},
            ${message.recipients}::text[], ${message.subject}, ${message.bodyText},
            ${message.occurredAt}::timestamptz
          )
        `;
        if (recorded) {
          await this.database.$queryRaw`
            SELECT private.attach_provider_communication(
              ${connectionId}::uuid, ${recorded.conversationId}::uuid, ${recorded.messageId}::uuid
            )
          `;
          if (!recorded.duplicate) processed += 1;
        }
      }
      await this.database.$queryRaw`
        SELECT private.complete_provider_sync(
          ${connectionId}::uuid, ${result.nextCursor}, ${processed}
        )
      `;
      return processed;
    } catch (error) {
      const code =
        error instanceof ProviderOperationError
          ? error.code
          : 'PROVIDER_SYNC_FAILED';
      await this.recordHealth(
        connectionId,
        false,
        code,
        'Mailbox synchronisation failed.',
      );
      throw error;
    }
  }

  async createCalendarEvent(
    dto: CreateBusinessCalendarEventDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<CalendarRow> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt.getTime() < Date.now() - 60_000 || endsAt <= startsAt) {
      throw new BadRequestException(
        'The appointment must have a valid future time range.',
      );
    }
    const rows = await this.runSafely('calendar.create', () =>
      this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<CalendarRow[]>`
          SELECT id, organisation_id AS "organisationId",
            integration_connection_id AS "integrationConnectionId",
            client_id AS "clientId", matter_id AS "matterId",
            conversation_id AS "conversationId", title, description,
            starts_at AS "startsAt", ends_at AS "endsAt", timezone, location,
            attendee_addresses::text[] AS "attendeeAddresses", status::text AS status,
            provider_event_id AS "providerEventId", provider_join_url AS "providerJoinUrl",
            idempotency_key AS "idempotencyKey",
            reminder_minutes_before AS "reminderMinutesBefore",
            failure_code AS "failureCode", failure_detail AS "failureDetail",
            version, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM private.create_business_calendar_event(
            ${dto.integrationConnectionId}::uuid, ${dto.clientId ?? null}::uuid,
            ${dto.matterId ?? null}::uuid, ${dto.conversationId ?? null}::uuid,
            ${dto.title}, ${dto.description ?? null}, ${startsAt}::timestamptz,
            ${endsAt}::timestamptz, ${dto.timezone}, ${dto.location ?? null},
            ${dto.attendeeAddresses}::text[], ${dto.reminderMinutesBefore ?? null}::smallint,
            ${dto.idempotencyKey}
          )
        `,
      ),
    );
    const event = this.requireOne(rows, 'calendar event') as CalendarRow;
    // Reusing an idempotency key returns the durable original operation. Only
    // the initial PENDING_SYNC state is allowed to call the external provider;
    // failed or terminal records require the explicit, version-checked retry.
    if (event.status !== 'PENDING_SYNC') return event;
    return this.syncCalendarCreation(event);
  }

  async retryCalendarEvent(
    eventId: string,
    dto: RetryBusinessCalendarEventDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<CalendarRow | RecordValue> {
    const rows = await this.runSafely('calendar.retry', () =>
      this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<CalendarRow[]>`
          SELECT id, organisation_id AS "organisationId",
            integration_connection_id AS "integrationConnectionId",
            client_id AS "clientId", matter_id AS "matterId",
            conversation_id AS "conversationId", title, description,
            starts_at AS "startsAt", ends_at AS "endsAt", timezone, location,
            attendee_addresses::text[] AS "attendeeAddresses", status::text AS status,
            provider_event_id AS "providerEventId", provider_join_url AS "providerJoinUrl",
            idempotency_key AS "idempotencyKey",
            reminder_minutes_before AS "reminderMinutesBefore",
            failure_code AS "failureCode", failure_detail AS "failureDetail",
            version, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM private.begin_calendar_retry(
            ${eventId}::uuid, ${dto.expectedVersion}
          )
        `,
      ),
    );
    const event = this.requireOne(rows, 'calendar retry') as CalendarRow;
    if (!event.providerEventId) return this.syncCalendarCreation(event);

    const provider = await this.runtimeContext(event.integrationConnectionId);
    try {
      await this.providers.cancelCalendarEvent(provider, event.providerEventId);
      await this.database
        .$queryRaw`SELECT private.complete_calendar_cancellation(${event.id}::uuid)`;
      return { ...event, status: 'CANCELLED', version: event.version + 1 };
    } catch (error) {
      const code =
        error instanceof ProviderOperationError
          ? error.code
          : 'CALENDAR_CANCELLATION_FAILED';
      await this.database.$queryRaw`
        SELECT private.fail_calendar_sync(
          ${event.id}::uuid, ${code}, 'The provider did not confirm cancellation.'
        )
      `;
      throw new ServiceUnavailableException(
        'The cancellation retry was recorded but the provider did not confirm it. The event remains sync failed.',
      );
    }
  }

  private async syncCalendarCreation(event: CalendarRow): Promise<CalendarRow> {
    const provider = await this.runtimeContext(event.integrationConnectionId);
    try {
      const receipt = await this.providers.createCalendarEvent(provider, {
        eventId: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        location: event.location,
        attendeeAddresses: event.attendeeAddresses,
        reminderMinutesBefore: event.reminderMinutesBefore,
        idempotencyKey: event.idempotencyKey,
      });
      if (!receipt.providerEventId || receipt.providerEventId.length > 512) {
        throw new ProviderOperationError(
          'CALENDAR_PROVIDER_IDENTIFIER_INVALID',
          'The provider returned an invalid calendar identifier.',
          false,
        );
      }
      await this.database.$queryRaw`
        SELECT private.complete_calendar_sync(
          ${event.id}::uuid, ${receipt.providerEventId}, ${receipt.joinUrl}
        )
      `;
      return {
        ...event,
        status: 'SCHEDULED',
        providerEventId: receipt.providerEventId,
        providerJoinUrl: receipt.joinUrl,
        version: event.version + 1,
      };
    } catch (error) {
      const code =
        error instanceof ProviderOperationError
          ? error.code
          : 'CALENDAR_PROVIDER_FAILED';
      await this.database.$queryRaw`
        SELECT private.fail_calendar_sync(${event.id}::uuid, ${code}, 'The calendar provider did not accept the appointment.')
      `;
      throw new ServiceUnavailableException(
        'The appointment was recorded but the calendar provider did not accept it. It is visible as sync failed and can be retried safely.',
      );
    }
  }

  async cancelCalendarEvent(
    eventId: string,
    dto: CancelBusinessCalendarEventDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    const rows = await this.runSafely('calendar.cancel', () =>
      this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<CalendarRow[]>`
          SELECT id, organisation_id AS "organisationId",
            integration_connection_id AS "integrationConnectionId",
            provider_event_id AS "providerEventId", status::text AS status, version
          FROM private.begin_calendar_cancellation(
            ${eventId}::uuid, ${dto.reason}, ${dto.expectedVersion}
          )
        `,
      ),
    );
    const event = this.requireOne(
      rows,
      'calendar event',
    ) as unknown as CalendarRow;
    if (!event.providerEventId)
      throw new ConflictException(
        'The calendar event has no provider identifier.',
      );
    const provider = await this.runtimeContext(event.integrationConnectionId);
    try {
      await this.providers.cancelCalendarEvent(provider, event.providerEventId);
      await this.database
        .$queryRaw`SELECT private.complete_calendar_cancellation(${event.id}::uuid)`;
      return { id: event.id, status: 'CANCELLED', version: event.version + 2 };
    } catch (error) {
      const code =
        error instanceof ProviderOperationError
          ? error.code
          : 'CALENDAR_CANCELLATION_FAILED';
      await this.database.$queryRaw`
        SELECT private.fail_calendar_sync(${event.id}::uuid, ${code}, 'The provider did not confirm cancellation.')
      `;
      throw new ServiceUnavailableException(
        'Cancellation was recorded but the provider did not confirm it. The event is marked sync failed for controlled recovery.',
      );
    }
  }

  setCalendarOutcome(
    eventId: string,
    dto: SetBusinessCalendarOutcomeDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('calendar.outcome', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT id, status::text AS status, version, updated_at AS "updatedAt"
          FROM private.set_calendar_outcome(
            ${eventId}::uuid,
            ${dto.status}::public.business_calendar_event_status,
            ${dto.reason}, ${dto.expectedVersion}
          )
        `,
      );
      return this.requireOne(rows, 'calendar event');
    });
  }

  async runtimeContext(connectionId: string): Promise<ProviderRuntimeContext> {
    const [context] = await this.database.$queryRaw<ProviderConfigRow[]>`
      SELECT organisation_id AS "organisationId", connection_id AS "connectionId",
        provider, secret_reference AS "secretReference",
        capabilities::text[] AS capabilities, mailbox_address AS "mailboxAddress",
        phone_number AS "phoneNumber", sync_cursor AS "syncCursor", state,
        webhook_public_id AS "webhookPublicId"
      FROM private.get_provider_runtime_context(${connectionId}::uuid)
    `;
    if (!context)
      throw new NotFoundException('The provider connection is unavailable.');
    return context;
  }

  async webhookContext(
    webhookPublicId: string,
  ): Promise<ProviderRuntimeContext> {
    const [context] = await this.database.$queryRaw<ProviderConfigRow[]>`
      SELECT organisation_id AS "organisationId", connection_id AS "connectionId",
        provider, secret_reference AS "secretReference",
        capabilities::text[] AS capabilities, mailbox_address AS "mailboxAddress",
        phone_number AS "phoneNumber", sync_cursor AS "syncCursor", state,
        webhook_public_id AS "webhookPublicId"
      FROM private.get_provider_webhook_context(${webhookPublicId}::uuid)
    `;
    if (!context)
      throw new NotFoundException('The provider webhook is unavailable.');
    return context;
  }

  private async checkConnection(connectionId: string): Promise<RecordValue> {
    const provider = await this.runtimeContext(connectionId);
    try {
      await this.providers.health(provider);
      await this.recordHealth(connectionId, true, null, null);
      return {
        connectionId,
        healthy: true,
        state: 'READY',
        checkedAt: new Date(),
      };
    } catch (error) {
      const code =
        error instanceof ProviderOperationError
          ? error.code
          : 'PROVIDER_HEALTH_FAILED';
      await this.recordHealth(
        connectionId,
        false,
        code,
        'The provider health check failed.',
      );
      return {
        connectionId,
        healthy: false,
        state: 'DEGRADED',
        errorCode: code,
        message:
          'Configuration was saved, but the live provider health check failed.',
        checkedAt: new Date(),
      };
    }
  }

  private async recordHealth(
    connectionId: string,
    healthy: boolean,
    code: string | null,
    detail: string | null,
  ): Promise<void> {
    await this.database.$queryRaw`
      SELECT private.record_provider_health(
        ${connectionId}::uuid, ${healthy}, ${code}, ${detail}
      )
    `;
  }

  private async assertConnectionAccess(
    connectionId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<void> {
    const rows = await this.rls.run(
      this.rlsContext(context),
      (transaction) => transaction.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM public.provider_connection_configs AS config
          WHERE config.connection_id = ${connectionId}::uuid
            AND config.organisation_id = ${context.organisationId}::uuid
        ) AS allowed
      `,
    );
    if (rows[0]?.allowed !== true) {
      throw new NotFoundException('The provider connection is unavailable.');
    }
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private requireOne<T>(rows: T[], description: string): T {
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new InternalServerErrorException(
        `The ${description} returned an invalid response.`,
      );
    }
    return rows[0];
  }

  private async runSafely<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const code = postgresCode(error);
      this.logger.warn(
        `Gate L operation failed; operation=${operation}; sqlState=${code ?? 'unknown'}`,
      );
      if (code === '42501')
        throw new ForbiddenException('This Gate L operation is not permitted.');
      if (code === 'P0002' || code === '02000')
        throw new NotFoundException(
          'The requested Gate L record is unavailable.',
        );
      if (code === '40001' || code === '23505')
        throw new ConflictException(
          'The record changed or the operation was already used. Refresh and retry.',
        );
      if (code === '22023' || code === '23514')
        throw new BadRequestException('The Gate L operation is invalid.');
      throw new InternalServerErrorException(
        'The Gate L operation could not be completed safely.',
      );
    }
  }
}
