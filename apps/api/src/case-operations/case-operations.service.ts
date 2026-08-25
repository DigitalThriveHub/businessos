import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { Prisma } from '../generated/prisma/client';
import {
  ArchiveDocumentDto,
  ChangeMatterDeadlineStatusDto,
  ChangeMatterTaskStatusDto,
  CreateDocumentRequestDto,
  CreateMatterDeadlineDto,
  CreateMatterTaskDto,
  ManageDocumentRequestDto,
  RegisterDocumentUploadDto,
  RegisterDocumentVersionDto,
  SendDocumentRequestDto,
  UpdateDocumentMetadataDto,
  UpdateMatterDeadlineDto,
  UpdateMatterTaskDto,
} from './dto/case-operations.dto';
import type {
  DocumentProcessingView,
  DocumentScanStatus,
  DocumentRequestItemView,
  DocumentRequestView,
  DocumentUploadRegistrationView,
  MatterDeadlineView,
  MatterDocumentView,
  MatterOperationsView,
  CaseTaskStatus,
  MatterTaskView,
  MatterTimelineEventView,
} from './case-operations.types';

type Transaction = Prisma.TransactionClient;
type DatabaseDate = Date | string;
type NullableDatabaseDate = DatabaseDate | null;

interface MatterHeaderRow {
  id: string;
  matterNumber: string;
  title: string;
  serviceType: string;
  status: string;
  priority: string;
  primaryClientId: string;
  primaryClientName: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: MatterTaskView['status'];
  priority: MatterTaskView['priority'];
  assignedToUserId: string | null;
  assignedToName: string | null;
  dueAt: NullableDatabaseDate;
  reminderAt: NullableDatabaseDate;
  blockedReason: string | null;
  completionNote: string | null;
  completedAt: NullableDatabaseDate;
  cancellationReason: string | null;
  version: number;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
}

interface DeadlineRow {
  id: string;
  title: string;
  description: string | null;
  deadlineType: MatterDeadlineView['deadlineType'];
  status: MatterDeadlineView['status'];
  dueAt: DatabaseDate;
  timezone: string;
  isCritical: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceReference: string | null;
  satisfactionNote: string | null;
  missedReason: string | null;
  cancellationReason: string | null;
  version: number;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
}

interface RequestRow {
  id: string;
  recipientClientId: string | null;
  recipientClientName: string | null;
  title: string;
  message: string | null;
  status: DocumentRequestView['status'];
  dueAt: NullableDatabaseDate;
  sentAt: NullableDatabaseDate;
  completedAt: NullableDatabaseDate;
  statusReason: string | null;
  version: number;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
}

interface RequestItemRow {
  requestId: string;
  id: string;
  category: DocumentRequestItemView['category'];
  title: string;
  description: string | null;
  isRequired: boolean;
  status: DocumentRequestItemView['status'];
  statusReason: string | null;
}

interface DocumentRow {
  id: string;
  requestItemId: string | null;
  title: string;
  category: MatterDocumentView['category'];
  securityClassification: MatterDocumentView['securityClassification'];
  status: MatterDocumentView['status'];
  clientVisible: boolean;
  retentionReviewAt: NullableDatabaseDate;
  version: number;
  createdAt: DatabaseDate;
  updatedAt: DatabaseDate;
  currentVersionId: string | null;
  versionNumber: number | null;
  originalFileName: string | null;
  contentType: string | null;
  sizeBytes: bigint | number | null;
  sha256Hex: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  versionStatus: MatterDocumentView['status'] | null;
  scanStatus: DocumentScanStatus | null;
  uploadedAt: NullableDatabaseDate;
  scanCompletedAt: NullableDatabaseDate;
  pendingVersionId: string | null;
  pendingVersionNumber: number | null;
  pendingOriginalFileName: string | null;
  pendingContentType: string | null;
  pendingSizeBytes: bigint | number | null;
  pendingSha256Hex: string | null;
  pendingStorageBucket: string | null;
  pendingStoragePath: string | null;
  pendingVersionStatus: MatterDocumentView['status'] | null;
  pendingScanStatus: DocumentScanStatus | null;
  pendingUploadedAt: NullableDatabaseDate;
  pendingScanCompletedAt: NullableDatabaseDate;
}

interface TimelineRow {
  id: string;
  eventType: string;
  sourceType: string;
  sourceId: string | null;
  summary: string;
  details: unknown;
  actorType: MatterTimelineEventView['actorType'];
  actorUserId: string | null;
  actorIdentifier: string | null;
  actorName: string;
  occurredAt: DatabaseDate;
}

interface VersionStateRow {
  id: string;
  status: string;
  version: number;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const TASK_TRANSITIONS: Readonly<
  Record<CaseTaskStatus, readonly CaseTaskStatus[]>
> = {
  OPEN: ['IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['OPEN', 'BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function databaseCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function iso(value: DatabaseDate): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function nullableIso(value: NullableDatabaseDate): string | null {
  return value === null ? null : iso(value);
}

function safeDetails(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function taskView(row: TaskRow): MatterTaskView {
  return {
    ...row,
    dueAt: nullableIso(row.dueAt),
    reminderAt: nullableIso(row.reminderAt),
    completedAt: nullableIso(row.completedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function deadlineView(row: DeadlineRow): MatterDeadlineView {
  return {
    ...row,
    dueAt: iso(row.dueAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function documentView(row: DocumentRow): MatterDocumentView {
  const hasVersion = Boolean(
    row.currentVersionId &&
    row.versionNumber !== null &&
    row.originalFileName &&
    row.contentType &&
    row.sizeBytes !== null &&
    row.sha256Hex &&
    row.storageBucket &&
    row.storagePath &&
    row.versionStatus &&
    row.scanStatus,
  );

  return {
    id: row.id,
    requestItemId: row.requestItemId,
    title: row.title,
    category: row.category,
    securityClassification: row.securityClassification,
    status: row.status,
    clientVisible: row.clientVisible,
    retentionReviewAt: nullableIso(row.retentionReviewAt),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    currentVersion: hasVersion
      ? {
          id: row.currentVersionId!,
          versionNumber: row.versionNumber!,
          originalFileName: row.originalFileName!,
          contentType: row.contentType!,
          sizeBytes: Number(row.sizeBytes),
          sha256Hex: row.sha256Hex!,
          storageBucket: row.storageBucket!,
          storagePath: row.storagePath!,
          status: row.versionStatus!,
          scanStatus: row.scanStatus!,
          uploadedAt: nullableIso(row.uploadedAt),
          scanCompletedAt: nullableIso(row.scanCompletedAt),
        }
      : null,
    pendingVersion:
      row.pendingVersionId &&
      row.pendingVersionNumber !== null &&
      row.pendingOriginalFileName &&
      row.pendingContentType &&
      row.pendingSizeBytes !== null &&
      row.pendingSha256Hex &&
      row.pendingStorageBucket &&
      row.pendingStoragePath &&
      row.pendingVersionStatus &&
      row.pendingScanStatus
        ? {
            id: row.pendingVersionId,
            versionNumber: row.pendingVersionNumber,
            originalFileName: row.pendingOriginalFileName,
            contentType: row.pendingContentType,
            sizeBytes: Number(row.pendingSizeBytes),
            sha256Hex: row.pendingSha256Hex,
            storageBucket: row.pendingStorageBucket,
            storagePath: row.pendingStoragePath,
            status: row.pendingVersionStatus,
            scanStatus: row.pendingScanStatus,
            uploadedAt: nullableIso(row.pendingUploadedAt),
            scanCompletedAt: nullableIso(row.pendingScanCompletedAt),
          }
        : null,
  };
}

@Injectable()
export class CaseOperationsService {
  private readonly logger = new Logger(CaseOperationsService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  async getOperations(
    matterId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterOperationsView> {
    return this.runSafely('operations.read', () =>
      this.rls.run(this.rlsContext(context), (transaction) =>
        this.readOperations(transaction, matterId, context),
      ),
    );
  }

  async createTask(
    matterId: string,
    dto: CreateMatterTaskDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterTaskView> {
    this.assertReminderOrder(dto.reminderAt, dto.dueAt);

    return this.runSafely('task.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [created] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.matter_tasks (
            organisation_id, matter_id, title, description, priority,
            assigned_to_user_id, due_at, reminder_at,
            created_by_user_id, updated_by_user_id
          )
          VALUES (
            ${context.organisationId}::uuid, ${matterId}::uuid, ${dto.title},
            ${dto.description ?? null},
            ${dto.priority ?? 'NORMAL'}::public.case_task_priority,
            ${dto.assignedToUserId ?? null}::uuid,
            ${dto.dueAt ?? null}::timestamptz,
            ${dto.reminderAt ?? null}::timestamptz,
            ${context.userId}::uuid, ${context.userId}::uuid
          )
          RETURNING id
        `;

        if (!created)
          throw new NotFoundException('Matter task could not be created.');

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'TASK_CREATED',
          'TASK',
          created.id,
          'Matter task created.',
          { priority: dto.priority ?? 'NORMAL', dueAt: dto.dueAt ?? null },
        );
        await this.writeAudit(
          transaction,
          context,
          'task.created',
          'matter_task',
          created.id,
          null,
          {
            matterId,
            priority: dto.priority ?? 'NORMAL',
          },
        );

        return this.readTask(transaction, created.id);
      }),
    );
  }

  async updateTask(
    matterId: string,
    taskId: string,
    dto: UpdateMatterTaskDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterTaskView> {
    return this.runSafely('task.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'matter_tasks',
          taskId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (['COMPLETED', 'CANCELLED'].includes(current.status)) {
          throw new ConflictException(
            'Completed or cancelled tasks cannot be edited.',
          );
        }

        const currentTask = await this.readTask(transaction, taskId);
        this.assertReminderOrder(
          dto.reminderAt === undefined
            ? currentTask.reminderAt
            : dto.reminderAt,
          dto.dueAt === undefined ? currentTask.dueAt : dto.dueAt,
        );

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_tasks
          SET title = CASE WHEN ${dto.title !== undefined} THEN ${dto.title ?? ''} ELSE title END,
              description = CASE WHEN ${dto.description !== undefined} THEN ${dto.description ?? null} ELSE description END,
              priority = CASE WHEN ${dto.priority !== undefined}
                THEN ${dto.priority ?? null}::public.case_task_priority ELSE priority END,
              assigned_to_user_id = CASE WHEN ${dto.assignedToUserId !== undefined}
                THEN ${dto.assignedToUserId ?? null}::uuid ELSE assigned_to_user_id END,
              due_at = CASE WHEN ${dto.dueAt !== undefined}
                THEN ${dto.dueAt ?? null}::timestamptz ELSE due_at END,
              reminder_at = CASE WHEN ${dto.reminderAt !== undefined}
                THEN ${dto.reminderAt ?? null}::timestamptz ELSE reminder_at END,
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${taskId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'TASK_UPDATED',
          'TASK',
          taskId,
          'Matter task updated.',
          {
            version: dto.version + 1,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'task.updated',
          'matter_task',
          taskId,
          {
            version: dto.version,
          },
          { version: dto.version + 1 },
        );
        return this.readTask(transaction, taskId);
      }),
    );
  }

  async changeTaskStatus(
    matterId: string,
    taskId: string,
    dto: ChangeMatterTaskStatusDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterTaskView> {
    return this.runSafely('task.status', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'matter_tasks',
          taskId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        this.assertTaskTransition(current.status as CaseTaskStatus, dto.status);

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_tasks
          SET status = ${dto.status}::public.case_task_status,
              blocked_reason = CASE WHEN ${dto.status} = 'BLOCKED' THEN ${dto.blockedReason ?? null} ELSE NULL END,
              completion_note = CASE WHEN ${dto.status} = 'COMPLETED' THEN ${dto.completionNote ?? null} ELSE NULL END,
              completed_at = CASE WHEN ${dto.status} = 'COMPLETED' THEN pg_catalog.now() ELSE NULL END,
              completed_by_user_id = CASE WHEN ${dto.status} = 'COMPLETED' THEN ${context.userId}::uuid ELSE NULL END,
              cancelled_at = CASE WHEN ${dto.status} = 'CANCELLED' THEN pg_catalog.now() ELSE NULL END,
              cancelled_by_user_id = CASE WHEN ${dto.status} = 'CANCELLED' THEN ${context.userId}::uuid ELSE NULL END,
              cancellation_reason = CASE WHEN ${dto.status} = 'CANCELLED' THEN ${dto.reason ?? null} ELSE NULL END,
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${taskId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'TASK_STATUS_CHANGED',
          'TASK',
          taskId,
          `Task moved to ${dto.status}.`,
          {
            from: current.status,
            to: dto.status,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'task.status.changed',
          'matter_task',
          taskId,
          {
            status: current.status,
            version: dto.version,
          },
          { status: dto.status, version: dto.version + 1 },
        );
        return this.readTask(transaction, taskId);
      }),
    );
  }

  async createDeadline(
    matterId: string,
    dto: CreateMatterDeadlineDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterDeadlineView> {
    return this.runSafely('deadline.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [created] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.matter_deadlines (
            organisation_id, matter_id, title, description, deadline_type,
            due_at, timezone, is_critical, owner_user_id, source_reference,
            created_by_user_id, updated_by_user_id
          )
          VALUES (
            ${context.organisationId}::uuid, ${matterId}::uuid, ${dto.title},
            ${dto.description ?? null}, ${dto.deadlineType}::public.matter_deadline_type,
            ${dto.dueAt}::timestamptz, ${dto.timezone ?? 'Europe/London'},
            ${dto.isCritical ?? false}, ${dto.ownerUserId ?? null}::uuid,
            ${dto.sourceReference ?? null}, ${context.userId}::uuid, ${context.userId}::uuid
          )
          RETURNING id
        `;
        if (!created)
          throw new NotFoundException('Matter deadline could not be created.');

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DEADLINE_CREATED',
          'DEADLINE',
          created.id,
          'Matter deadline created.',
          {
            type: dto.deadlineType,
            dueAt: dto.dueAt,
            critical: dto.isCritical ?? false,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'deadline.created',
          'matter_deadline',
          created.id,
          null,
          {
            matterId,
            type: dto.deadlineType,
            critical: dto.isCritical ?? false,
          },
        );
        return this.readDeadline(transaction, created.id);
      }),
    );
  }

  async updateDeadline(
    matterId: string,
    deadlineId: string,
    dto: UpdateMatterDeadlineDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterDeadlineView> {
    return this.runSafely('deadline.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'matter_deadlines',
          deadlineId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (current.status !== 'OPEN') {
          throw new ConflictException('Resolved deadlines cannot be edited.');
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_deadlines
          SET title = CASE WHEN ${dto.title !== undefined} THEN ${dto.title ?? ''} ELSE title END,
              description = CASE WHEN ${dto.description !== undefined} THEN ${dto.description ?? null} ELSE description END,
              deadline_type = CASE WHEN ${dto.deadlineType !== undefined}
                THEN ${dto.deadlineType ?? null}::public.matter_deadline_type ELSE deadline_type END,
              due_at = CASE WHEN ${dto.dueAt !== undefined} THEN ${dto.dueAt ?? null}::timestamptz ELSE due_at END,
              timezone = CASE WHEN ${dto.timezone !== undefined} THEN ${dto.timezone ?? ''} ELSE timezone END,
              is_critical = CASE WHEN ${dto.isCritical !== undefined} THEN ${dto.isCritical ?? false} ELSE is_critical END,
              owner_user_id = CASE WHEN ${dto.ownerUserId !== undefined}
                THEN ${dto.ownerUserId ?? null}::uuid ELSE owner_user_id END,
              source_reference = CASE WHEN ${dto.sourceReference !== undefined}
                THEN ${dto.sourceReference ?? null} ELSE source_reference END,
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${deadlineId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND status = 'OPEN'
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DEADLINE_UPDATED',
          'DEADLINE',
          deadlineId,
          'Matter deadline updated.',
          {
            version: dto.version + 1,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'deadline.updated',
          'matter_deadline',
          deadlineId,
          {
            version: dto.version,
          },
          { version: dto.version + 1 },
        );
        return this.readDeadline(transaction, deadlineId);
      }),
    );
  }

  async changeDeadlineStatus(
    matterId: string,
    deadlineId: string,
    dto: ChangeMatterDeadlineStatusDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterDeadlineView> {
    return this.runSafely('deadline.status', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'matter_deadlines',
          deadlineId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (current.status !== 'OPEN' || dto.status === 'OPEN') {
          throw new ConflictException('Only open deadlines can be resolved.');
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_deadlines
          SET status = ${dto.status}::public.matter_deadline_status,
              satisfied_at = CASE WHEN ${dto.status} = 'SATISFIED' THEN pg_catalog.now() ELSE NULL END,
              satisfied_by_user_id = CASE WHEN ${dto.status} = 'SATISFIED' THEN ${context.userId}::uuid ELSE NULL END,
              satisfaction_note = CASE WHEN ${dto.status} = 'SATISFIED' THEN ${dto.reason ?? null} ELSE NULL END,
              missed_at = CASE WHEN ${dto.status} = 'MISSED' THEN pg_catalog.now() ELSE NULL END,
              missed_reason = CASE WHEN ${dto.status} = 'MISSED' THEN ${dto.reason ?? null} ELSE NULL END,
              cancelled_at = CASE WHEN ${dto.status} = 'CANCELLED' THEN pg_catalog.now() ELSE NULL END,
              cancelled_by_user_id = CASE WHEN ${dto.status} = 'CANCELLED' THEN ${context.userId}::uuid ELSE NULL END,
              cancellation_reason = CASE WHEN ${dto.status} = 'CANCELLED' THEN ${dto.reason ?? null} ELSE NULL END,
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${deadlineId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND status = 'OPEN'
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DEADLINE_STATUS_CHANGED',
          'DEADLINE',
          deadlineId,
          `Deadline moved to ${dto.status}.`,
          {
            from: current.status,
            to: dto.status,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'deadline.status.changed',
          'matter_deadline',
          deadlineId,
          {
            status: current.status,
            version: dto.version,
          },
          { status: dto.status, version: dto.version + 1 },
        );
        return this.readDeadline(transaction, deadlineId);
      }),
    );
  }

  async createDocumentRequest(
    matterId: string,
    dto: CreateDocumentRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<DocumentRequestView> {
    return this.runSafely('document-request.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [created] = await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.document_requests (
            organisation_id, matter_id, recipient_client_id, title, message,
            due_at, created_by_user_id, updated_by_user_id
          )
          VALUES (
            ${context.organisationId}::uuid, ${matterId}::uuid,
            ${dto.recipientClientId ?? null}::uuid, ${dto.title}, ${dto.message ?? null},
            ${dto.dueAt ?? null}::timestamptz, ${context.userId}::uuid, ${context.userId}::uuid
          )
          RETURNING id
        `;
        if (!created)
          throw new NotFoundException('Document request could not be created.');

        for (const item of dto.items) {
          await transaction.$executeRaw`
            INSERT INTO public.document_request_items (
              organisation_id, request_id, category, title, description, is_required
            )
            VALUES (
              ${context.organisationId}::uuid, ${created.id}::uuid,
              ${item.category}::public.document_category, ${item.title},
              ${item.description ?? null}, ${item.isRequired ?? true}
            )
          `;
        }

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_REQUEST_CREATED',
          'DOCUMENT_REQUEST',
          created.id,
          'Document request drafted.',
          {
            itemCount: dto.items.length,
            dueAt: dto.dueAt ?? null,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'document_request.created',
          'document_request',
          created.id,
          null,
          {
            matterId,
            itemCount: dto.items.length,
          },
        );
        return this.readDocumentRequest(transaction, created.id);
      }),
    );
  }

  async sendDocumentRequest(
    matterId: string,
    requestId: string,
    dto: SendDocumentRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<DocumentRequestView> {
    return this.runSafely('document-request.send', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'document_requests',
          requestId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (current.status !== 'DRAFT') {
          throw new ConflictException(
            'Only draft document requests can be issued.',
          );
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.document_requests
          SET status = 'SENT', sent_at = pg_catalog.now(),
              sent_by_user_id = ${context.userId}::uuid,
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${requestId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND status = 'DRAFT'
            AND version = ${dto.version}
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_REQUEST_SENT',
          'DOCUMENT_REQUEST',
          requestId,
          'Document request issued.',
          null,
        );
        await this.writeAudit(
          transaction,
          context,
          'document_request.sent',
          'document_request',
          requestId,
          {
            status: 'DRAFT',
            version: dto.version,
          },
          { status: 'SENT', version: dto.version + 1 },
        );
        return this.readDocumentRequest(transaction, requestId);
      }),
    );
  }

  async manageDocumentRequest(
    matterId: string,
    requestId: string,
    dto: ManageDocumentRequestDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<DocumentRequestView> {
    return this.runSafely('document-request.manage', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'document_requests',
          requestId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(current.status)) {
          throw new ConflictException(
            'This document request is already final.',
          );
        }
        if (dto.status === 'EXPIRED' && current.status === 'DRAFT') {
          throw new ConflictException('A draft request cannot be expired.');
        }
        if (dto.status === 'COMPLETED') {
          const [outstanding] = await transaction.$queryRaw<
            Array<{ count: bigint | number }>
          >`
            SELECT count(*) AS count
            FROM public.document_request_items
            WHERE organisation_id = ${context.organisationId}::uuid
              AND request_id = ${requestId}::uuid
              AND is_required = true
              AND status NOT IN ('RECEIVED', 'ACCEPTED', 'WAIVED')
          `;
          if (Number(outstanding?.count ?? 0) > 0) {
            throw new ConflictException(
              'Required document items remain outstanding.',
            );
          }
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.document_requests
          SET status = ${dto.status}::public.document_request_status,
              completed_at = CASE WHEN ${dto.status} = 'COMPLETED' THEN pg_catalog.now() ELSE NULL END,
              cancelled_at = CASE WHEN ${dto.status} = 'CANCELLED' THEN pg_catalog.now() ELSE NULL END,
              cancelled_by_user_id = CASE WHEN ${dto.status} = 'CANCELLED' THEN ${context.userId}::uuid ELSE NULL END,
              status_reason = ${dto.reason},
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${requestId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_REQUEST_STATUS_CHANGED',
          'DOCUMENT_REQUEST',
          requestId,
          `Document request moved to ${dto.status}.`,
          {
            from: current.status,
            to: dto.status,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'document_request.status.changed',
          'document_request',
          requestId,
          {
            status: current.status,
            version: dto.version,
          },
          { status: dto.status, version: dto.version + 1 },
        );
        return this.readDocumentRequest(transaction, requestId);
      }),
    );
  }

  async registerDocumentUpload(
    matterId: string,
    dto: RegisterDocumentUploadDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<DocumentUploadRegistrationView> {
    this.assertAllowedContentType(dto.contentType);

    return this.runSafely('document.upload.register', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [registration] = await transaction.$queryRaw<
          DocumentUploadRegistrationView[]
        >`
          WITH identifiers AS (
            SELECT pg_catalog.gen_random_uuid() AS document_id,
                   pg_catalog.gen_random_uuid() AS version_id
          ), inserted_document AS (
            INSERT INTO public.matter_documents (
              id, organisation_id, matter_id, request_item_id, title, category,
              security_classification, client_visible, retention_review_at,
              created_by_user_id, updated_by_user_id
            )
            SELECT
              identifiers.document_id, ${context.organisationId}::uuid,
              ${matterId}::uuid, ${dto.requestItemId ?? null}::uuid, ${dto.title},
              ${dto.category}::public.document_category,
              ${dto.securityClassification}::public.document_security_classification,
              ${dto.clientVisible ?? false}, ${dto.retentionReviewAt ?? null}::timestamptz,
              ${context.userId}::uuid, ${context.userId}::uuid
            FROM identifiers
            RETURNING id
          ), inserted_version AS (
            INSERT INTO public.matter_document_versions (
              id, organisation_id, matter_id, document_id, version_number,
              original_file_name, content_type, size_bytes, sha256_hex,
              storage_bucket, storage_path, uploaded_by_user_id
            )
            SELECT
              identifiers.version_id, ${context.organisationId}::uuid,
              ${matterId}::uuid, identifiers.document_id, 1,
              ${dto.originalFileName}, ${dto.contentType}, ${dto.sizeBytes}, ${dto.sha256Hex},
              'businessos-documents',
              ${context.organisationId}::text || '/' || ${matterId}::text || '/'
                || identifiers.document_id::text || '/' || identifiers.version_id::text || '/object',
              ${context.userId}::uuid
            FROM identifiers
            JOIN inserted_document ON inserted_document.id = identifiers.document_id
            RETURNING document_id, id, storage_bucket, storage_path, content_type, size_bytes
          )
          SELECT
            document_id AS "documentId", id AS "versionId",
            storage_bucket AS "storageBucket", storage_path AS "storagePath",
            content_type AS "expectedContentType",
            size_bytes::integer AS "expectedSizeBytes",
            'PENDING_UPLOAD'::text AS status
          FROM inserted_version
        `;
        if (!registration)
          throw new InternalServerErrorException('Upload registration failed.');

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_UPLOAD_REGISTERED',
          'DOCUMENT',
          registration.documentId,
          'Document upload registered in the private quarantine area.',
          {
            versionId: registration.versionId,
            classification: dto.securityClassification,
            sizeBytes: dto.sizeBytes,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'document.upload.registered',
          'matter_document',
          registration.documentId,
          null,
          {
            matterId,
            versionId: registration.versionId,
            contentType: dto.contentType,
            sizeBytes: dto.sizeBytes,
            sha256Hex: dto.sha256Hex,
          },
        );
        return registration;
      }),
    );
  }

  async registerDocumentVersion(
    matterId: string,
    documentId: string,
    dto: RegisterDocumentVersionDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<DocumentUploadRegistrationView> {
    this.assertAllowedContentType(dto.contentType);

    return this.runSafely('document.version.register', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [document] = await transaction.$queryRaw<
          Array<{ id: string; status: string }>
        >`
          SELECT id, status::text AS status
          FROM public.matter_documents
          WHERE id = ${documentId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        if (!document)
          throw new NotFoundException('Matter document not found.');
        if (document.status !== 'AVAILABLE') {
          throw new ConflictException(
            'A new version can only be added to an available document.',
          );
        }

        const [registration] = await transaction.$queryRaw<
          DocumentUploadRegistrationView[]
        >`
          WITH identifiers AS (
            SELECT pg_catalog.gen_random_uuid() AS version_id
          ), next_version AS (
            SELECT COALESCE(max(version_number), 0) + 1 AS value
            FROM public.matter_document_versions
            WHERE organisation_id = ${context.organisationId}::uuid
              AND document_id = ${documentId}::uuid
          ), inserted_version AS (
            INSERT INTO public.matter_document_versions (
              id, organisation_id, matter_id, document_id, version_number,
              original_file_name, content_type, size_bytes, sha256_hex,
              storage_bucket, storage_path, uploaded_by_user_id
            )
            SELECT
              identifiers.version_id, ${context.organisationId}::uuid,
              ${matterId}::uuid, ${documentId}::uuid, next_version.value,
              ${dto.originalFileName}, ${dto.contentType}, ${dto.sizeBytes}, ${dto.sha256Hex},
              'businessos-documents',
              ${context.organisationId}::text || '/' || ${matterId}::text || '/'
                || ${documentId}::text || '/' || identifiers.version_id::text || '/object',
              ${context.userId}::uuid
            FROM identifiers CROSS JOIN next_version
            RETURNING document_id, id, storage_bucket, storage_path, content_type, size_bytes
          )
          SELECT
            document_id AS "documentId", id AS "versionId",
            storage_bucket AS "storageBucket", storage_path AS "storagePath",
            content_type AS "expectedContentType",
            size_bytes::integer AS "expectedSizeBytes",
            'PENDING_UPLOAD'::text AS status
          FROM inserted_version
        `;
        if (!registration)
          throw new InternalServerErrorException(
            'Version registration failed.',
          );

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_VERSION_REGISTERED',
          'DOCUMENT',
          documentId,
          'New document version registered in quarantine.',
          {
            versionId: registration.versionId,
            sizeBytes: dto.sizeBytes,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'document.version.registered',
          'matter_document',
          documentId,
          null,
          {
            versionId: registration.versionId,
            contentType: dto.contentType,
            sizeBytes: dto.sizeBytes,
            sha256Hex: dto.sha256Hex,
          },
        );
        return registration;
      }),
    );
  }

  async finaliseDocumentUpload(
    matterId: string,
    documentId: string,
    versionId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<DocumentProcessingView> {
    return this.runSafely('document.upload.finalise', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [match] = await transaction.$queryRaw<Array<{ value: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM public.matter_document_versions
            WHERE id = ${versionId}::uuid
              AND document_id = ${documentId}::uuid
              AND matter_id = ${matterId}::uuid
              AND organisation_id = ${context.organisationId}::uuid
          ) AS value
        `;
        if (!match?.value)
          throw new NotFoundException('Registered document upload not found.');

        const [result] = await transaction.$queryRaw<
          Array<{
            documentId: string;
            versionId: string;
            documentStatus: DocumentProcessingView['documentStatus'];
            scanStatus: DocumentProcessingView['scanStatus'];
          }>
        >`
          SELECT
            document_id AS "documentId", version_id AS "versionId",
            document_status AS "documentStatus", scan_status AS "scanStatus"
          FROM private.finalise_matter_document_upload(
            ${documentId}::uuid, ${versionId}::uuid
          )
        `;
        if (!result)
          throw new NotFoundException('Registered document upload not found.');

        await this.writeAudit(
          transaction,
          context,
          'document.upload.finalised',
          'matter_document',
          documentId,
          null,
          {
            versionId,
            status: result.documentStatus,
            scanStatus: result.scanStatus,
          },
        );
        return result;
      }),
    );
  }

  async updateDocumentMetadata(
    matterId: string,
    documentId: string,
    dto: UpdateDocumentMetadataDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterDocumentView> {
    return this.runSafely('document.metadata.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'matter_documents',
          documentId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (current.status === 'ARCHIVED') {
          throw new ConflictException('Archived documents cannot be edited.');
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_documents
          SET title = CASE WHEN ${dto.title !== undefined} THEN ${dto.title ?? ''} ELSE title END,
              category = CASE WHEN ${dto.category !== undefined}
                THEN ${dto.category ?? null}::public.document_category ELSE category END,
              security_classification = CASE WHEN ${dto.securityClassification !== undefined}
                THEN ${dto.securityClassification ?? null}::public.document_security_classification
                ELSE security_classification END,
              client_visible = CASE WHEN ${dto.clientVisible !== undefined}
                THEN ${dto.clientVisible ?? false} ELSE client_visible END,
              retention_review_at = CASE WHEN ${dto.retentionReviewAt !== undefined}
                THEN ${dto.retentionReviewAt ?? null}::timestamptz ELSE retention_review_at END,
              updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${documentId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND status <> 'ARCHIVED'
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_METADATA_UPDATED',
          'DOCUMENT',
          documentId,
          'Document metadata and classification updated.',
          {
            version: dto.version + 1,
          },
        );
        await this.writeAudit(
          transaction,
          context,
          'document.metadata.updated',
          'matter_document',
          documentId,
          {
            version: dto.version,
          },
          { version: dto.version + 1 },
        );
        return this.readDocument(transaction, documentId);
      }),
    );
  }

  async archiveDocument(
    matterId: string,
    documentId: string,
    dto: ArchiveDocumentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterDocumentView> {
    return this.runSafely('document.archive', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const current = await this.lockVersionedRecord(
          transaction,
          'matter_documents',
          documentId,
          matterId,
        );
        this.assertVersion(current.version, dto.version);
        if (current.status !== 'AVAILABLE') {
          throw new ConflictException(
            'Only available documents can be archived.',
          );
        }

        const changed = await transaction.$executeRaw`
          UPDATE public.matter_documents
          SET status = 'ARCHIVED', archived_at = pg_catalog.now(),
              archive_reason = ${dto.reason}, updated_by_user_id = ${context.userId}::uuid,
              version = version + 1
          WHERE id = ${documentId}::uuid
            AND organisation_id = ${context.organisationId}::uuid
            AND matter_id = ${matterId}::uuid
            AND version = ${dto.version}
            AND status = 'AVAILABLE'
            AND deleted_at IS NULL
        `;
        this.assertSingleUpdate(changed);

        await this.writeTimeline(
          transaction,
          context,
          matterId,
          'DOCUMENT_ARCHIVED',
          'DOCUMENT',
          documentId,
          'Document archived under controlled retention.',
          null,
        );
        await this.writeAudit(
          transaction,
          context,
          'document.archived',
          'matter_document',
          documentId,
          {
            status: current.status,
            version: dto.version,
          },
          { status: 'ARCHIVED', version: dto.version + 1 },
        );
        return this.readDocument(transaction, documentId);
      }),
    );
  }

  private async readOperations(
    transaction: Transaction,
    matterId: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<MatterOperationsView> {
    const [matter] = await transaction.$queryRaw<MatterHeaderRow[]>`
      SELECT
        matter.id, matter.matter_number AS "matterNumber", matter.title,
        matter.service_type AS "serviceType", matter.status::text AS status,
        matter.priority::text AS priority, client.id AS "primaryClientId",
        client.display_name AS "primaryClientName"
      FROM public.matters AS matter
      JOIN public.matter_parties AS party
        ON party.matter_id = matter.id
       AND party.organisation_id = matter.organisation_id
       AND party.is_primary = true AND party.deleted_at IS NULL
      JOIN public.clients AS client
        ON client.id = party.client_id
       AND client.organisation_id = party.organisation_id
      WHERE matter.id = ${matterId}::uuid
        AND matter.organisation_id = ${context.organisationId}::uuid
        AND matter.deleted_at IS NULL
      LIMIT 1
    `;
    if (!matter)
      throw new NotFoundException('Matter not found or not authorised.');

    const [
      members,
      tasks,
      deadlines,
      requests,
      requestItems,
      documents,
      timeline,
    ] = await Promise.all([
      transaction.$queryRaw<Array<{ id: string; label: string }>>`
          SELECT profile.id,
            COALESCE(NULLIF(btrim(profile.display_name), ''),
              NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
              profile.email) AS label
          FROM public.organisation_memberships AS membership
          JOIN public.user_profiles AS profile ON profile.id = membership.user_profile_id
          WHERE membership.organisation_id = ${context.organisationId}::uuid
            AND membership.status = 'ACTIVE' AND membership.deleted_at IS NULL
            AND profile.status = 'ACTIVE' AND profile.deleted_at IS NULL
          ORDER BY label ASC
          LIMIT 500
        `,
      transaction.$queryRaw<TaskRow[]>`${this.taskSelect()}
          WHERE task.organisation_id = ${context.organisationId}::uuid
            AND task.matter_id = ${matterId}::uuid AND task.deleted_at IS NULL
          ORDER BY CASE task.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1
            WHEN 'BLOCKED' THEN 2 ELSE 3 END, task.due_at ASC NULLS LAST, task.created_at DESC
        `,
      transaction.$queryRaw<DeadlineRow[]>`${this.deadlineSelect()}
          WHERE deadline.organisation_id = ${context.organisationId}::uuid
            AND deadline.matter_id = ${matterId}::uuid AND deadline.deleted_at IS NULL
          ORDER BY CASE deadline.status WHEN 'OPEN' THEN 0 ELSE 1 END,
            deadline.is_critical DESC, deadline.due_at ASC
        `,
      transaction.$queryRaw<RequestRow[]>`${this.requestSelect()}
          WHERE request_record.organisation_id = ${context.organisationId}::uuid
            AND request_record.matter_id = ${matterId}::uuid
            AND request_record.deleted_at IS NULL
          ORDER BY request_record.created_at DESC
        `,
      transaction.$queryRaw<RequestItemRow[]>`
          SELECT item.request_id AS "requestId", item.id, item.category,
            item.title, item.description, item.is_required AS "isRequired",
            item.status, item.status_reason AS "statusReason"
          FROM public.document_request_items AS item
          JOIN public.document_requests AS request_record
            ON request_record.id = item.request_id
           AND request_record.organisation_id = item.organisation_id
          WHERE item.organisation_id = ${context.organisationId}::uuid
            AND request_record.matter_id = ${matterId}::uuid
            AND request_record.deleted_at IS NULL
          ORDER BY item.created_at ASC, item.id ASC
        `,
      transaction.$queryRaw<DocumentRow[]>`${this.documentSelect()}
          WHERE document_record.organisation_id = ${context.organisationId}::uuid
            AND document_record.matter_id = ${matterId}::uuid
            AND document_record.deleted_at IS NULL
          ORDER BY document_record.created_at DESC
        `,
      transaction.$queryRaw<TimelineRow[]>`
          SELECT event_record.id, event_record.event_type AS "eventType",
            event_record.source_type AS "sourceType", event_record.source_id AS "sourceId",
            event_record.summary, event_record.details,
            event_record.actor_type AS "actorType",
            event_record.actor_user_id AS "actorUserId",
            event_record.actor_identifier AS "actorIdentifier",
            COALESCE(NULLIF(btrim(actor.display_name), ''),
              NULLIF(btrim(concat_ws(' ', actor.first_name, actor.last_name)), ''),
              actor.email,
              event_record.actor_identifier,
              'System service') AS "actorName",
            event_record.occurred_at AS "occurredAt"
          FROM public.matter_timeline_events AS event_record
          LEFT JOIN public.user_profiles AS actor ON actor.id = event_record.actor_user_id
          WHERE event_record.organisation_id = ${context.organisationId}::uuid
            AND event_record.matter_id = ${matterId}::uuid
          ORDER BY event_record.occurred_at DESC, event_record.id DESC
          LIMIT 250
        `,
    ]);

    const itemsByRequest = new Map<string, DocumentRequestItemView[]>();
    for (const item of requestItems) {
      const values = itemsByRequest.get(item.requestId) ?? [];
      values.push({
        id: item.id,
        category: item.category,
        title: item.title,
        description: item.description,
        isRequired: item.isRequired,
        status: item.status,
        statusReason: item.statusReason,
      });
      itemsByRequest.set(item.requestId, values);
    }

    return {
      matter,
      members,
      tasks: tasks.map(taskView),
      deadlines: deadlines.map(deadlineView),
      documentRequests: requests.map((row) =>
        this.requestView(row, itemsByRequest.get(row.id) ?? []),
      ),
      documents: documents.map(documentView),
      timeline: timeline.map((row): MatterTimelineEventView => ({
        ...row,
        details: safeDetails(row.details),
        occurredAt: iso(row.occurredAt),
      })),
    };
  }

  private taskSelect(): Prisma.Sql {
    return Prisma.sql`
      SELECT task.id, task.title, task.description, task.status, task.priority,
        task.assigned_to_user_id AS "assignedToUserId",
        COALESCE(NULLIF(btrim(assignee.display_name), ''),
          NULLIF(btrim(concat_ws(' ', assignee.first_name, assignee.last_name)), ''),
          assignee.email) AS "assignedToName",
        task.due_at AS "dueAt", task.reminder_at AS "reminderAt",
        task.blocked_reason AS "blockedReason", task.completion_note AS "completionNote",
        task.completed_at AS "completedAt", task.cancellation_reason AS "cancellationReason",
        task.version, task.created_at AS "createdAt", task.updated_at AS "updatedAt"
      FROM public.matter_tasks AS task
      LEFT JOIN public.user_profiles AS assignee ON assignee.id = task.assigned_to_user_id
    `;
  }

  private deadlineSelect(): Prisma.Sql {
    return Prisma.sql`
      SELECT deadline.id, deadline.title, deadline.description,
        deadline.deadline_type AS "deadlineType", deadline.status,
        deadline.due_at AS "dueAt", deadline.timezone,
        deadline.is_critical AS "isCritical", deadline.owner_user_id AS "ownerUserId",
        COALESCE(NULLIF(btrim(owner_profile.display_name), ''),
          NULLIF(btrim(concat_ws(' ', owner_profile.first_name, owner_profile.last_name)), ''),
          owner_profile.email) AS "ownerName",
        deadline.source_reference AS "sourceReference",
        deadline.satisfaction_note AS "satisfactionNote",
        deadline.missed_reason AS "missedReason",
        deadline.cancellation_reason AS "cancellationReason",
        deadline.version, deadline.created_at AS "createdAt", deadline.updated_at AS "updatedAt"
      FROM public.matter_deadlines AS deadline
      LEFT JOIN public.user_profiles AS owner_profile ON owner_profile.id = deadline.owner_user_id
    `;
  }

  private requestSelect(): Prisma.Sql {
    return Prisma.sql`
      SELECT request_record.id, request_record.recipient_client_id AS "recipientClientId",
        client.display_name AS "recipientClientName", request_record.title,
        request_record.message, request_record.status, request_record.due_at AS "dueAt",
        request_record.sent_at AS "sentAt", request_record.completed_at AS "completedAt",
        request_record.status_reason AS "statusReason", request_record.version,
        request_record.created_at AS "createdAt", request_record.updated_at AS "updatedAt"
      FROM public.document_requests AS request_record
      LEFT JOIN public.clients AS client
        ON client.id = request_record.recipient_client_id
       AND client.organisation_id = request_record.organisation_id
    `;
  }

  private documentSelect(): Prisma.Sql {
    return Prisma.sql`
      SELECT document_record.id, document_record.request_item_id AS "requestItemId",
        document_record.title, document_record.category,
        document_record.security_classification AS "securityClassification",
        document_record.status, document_record.client_visible AS "clientVisible",
        document_record.retention_review_at AS "retentionReviewAt",
        document_record.version, document_record.created_at AS "createdAt",
        document_record.updated_at AS "updatedAt",
        current_version.id AS "currentVersionId",
        current_version.version_number AS "versionNumber",
        current_version.original_file_name AS "originalFileName",
        current_version.content_type AS "contentType",
        current_version.size_bytes AS "sizeBytes",
        current_version.sha256_hex AS "sha256Hex",
        current_version.storage_bucket AS "storageBucket",
        current_version.storage_path AS "storagePath",
        current_version.status AS "versionStatus",
        current_version.scan_status AS "scanStatus",
        current_version.uploaded_at AS "uploadedAt",
        current_version.scan_completed_at AS "scanCompletedAt",
        pending_version.id AS "pendingVersionId",
        pending_version.version_number AS "pendingVersionNumber",
        pending_version.original_file_name AS "pendingOriginalFileName",
        pending_version.content_type AS "pendingContentType",
        pending_version.size_bytes AS "pendingSizeBytes",
        pending_version.sha256_hex AS "pendingSha256Hex",
        pending_version.storage_bucket AS "pendingStorageBucket",
        pending_version.storage_path AS "pendingStoragePath",
        pending_version.status AS "pendingVersionStatus",
        pending_version.scan_status AS "pendingScanStatus",
        pending_version.uploaded_at AS "pendingUploadedAt",
        pending_version.scan_completed_at AS "pendingScanCompletedAt"
      FROM public.matter_documents AS document_record
      LEFT JOIN public.matter_document_versions AS current_version
       ON current_version.id = document_record.current_version_id
       AND current_version.organisation_id = document_record.organisation_id
      LEFT JOIN LATERAL (
        SELECT version_record.*
        FROM public.matter_document_versions AS version_record
        WHERE version_record.document_id = document_record.id
          AND version_record.organisation_id = document_record.organisation_id
          AND version_record.status IN ('PENDING_UPLOAD', 'PENDING_SCAN')
        ORDER BY version_record.version_number DESC
        LIMIT 1
      ) AS pending_version ON true
    `;
  }

  private async readTask(
    transaction: Transaction,
    taskId: string,
  ): Promise<MatterTaskView> {
    const [row] = await transaction.$queryRaw<TaskRow[]>`${this.taskSelect()}
      WHERE task.id = ${taskId}::uuid AND task.deleted_at IS NULL
    `;
    if (!row) throw new NotFoundException('Matter task not found.');
    return taskView(row);
  }

  private async readDeadline(
    transaction: Transaction,
    deadlineId: string,
  ): Promise<MatterDeadlineView> {
    const [row] = await transaction.$queryRaw<
      DeadlineRow[]
    >`${this.deadlineSelect()}
      WHERE deadline.id = ${deadlineId}::uuid AND deadline.deleted_at IS NULL
    `;
    if (!row) throw new NotFoundException('Matter deadline not found.');
    return deadlineView(row);
  }

  private async readDocumentRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<DocumentRequestView> {
    const [row] = await transaction.$queryRaw<
      RequestRow[]
    >`${this.requestSelect()}
      WHERE request_record.id = ${requestId}::uuid AND request_record.deleted_at IS NULL
    `;
    if (!row) throw new NotFoundException('Document request not found.');
    const items = await transaction.$queryRaw<RequestItemRow[]>`
      SELECT request_id AS "requestId", id, category, title, description,
        is_required AS "isRequired", status, status_reason AS "statusReason"
      FROM public.document_request_items
      WHERE request_id = ${requestId}::uuid
      ORDER BY created_at ASC, id ASC
    `;
    return this.requestView(row, items);
  }

  private requestView(
    row: RequestRow,
    items: DocumentRequestItemView[],
  ): DocumentRequestView {
    return {
      ...row,
      dueAt: nullableIso(row.dueAt),
      sentAt: nullableIso(row.sentAt),
      completedAt: nullableIso(row.completedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      items,
    };
  }

  private async readDocument(
    transaction: Transaction,
    documentId: string,
  ): Promise<MatterDocumentView> {
    const [row] = await transaction.$queryRaw<
      DocumentRow[]
    >`${this.documentSelect()}
      WHERE document_record.id = ${documentId}::uuid AND document_record.deleted_at IS NULL
    `;
    if (!row) throw new NotFoundException('Matter document not found.');
    return documentView(row);
  }

  private async lockVersionedRecord(
    transaction: Transaction,
    table:
      | 'matter_tasks'
      | 'matter_deadlines'
      | 'document_requests'
      | 'matter_documents',
    id: string,
    matterId: string,
  ): Promise<VersionStateRow> {
    const tableSql = Prisma.raw(`public.${table}`);
    const [row] = await transaction.$queryRaw<VersionStateRow[]>(Prisma.sql`
      SELECT id, status::text AS status, version
      FROM ${tableSql}
      WHERE id = ${id}::uuid
        AND matter_id = ${matterId}::uuid
        AND deleted_at IS NULL
      FOR UPDATE
    `);
    if (!row) throw new NotFoundException('Case-operation record not found.');
    return row;
  }

  private async writeTimeline(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    matterId: string,
    eventType: string,
    sourceType: string,
    sourceId: string,
    summary: string,
    details: Record<string, unknown> | null,
  ): Promise<void> {
    const detailsJson = details === null ? null : JSON.stringify(details);
    await transaction.$executeRaw`
      INSERT INTO public.matter_timeline_events (
        organisation_id, matter_id, event_type, source_type, source_id,
        summary, details, actor_user_id
      )
      VALUES (
        ${context.organisationId}::uuid, ${matterId}::uuid, ${eventType},
        ${sourceType}, ${sourceId}::uuid, ${summary}, ${detailsJson}::jsonb,
        ${context.userId}::uuid
      )
    `;
  }

  private async writeAudit(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    action: string,
    resourceType: string,
    resourceId: string,
    previousValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    const previousJson =
      previousValue === null ? null : JSON.stringify(previousValue);
    const newJson = newValue === null ? null : JSON.stringify(newValue);
    await transaction.$executeRaw`
      INSERT INTO public.audit_events (
        id, organisation_id, actor_type, actor_user_profile_id,
        source, action, resource_type, resource_id,
        outcome, previous_value, new_value
      )
      VALUES (
        pg_catalog.gen_random_uuid(), ${context.organisationId}::uuid,
        'USER'::public.audit_actor_type, ${context.userId}::uuid,
        'businessos-api', ${action}, ${resourceType}, ${resourceId},
        'SUCCESS'::public.audit_outcome, ${previousJson}::jsonb, ${newJson}::jsonb
      )
    `;
  }

  private assertTaskTransition(from: CaseTaskStatus, to: CaseTaskStatus): void {
    if (from === to) throw new ConflictException(`The task is already ${to}.`);
    if (!TASK_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Task status cannot move from ${from} to ${to}.`,
      );
    }
  }

  private assertReminderOrder(
    reminderAt?: string | null,
    dueAt?: string | null,
  ): void {
    if (reminderAt && dueAt && new Date(reminderAt) > new Date(dueAt)) {
      throw new BadRequestException(
        'Task reminder must be at or before its due time.',
      );
    }
  }

  private assertAllowedContentType(contentType: string): void {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        'This document file type is not permitted.',
      );
    }
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictException(
        'This record changed. Refresh before saving.',
      );
    }
  }

  private assertSingleUpdate(count: number): void {
    if (count !== 1) {
      throw new ConflictException(
        'The record changed while saving. Refresh and retry.',
      );
    }
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private async runSafely<T>(
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = databaseCode(error);

      if (code === '42501') {
        throw new ForbiddenException(
          'This operation is not permitted, or MFA is required.',
        );
      }
      if (code === '23505' || code === 'P2002') {
        throw new ConflictException(
          'A protected case-operation record already exists.',
        );
      }
      if (code === '40001' || code === 'P2034') {
        throw new ConflictException(
          'The record changed during this operation. Refresh and retry.',
        );
      }
      if (code === 'P0002' || code === 'P2025') {
        throw new NotFoundException('Case-operation record not found.');
      }
      if (
        code === '23503' ||
        code === '23514' ||
        code === 'P2003' ||
        code === 'P2004'
      ) {
        throw new BadRequestException(
          'The operation conflicts with an access, file-integrity or lifecycle control.',
        );
      }

      this.logger.error(
        `Case-operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${
          error instanceof Error ? error.name : typeof error
        }`,
      );
      throw new InternalServerErrorException(
        'The case operation could not be completed.',
      );
    }
  }
}
