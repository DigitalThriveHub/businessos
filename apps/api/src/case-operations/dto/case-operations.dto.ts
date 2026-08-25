import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  CASE_TASK_PRIORITIES,
  CASE_TASK_STATUSES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_SECURITY_CLASSIFICATIONS,
  MANAGED_DOCUMENT_REQUEST_STATUSES,
  MATTER_DEADLINE_STATUSES,
  MATTER_DEADLINE_TYPES,
  type CaseTaskPriority,
  type CaseTaskStatus,
  type DocumentCategory,
  type DocumentSecurityClassification,
  type ManagedDocumentRequestStatus,
  type MatterDeadlineStatus,
  type MatterDeadlineType,
} from '../case-operations.types';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMEZONE_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/;
const CONTENT_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+\-]*\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function nullableText({ value }: TransformFnParams): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const normalised = value.trim();
  return normalised || null;
}

function nullableUuid({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

function lower({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class UpdateVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreateMatterTaskDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  description?: string | null;

  @IsIn(CASE_TASK_PRIORITIES)
  @IsOptional()
  priority?: CaseTaskPriority;

  @Transform(nullableUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  dueAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  reminderAt?: string | null;
}

export class UpdateMatterTaskDto extends UpdateVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @IsOptional()
  title?: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  description?: string | null;

  @IsIn(CASE_TASK_PRIORITIES)
  @IsOptional()
  priority?: CaseTaskPriority;

  @Transform(nullableUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  dueAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  reminderAt?: string | null;
}

export class ChangeMatterTaskStatusDto extends UpdateVersionDto {
  @IsIn(CASE_TASK_STATUSES)
  status!: CaseTaskStatus;

  @Transform(nullableText)
  @IsString()
  @MaxLength(1000)
  @ValidateIf((value: ChangeMatterTaskStatusDto) => value.status === 'BLOCKED')
  blockedReason?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(2000)
  @ValidateIf(
    (value: ChangeMatterTaskStatusDto) => value.status === 'COMPLETED',
  )
  completionNote?: string | null;

  @Transform(nullableText)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @ValidateIf(
    (value: ChangeMatterTaskStatusDto) => value.status === 'CANCELLED',
  )
  reason?: string | null;
}

export class CreateMatterDeadlineDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  description?: string | null;

  @IsIn(MATTER_DEADLINE_TYPES)
  deadlineType!: MatterDeadlineType;

  @IsISO8601({ strict: true, strictSeparator: true })
  dueAt!: string;

  @Transform(trim)
  @Matches(TIMEZONE_PATTERN)
  @MaxLength(64)
  @IsOptional()
  timezone?: string;

  @IsBoolean()
  @IsOptional()
  isCritical?: boolean;

  @Transform(nullableUuid)
  @IsUUID('4')
  @IsOptional()
  ownerUserId?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  sourceReference?: string | null;
}

export class UpdateMatterDeadlineDto extends UpdateVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @IsOptional()
  title?: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  description?: string | null;

  @IsIn(MATTER_DEADLINE_TYPES)
  @IsOptional()
  deadlineType?: MatterDeadlineType;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  dueAt?: string;

  @Transform(trim)
  @Matches(TIMEZONE_PATTERN)
  @MaxLength(64)
  @IsOptional()
  timezone?: string;

  @IsBoolean()
  @IsOptional()
  isCritical?: boolean;

  @Transform(nullableUuid)
  @IsUUID('4')
  @IsOptional()
  ownerUserId?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  sourceReference?: string | null;
}

export class ChangeMatterDeadlineStatusDto extends UpdateVersionDto {
  @IsIn(MATTER_DEADLINE_STATUSES)
  status!: MatterDeadlineStatus;

  @Transform(nullableText)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @ValidateIf((value: ChangeMatterDeadlineStatusDto) =>
    ['SATISFIED', 'MISSED', 'CANCELLED'].includes(value.status),
  )
  reason?: string | null;
}

export class DocumentRequestItemDto {
  @IsIn(DOCUMENT_CATEGORIES)
  category!: DocumentCategory;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string | null;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;
}

export class CreateDocumentRequestDto {
  @Transform(nullableUuid)
  @IsUUID('4')
  @IsOptional()
  recipientClientId?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  message?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  dueAt?: string | null;

  @ValidateNested({ each: true })
  @Type(() => DocumentRequestItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  items!: DocumentRequestItemDto[];
}

export class SendDocumentRequestDto extends UpdateVersionDto {}

export class ManageDocumentRequestDto extends UpdateVersionDto {
  @IsIn(MANAGED_DOCUMENT_REQUEST_STATUSES)
  status!: ManagedDocumentRequestStatus;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class RegisterDocumentUploadDto {
  @Transform(nullableUuid)
  @IsUUID('4')
  @IsOptional()
  requestItemId?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @IsIn(DOCUMENT_CATEGORIES)
  category!: DocumentCategory;

  @IsIn(DOCUMENT_SECURITY_CLASSIFICATIONS)
  securityClassification!: DocumentSecurityClassification;

  @IsBoolean()
  @IsOptional()
  clientVisible?: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  retentionReviewAt?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[^\\/\u0000-\u001f\u007f]+$/)
  originalFileName!: string;

  @Transform(lower)
  @Matches(CONTENT_TYPE_PATTERN)
  @MaxLength(160)
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52_428_800)
  sizeBytes!: number;

  @Transform(lower)
  @Matches(SHA256_PATTERN)
  sha256Hex!: string;
}

export class RegisterDocumentVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[^\\/\u0000-\u001f\u007f]+$/)
  originalFileName!: string;

  @Transform(lower)
  @Matches(CONTENT_TYPE_PATTERN)
  @MaxLength(160)
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52_428_800)
  sizeBytes!: number;

  @Transform(lower)
  @Matches(SHA256_PATTERN)
  sha256Hex!: string;
}

export class UpdateDocumentMetadataDto extends UpdateVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @IsOptional()
  title?: string;

  @IsIn(DOCUMENT_CATEGORIES)
  @IsOptional()
  category?: DocumentCategory;

  @IsIn(DOCUMENT_SECURITY_CLASSIFICATIONS)
  @IsOptional()
  securityClassification?: DocumentSecurityClassification;

  @IsBoolean()
  @IsOptional()
  clientVisible?: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  retentionReviewAt?: string | null;
}

export class ArchiveDocumentDto extends UpdateVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
