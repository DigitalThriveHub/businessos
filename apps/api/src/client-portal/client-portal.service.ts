import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  resolveAssuranceLevel,
  type VerifiedUserJwtPayload,
} from '../auth/verified-jwt-payload';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { PortalInvitationTokenService } from '../communications/portal-invitation-token.service';
import {
  FinaliseClientPortalDocumentDto,
  PostClientPortalMessageDto,
  RegisterClientPortalDocumentDto,
} from './dto/client-portal.dto';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
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
export class ClientPortalService {
  private readonly logger = new Logger(ClientPortalService.name);

  constructor(
    private readonly rls: RlsTransactionService,
    private readonly tokens: PortalInvitationTokenService,
  ) {}

  getDashboard(user: VerifiedUserJwtPayload): Promise<unknown> {
    return this.runSafely('dashboard.read', async () => {
      const rows = await this.rls.run(
        this.context(user),
        (transaction) =>
          transaction.$queryRaw<{ dashboard: unknown }[]>`
          SELECT private.get_client_portal_dashboard() AS dashboard
        `,
      );

      if (rows.length !== 1 || rows[0]?.dashboard === undefined) {
        throw new InternalServerErrorException(
          'The client portal returned an invalid response.',
        );
      }

      return rows[0].dashboard;
    });
  }

  acceptInvitation(
    rawToken: string,
    user: VerifiedUserJwtPayload,
  ): Promise<RecordValue> {
    return this.runSafely('invitation.accept', async () => {
      const tokenHash = this.tokens.hashToken(rawToken);
      const rows = await this.rls.run(
        this.context(user),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT
            invitation_id AS "invitationId",
            access_grant_id AS "accessGrantId",
            organisation_id AS "organisationId",
            organisation_name AS "organisationName",
            client_id AS "clientId",
            client_name AS "clientName",
            matter_ids AS "matterIds",
            scopes,
            invitation_status AS status
          FROM private.accept_client_portal_invitation(${tokenHash})
        `,
      );

      return this.requireOne(rows, 'client portal invitation');
    });
  }

  postMessage(
    conversationId: string,
    dto: PostClientPortalMessageDto,
    user: VerifiedUserJwtPayload,
  ): Promise<RecordValue> {
    return this.runSafely('message.post', async () => {
      const rows = await this.rls.run(
        this.context(user),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT
            message_id AS "messageId",
            conversation_id AS "conversationId",
            message_status AS status,
            created_at AS "createdAt"
          FROM private.post_client_portal_message(
            ${conversationId}::uuid,
            ${dto.bodyText},
            ${dto.idempotencyKey}
          )
        `,
      );

      return this.requireOne(rows, 'portal message');
    });
  }

  registerDocument(
    dto: RegisterClientPortalDocumentDto,
    user: VerifiedUserJwtPayload,
  ): Promise<RecordValue> {
    return this.runSafely('document.register', async () => {
      const rows = await this.rls.run(
        this.context(user),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT
            document_id AS "documentId",
            version_id AS "versionId",
            storage_bucket AS "storageBucket",
            storage_path AS "storagePath",
            document_status AS "documentStatus",
            scan_status AS "scanStatus"
          FROM private.register_client_portal_document_upload(
            ${dto.requestItemId}::uuid,
            ${dto.originalFileName},
            ${dto.contentType},
            ${BigInt(dto.sizeBytes)},
            ${dto.sha256Hex}
          )
        `,
      );

      return this.requireOne(rows, 'portal document registration');
    });
  }

  finaliseDocument(
    dto: FinaliseClientPortalDocumentDto,
    user: VerifiedUserJwtPayload,
  ): Promise<RecordValue> {
    return this.runSafely('document.finalise', async () => {
      const rows = await this.rls.run(
        this.context(user),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT
            document_id AS "documentId",
            version_id AS "versionId",
            document_status AS "documentStatus",
            scan_status AS "scanStatus"
          FROM private.finalise_client_portal_document_upload(
            ${dto.documentId}::uuid,
            ${dto.versionId}::uuid
          )
        `,
      );

      return this.requireOne(rows, 'portal document upload');
    });
  }

  markNotificationRead(
    notificationId: string,
    user: VerifiedUserJwtPayload,
  ): Promise<RecordValue> {
    return this.runSafely('notification.read', async () => {
      const rows = await this.rls.run(
        this.context(user),
        (transaction) =>
          transaction.$queryRaw<RecordValue[]>`
          SELECT
            notification_id AS "notificationId",
            read_at AS "readAt"
          FROM private.mark_client_notification_read(
            ${notificationId}::uuid
          )
        `,
      );

      return this.requireOne(rows, 'notification');
    });
  }

  private context(user: VerifiedUserJwtPayload) {
    return {
      userId: user.sub,
      aal: resolveAssuranceLevel(user),
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
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      const code = postgresCode(error);
      if (code === '42501') {
        throw new ForbiddenException(
          'This signed-in account does not have access to the requested client portal record.',
        );
      }
      if (code === 'P0002' || code === '02000') {
        throw new NotFoundException('The client portal record was not found.');
      }
      if (['23505', '23P01', '55000'].includes(code ?? '')) {
        throw new ConflictException(
          'The client portal record changed or is no longer available.',
        );
      }
      if (['22023', '23514', '23503'].includes(code ?? '')) {
        throw new BadRequestException(
          'The client portal request is invalid in its current state.',
        );
      }

      this.logger.error(
        `Client portal operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${
          error instanceof Error ? error.name : typeof error
        }`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new InternalServerErrorException(
        'The client portal service is temporarily unavailable.',
      );
    }
  }
}
