import { randomUUID } from 'node:crypto';

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
import { ConfigService } from '@nestjs/config';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import type { Environment } from '../config/env.validation';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { EmailService } from '../notifications/email.service';
import {
  CancelCommunicationReminderDto,
  CreateClientPortalInvitationDto,
  CreateCommunicationConversationDto,
  CreateCommunicationTemplateDto,
  PublishClientPortalUpdateDto,
  RevokeClientPortalAccessDto,
  ScheduleCommunicationReminderDto,
  SendCommunicationMessageDto,
} from './dto/communications.dto';
import { PortalInvitationTokenService } from './portal-invitation-token.service';

type RecordValue = Record<string, unknown>;

type InvitationDeliveryRow = {
  id: string;
  organisationId: string;
  organisationName: string;
  clientId: string;
  clientName: string;
  email: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

type MessageResultRow = {
  messageId: string;
  messageStatus: string;
  channel: string;
  createdAt: Date;
};

type PortalUpdateResultRow = {
  updateId: string;
  matterId: string;
  publishedAt: Date;
};

type RevokeAccessResultRow = {
  accessGrantId: string;
  accessStatus: string;
  revokedAt: Date;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function postgresCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 6) return undefined;

  for (const key of ['originalCode', 'sqlState', 'sqlstate']) {
    const value = error[key];
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) {
      return value;
    }
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
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly rls: RlsTransactionService,
    private readonly tokens: PortalInvitationTokenService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  getDashboard(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('dashboard.read', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const conversations = await transaction.$queryRaw<RecordValue[]>`
          SELECT
            conversation_record.id,
            conversation_record.matter_id AS "matterId",
            matter_record.matter_number AS "matterNumber",
            matter_record.title AS "matterTitle",
            conversation_record.client_id AS "clientId",
            client_record.display_name AS "clientName",
            conversation_record.channel::text AS channel,
            conversation_record.subject,
            conversation_record.status::text AS status,
            conversation_record.assigned_to_user_id AS "assignedToUserId",
            assignee.display_name AS "assignedToName",
            conversation_record.last_message_at AS "lastMessageAt",
            conversation_record.version,
            conversation_record.created_at AS "createdAt",
            COALESCE((
              SELECT jsonb_agg(message_payload ORDER BY message_created_at)
              FROM (
                SELECT
                  message_record.created_at AS message_created_at,
                  jsonb_build_object(
                    'id', message_record.id,
                    'direction', message_record.direction::text,
                    'actorType', message_record.actor_type::text,
                    'authorUserProfileId', message_record.author_user_profile_id,
                    'subject', message_record.subject,
                    'bodyText', message_record.body_text,
                    'status', message_record.status::text,
                    'recipientAddresses', message_record.recipient_addresses,
                    'provider', message_record.provider,
                    'providerMessageId', message_record.provider_message_id,
                    'sentAt', message_record.sent_at,
                    'deliveredAt', message_record.delivered_at,
                    'failedAt', message_record.failed_at,
                    'failureCode', message_record.failure_code,
                    'failureDetail', message_record.failure_detail,
                    'createdAt', message_record.created_at
                  ) AS message_payload
                FROM public.communication_messages AS message_record
                WHERE message_record.organisation_id = ${context.organisationId}::uuid
                  AND message_record.conversation_id = conversation_record.id
                ORDER BY message_record.created_at DESC
                LIMIT 100
              ) AS recent_messages
            ), '[]'::jsonb) AS messages
          FROM public.communication_conversations AS conversation_record
          LEFT JOIN public.matters AS matter_record
            ON matter_record.id = conversation_record.matter_id
           AND matter_record.organisation_id = conversation_record.organisation_id
          LEFT JOIN public.clients AS client_record
            ON client_record.id = conversation_record.client_id
           AND client_record.organisation_id = conversation_record.organisation_id
          LEFT JOIN public.user_profiles AS assignee
            ON assignee.id = conversation_record.assigned_to_user_id
          WHERE conversation_record.organisation_id = ${context.organisationId}::uuid
            AND conversation_record.deleted_at IS NULL
          ORDER BY conversation_record.last_message_at DESC NULLS LAST,
            conversation_record.created_at DESC
          LIMIT 100
        `;

        const templates = await transaction.$queryRaw<RecordValue[]>`
          SELECT
            template_record.id,
            template_record.key,
            template_record.name,
            template_record.description,
            template_record.channel::text AS channel,
            template_record.subject_template AS "subjectTemplate",
            template_record.body_template AS "bodyTemplate",
            template_record.allowed_variables AS "allowedVariables",
            template_record.status::text AS status,
            template_record.version,
            template_record.updated_at AS "updatedAt"
          FROM public.communication_templates AS template_record
          WHERE template_record.organisation_id = ${context.organisationId}::uuid
            AND template_record.deleted_at IS NULL
          ORDER BY template_record.status, template_record.name
          LIMIT 100
        `;

        const invitations = await transaction.$queryRaw<RecordValue[]>`
          SELECT
            invitation_record.id,
            invitation_record.client_id AS "clientId",
            client_record.display_name AS "clientName",
            invitation_record.email,
            invitation_record.matter_ids AS "matterIds",
            invitation_record.scopes,
            invitation_record.status::text AS status,
            invitation_record.expires_at AS "expiresAt",
            invitation_record.delivered_at AS "deliveredAt",
            invitation_record.delivery_error_code AS "deliveryErrorCode",
            invitation_record.created_at AS "createdAt"
          FROM public.client_portal_invitations AS invitation_record
          JOIN public.clients AS client_record
            ON client_record.id = invitation_record.client_id
           AND client_record.organisation_id = invitation_record.organisation_id
          WHERE invitation_record.organisation_id = ${context.organisationId}::uuid
          ORDER BY invitation_record.created_at DESC
          LIMIT 100
        `;

        const accessGrants = await transaction.$queryRaw<RecordValue[]>`
          SELECT
            access_record.id,
            access_record.client_id AS "clientId",
            client_record.display_name AS "clientName",
            access_record.user_profile_id AS "userProfileId",
            profile_record.email,
            access_record.status::text AS status,
            access_record.scopes,
            access_record.starts_at AS "startsAt",
            access_record.expires_at AS "expiresAt",
            access_record.last_accessed_at AS "lastAccessedAt",
            access_record.revoked_at AS "revokedAt",
            access_record.created_at AS "createdAt",
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', matter_record.id,
                  'matterNumber', matter_record.matter_number,
                  'title', matter_record.title
                ) ORDER BY matter_record.created_at DESC
              )
              FROM public.client_portal_matter_grants AS matter_grant
              JOIN public.matters AS matter_record
                ON matter_record.id = matter_grant.matter_id
               AND matter_record.organisation_id = matter_grant.organisation_id
              WHERE matter_grant.access_grant_id = access_record.id
                AND matter_grant.organisation_id = access_record.organisation_id
            ), '[]'::jsonb) AS matters
          FROM public.client_portal_access_grants AS access_record
          JOIN public.clients AS client_record
            ON client_record.id = access_record.client_id
           AND client_record.organisation_id = access_record.organisation_id
          JOIN public.user_profiles AS profile_record
            ON profile_record.id = access_record.user_profile_id
          WHERE access_record.organisation_id = ${context.organisationId}::uuid
          ORDER BY access_record.created_at DESC
          LIMIT 100
        `;

        const reminders = await transaction.$queryRaw<RecordValue[]>`
          SELECT
            reminder_record.id,
            reminder_record.conversation_id AS "conversationId",
            reminder_record.matter_id AS "matterId",
            reminder_record.client_id AS "clientId",
            reminder_record.channel::text AS channel,
            reminder_record.recipient_address AS "recipientAddress",
            reminder_record.subject,
            reminder_record.body_text AS "bodyText",
            reminder_record.scheduled_for AS "scheduledFor",
            reminder_record.status::text AS status,
            reminder_record.message_id AS "messageId",
            reminder_record.failure_code AS "failureCode",
            reminder_record.created_at AS "createdAt"
          FROM public.communication_reminders AS reminder_record
          WHERE reminder_record.organisation_id = ${context.organisationId}::uuid
          ORDER BY reminder_record.scheduled_for DESC
          LIMIT 100
        `;

        const deliveryEvents = await transaction.$queryRaw<RecordValue[]>`
          SELECT
            event_record.id,
            event_record.message_id AS "messageId",
            conversation_record.id AS "conversationId",
            conversation_record.subject,
            event_record.event_type::text AS "eventType",
            event_record.provider,
            event_record.occurred_at AS "occurredAt"
          FROM public.communication_delivery_events AS event_record
          JOIN public.communication_messages AS message_record
            ON message_record.id = event_record.message_id
           AND message_record.organisation_id = event_record.organisation_id
          JOIN public.communication_conversations AS conversation_record
            ON conversation_record.id = message_record.conversation_id
           AND conversation_record.organisation_id = message_record.organisation_id
          WHERE event_record.organisation_id = ${context.organisationId}::uuid
          ORDER BY event_record.occurred_at DESC, event_record.id DESC
          LIMIT 200
        `;

        return {
          conversations,
          templates,
          invitations,
          accessGrants,
          reminders,
          deliveryEvents,
        };
      }),
    );
  }

  createConversation(
    dto: CreateCommunicationConversationDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    if (!dto.matterId && !dto.clientId) {
      throw new BadRequestException(
        'A conversation must be linked to a client or matter.',
      );
    }
    if (dto.channel === 'PORTAL' && (!dto.matterId || !dto.clientId)) {
      throw new BadRequestException(
        'A portal conversation must be linked to both a client and matter.',
      );
    }

    return this.runSafely('conversation.create', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        async (transaction) => {
          const conversationId = randomUUID();

          /*
           * INSERT ... RETURNING applies the SELECT RLS policy before its
           * stable visibility helper can observe the newly inserted row.
           * Insert first, then select after the command boundary.
           */
          await transaction.$executeRaw`
            INSERT INTO public.communication_conversations (
              id, organisation_id, matter_id, client_id, channel,
              subject, status, assigned_to_user_id, created_by_user_id,
              created_at, updated_at
            )
            VALUES (
              ${conversationId}::uuid,
              ${context.organisationId}::uuid,
              ${dto.matterId ?? null}::uuid,
              ${dto.clientId ?? null}::uuid,
              ${dto.channel}::public.business_communication_channel,
              ${dto.subject},
              'OPEN',
              ${dto.assignedToUserId ?? null}::uuid,
              ${context.userId}::uuid,
              pg_catalog.now(),
              pg_catalog.now()
            )
          `;

          return transaction.$queryRaw<RecordValue[]>`
            SELECT
              conversation_record.id,
              conversation_record.matter_id AS "matterId",
              conversation_record.client_id AS "clientId",
              conversation_record.channel::text AS channel,
              conversation_record.subject,
              conversation_record.status::text AS status,
              conversation_record.assigned_to_user_id AS "assignedToUserId",
              conversation_record.version,
              conversation_record.created_at AS "createdAt"
            FROM public.communication_conversations AS conversation_record
            WHERE conversation_record.id = ${conversationId}::uuid
              AND conversation_record.organisation_id =
                ${context.organisationId}::uuid
          `;
        },
      );

      return this.requireOne(rows, 'conversation');
    });
  }
  sendMessage(
    conversationId: string,
    dto: SendCommunicationMessageDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MessageResultRow> {
    return this.runSafely('message.send', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<MessageResultRow[]>`
          SELECT
            message_id AS "messageId",
            message_status AS "messageStatus",
            channel,
            created_at AS "createdAt"
          FROM private.create_staff_communication_message(
            ${conversationId}::uuid,
            ${dto.subject ?? null},
            ${dto.bodyText},
            ${dto.recipientAddresses ?? []}::text[],
            ${dto.scheduledAt ? new Date(dto.scheduledAt) : null}::timestamptz,
            ${dto.idempotencyKey}
          )
        `,
      );

      return this.requireOne(rows, 'message');
    });
  }

  createTemplate(
    dto: CreateCommunicationTemplateDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('template.create', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<RecordValue[]>`
          INSERT INTO public.communication_templates (
            organisation_id, key, name, description, channel,
            subject_template, body_template, allowed_variables,
            status, version, created_by_user_id, updated_by_user_id,
            created_at, updated_at
          )
          VALUES (
            ${context.organisationId}::uuid,
            ${dto.key},
            ${dto.name},
            ${dto.description ?? null},
            ${dto.channel}::public.business_communication_channel,
            ${dto.subjectTemplate ?? null},
            ${dto.bodyTemplate},
            ${dto.allowedVariables ?? []}::text[],
            ${dto.status ?? 'DRAFT'}::public.communication_template_status,
            1,
            ${context.userId}::uuid,
            ${context.userId}::uuid,
            pg_catalog.now(),
            pg_catalog.now()
          )
          RETURNING
            id, key, name, channel::text AS channel,
            status::text AS status, version, created_at AS "createdAt"
        `,
      );

      return this.requireOne(rows, 'template');
    });
  }

  createPortalInvitation(
    dto: CreateClientPortalInvitationDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('portal.invitation.create', async () => {
      const issued = this.tokens.issue();
      const configuredTtl = this.config.get('PORTAL_INVITATION_TTL_HOURS', {
        infer: true,
      });
      const expiresAt = new Date(
        Date.now() + (dto.expiresInHours ?? configuredTtl) * 60 * 60 * 1000,
      );
      const scopes = dto.scopes ?? [
        'MATTER_PROGRESS',
        'DOCUMENTS',
        'MESSAGES',
        'NOTIFICATIONS',
        'BILLING',
      ];

      const invitation = await this.rls.run(
        this.rlsContext(context),
        async (transaction) => {
          await transaction.$executeRaw`
            UPDATE public.client_portal_invitations
            SET status = 'EXPIRED',
                updated_at = pg_catalog.now()
            WHERE organisation_id = ${context.organisationId}::uuid
              AND client_id = ${dto.clientId}::uuid
              AND email = ${dto.email}
              AND status = 'PENDING'
              AND expires_at <= pg_catalog.now()
          `;

          const rows = await transaction.$queryRaw<InvitationDeliveryRow[]>`
            INSERT INTO public.client_portal_invitations (
              organisation_id, client_id, email, matter_ids, scopes,
              token_hash, status, expires_at, invited_by_user_id,
              created_at, updated_at
            )
            SELECT
              organisation_record.id,
              client_record.id,
              ${dto.email},
              ${dto.matterIds}::uuid[],
              ${scopes}::text[],
              ${issued.tokenHash},
              'PENDING',
              ${expiresAt},
              ${context.userId}::uuid,
              pg_catalog.now(),
              pg_catalog.now()
            FROM public.organisations AS organisation_record
            JOIN public.clients AS client_record
              ON client_record.organisation_id = organisation_record.id
             AND client_record.id = ${dto.clientId}::uuid
             AND client_record.deleted_at IS NULL
            WHERE organisation_record.id = ${context.organisationId}::uuid
              AND organisation_record.status = 'ACTIVE'
              AND organisation_record.deleted_at IS NULL
            RETURNING
              id,
              organisation_id AS "organisationId",
              (
                SELECT name FROM public.organisations
                WHERE id = client_portal_invitations.organisation_id
              ) AS "organisationName",
              client_id AS "clientId",
              (
                SELECT display_name FROM public.clients
                WHERE id = client_portal_invitations.client_id
                  AND organisation_id = client_portal_invitations.organisation_id
              ) AS "clientName",
              email,
              status::text AS status,
              expires_at AS "expiresAt",
              created_at AS "createdAt"
          `;

          return this.requireOne(rows, 'portal invitation');
        },
      );

      try {
        const receipt = await this.email.sendClientPortalInvitation({
          invitationId: invitation.id,
          recipientEmail: invitation.email,
          organisationName: invitation.organisationName,
          clientName: invitation.clientName,
          invitationToken: issued.token,
          expiresAt: invitation.expiresAt,
        });

        await this.rls.run(
          this.rlsContext(context),
          (transaction) => transaction.$executeRaw`
            UPDATE public.client_portal_invitations
            SET delivery_provider = ${receipt.provider},
                delivery_message_id = ${receipt.messageId},
                delivered_at = pg_catalog.now(),
                delivery_error_code = NULL,
                delivery_error_detail = NULL,
                updated_at = pg_catalog.now()
            WHERE id = ${invitation.id}::uuid
              AND organisation_id = ${context.organisationId}::uuid
              AND status = 'PENDING'
          `,
        );

        return {
          ...invitation,
          deliveryStatus: 'ACCEPTED',
          deliveryProvider: receipt.provider,
        };
      } catch (error: unknown) {
        await this.rls.run(
          this.rlsContext(context),
          (transaction) => transaction.$executeRaw`
            UPDATE public.client_portal_invitations
            SET status = 'REVOKED',
                revoked_at = pg_catalog.now(),
                revoked_by_user_id = ${context.userId}::uuid,
                revocation_reason = 'Invitation delivery failed before hand-off.',
                delivery_error_code = 'EMAIL_DELIVERY_FAILED',
                delivery_error_detail = 'The invitation was revoked because delivery failed.',
                updated_at = pg_catalog.now()
            WHERE id = ${invitation.id}::uuid
              AND organisation_id = ${context.organisationId}::uuid
              AND status = 'PENDING'
          `,
        );

        throw error;
      }
    });
  }

  revokePortalAccess(
    accessGrantId: string,
    dto: RevokeClientPortalAccessDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RevokeAccessResultRow> {
    return this.runSafely('portal.access.revoke', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<RevokeAccessResultRow[]>`
          SELECT
            access_grant_id AS "accessGrantId",
            access_status AS "accessStatus",
            revoked_at AS "revokedAt"
          FROM private.revoke_client_portal_access(
            ${accessGrantId}::uuid,
            ${dto.reason}
          )
        `,
      );

      return this.requireOne(rows, 'portal access grant');
    });
  }

  revokePortalInvitation(
    invitationId: string,
    dto: RevokeClientPortalAccessDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('portal.invitation.revoke', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<RecordValue[]>`
          WITH revoked AS (
            UPDATE public.client_portal_invitations
            SET status = 'REVOKED',
                revoked_at = pg_catalog.now(),
                revoked_by_user_id = ${context.userId}::uuid,
                revocation_reason = ${dto.reason},
                updated_at = pg_catalog.now()
            WHERE id = ${invitationId}::uuid
              AND organisation_id = ${context.organisationId}::uuid
              AND status = 'PENDING'
            RETURNING *
          ), audited AS (
            INSERT INTO public.audit_events (
              id, organisation_id, actor_type, actor_user_profile_id,
              source, action, resource_type, resource_id, outcome, reason,
              metadata
            )
            SELECT
              pg_catalog.gen_random_uuid(), revoked.organisation_id,
              'USER', ${context.userId}, 'businessos-api',
              'client_portal.invitation.revoked', 'client_portal_invitation',
              revoked.id::text, 'SUCCESS', ${dto.reason},
              jsonb_build_object('clientId', revoked.client_id)
            FROM revoked
          )
          SELECT
            id, client_id AS "clientId", email,
            status::text AS status, revoked_at AS "revokedAt"
          FROM revoked
        `,
      );

      return this.requireOne(rows, 'pending portal invitation');
    });
  }

  publishPortalUpdate(
    dto: PublishClientPortalUpdateDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<PortalUpdateResultRow> {
    return this.runSafely('portal.update.publish', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<PortalUpdateResultRow[]>`
          SELECT
            update_id AS "updateId",
            matter_id AS "matterId",
            published_at AS "publishedAt"
          FROM private.publish_client_portal_update(
            ${dto.matterId}::uuid,
            ${dto.title},
            ${dto.summary},
            ${dto.stageKey ?? null},
            ${dto.progressPercent ?? null}
          )
        `,
      );

      return this.requireOne(rows, 'portal update');
    });
  }

  scheduleReminder(
    dto: ScheduleCommunicationReminderDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    const scheduledFor = new Date(dto.scheduledFor);
    if (scheduledFor.getTime() <= Date.now() + 30_000) {
      throw new BadRequestException(
        'A reminder must be scheduled at least 30 seconds in the future.',
      );
    }

    return this.runSafely('reminder.schedule', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<RecordValue[]>`
          INSERT INTO public.communication_reminders (
            organisation_id, conversation_id, matter_id, client_id,
            channel, recipient_address, subject, body_text,
            scheduled_for, status, idempotency_key, created_by_user_id,
            created_at, updated_at
          )
          SELECT
            conversation_record.organisation_id,
            conversation_record.id,
            conversation_record.matter_id,
            conversation_record.client_id,
            conversation_record.channel,
            ${dto.recipientAddress ?? null},
            ${dto.subject ?? null},
            ${dto.bodyText},
            ${scheduledFor},
            'SCHEDULED',
            ${dto.idempotencyKey},
            ${context.userId}::uuid,
            pg_catalog.now(),
            pg_catalog.now()
          FROM public.communication_conversations AS conversation_record
          WHERE conversation_record.id = ${dto.conversationId}::uuid
            AND conversation_record.organisation_id = ${context.organisationId}::uuid
            AND conversation_record.channel = ${dto.channel}::public.business_communication_channel
            AND conversation_record.status <> 'ARCHIVED'
            AND conversation_record.deleted_at IS NULL
          RETURNING
            id, conversation_id AS "conversationId",
            channel::text AS channel, scheduled_for AS "scheduledFor",
            status::text AS status, created_at AS "createdAt"
        `,
      );

      return this.requireOne(rows, 'reminder');
    });
  }

  cancelReminder(
    reminderId: string,
    dto: CancelCommunicationReminderDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<RecordValue> {
    return this.runSafely('reminder.cancel', async () => {
      const rows = await this.rls.run(
        this.rlsContext(context),
        (transaction) => transaction.$queryRaw<RecordValue[]>`
          WITH cancelled AS (
            UPDATE public.communication_reminders
            SET status = 'CANCELLED',
                cancelled_at = pg_catalog.now(),
                cancelled_by_user_id = ${context.userId}::uuid,
                cancellation_reason = ${dto.reason},
                updated_at = pg_catalog.now()
            WHERE id = ${reminderId}::uuid
              AND organisation_id = ${context.organisationId}::uuid
              AND status = 'SCHEDULED'
            RETURNING *
          ), audited AS (
            INSERT INTO public.audit_events (
              id, organisation_id, actor_type, actor_user_profile_id,
              source, action, resource_type, resource_id, outcome, reason,
              metadata
            )
            SELECT
              pg_catalog.gen_random_uuid(), cancelled.organisation_id,
              'USER', ${context.userId}, 'businessos-api',
              'communication.reminder.cancelled', 'communication_reminder',
              cancelled.id::text, 'SUCCESS', ${dto.reason},
              jsonb_build_object('conversationId', cancelled.conversation_id)
            FROM cancelled
          )
          SELECT
            id, conversation_id AS "conversationId",
            status::text AS status, cancelled_at AS "cancelledAt"
          FROM cancelled
        `,
      );

      return this.requireOne(rows, 'scheduled reminder');
    });
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

  private async runSafely<T>(operation: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      const code = postgresCode(error);

      if (code === '42501') {
        this.logger.error(
          `Communication permission failure; operation=${operation}; databaseCode=42501; errorType=${
            error instanceof Error ? error.name : typeof error
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        throw new ForbiddenException(
          'You do not have permission to perform this communication action.',
        );
      }
      if (code === 'P0002' || code === '02000') {
        throw new NotFoundException(
          'The requested communication record was not found.',
        );
      }
      if (['23505', '23P01', '55000'].includes(code ?? '')) {
        throw new ConflictException(
          'The communication record changed or already exists.',
        );
      }
      if (['22023', '23514', '23503', '0A000'].includes(code ?? '')) {
        throw new BadRequestException(
          'The communication request is invalid in its current state.',
        );
      }

      this.logger.error(
        `Communication operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${
          error instanceof Error ? error.name : typeof error
        }`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new InternalServerErrorException(
        'The communications service is temporarily unavailable.',
      );
    }
  }
}
