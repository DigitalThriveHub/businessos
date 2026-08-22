import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
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
} from 'class-validator';

// WhatsApp remains a database/provider extension point. It is deliberately
// unavailable at the HTTP boundary until an approved provider is configured.
const CHANNELS = ['PORTAL', 'EMAIL'] as const;
const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE'] as const;
const PORTAL_SCOPES = [
  'MATTER_PROGRESS',
  'DOCUMENTS',
  'MESSAGES',
  'NOTIFICATIONS',
] as const;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/;
const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function lower({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function nullableText({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') return value;
  return value.trim() || null;
}

export class CreateCommunicationConversationDto {
  @IsUUID('4')
  @IsOptional()
  matterId?: string;

  @IsUUID('4')
  @IsOptional()
  clientId?: string;

  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  subject!: string;

  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string;
}

export class SendCommunicationMessageDto {
  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  subject?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyText!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsEmail({}, { each: true })
  @Transform(({ value }: TransformFnParams) =>
    Array.isArray(value)
      ? value.map((item) =>
          typeof item === 'string' ? item.trim().toLowerCase() : item,
        )
      : value,
  )
  @IsOptional()
  recipientAddresses?: string[];

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  scheduledAt?: string;

  @Transform(trim)
  @Matches(IDEMPOTENCY_PATTERN)
  idempotencyKey!: string;
}

export class CreateCommunicationTemplateDto {
  @Transform(lower)
  @Matches(TEMPLATE_KEY_PATTERN)
  @MaxLength(120)
  key!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string | null;

  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  subjectTemplate?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyTemplate!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @Matches(TEMPLATE_KEY_PATTERN, { each: true })
  @IsOptional()
  allowedVariables?: string[];

  @IsIn(TEMPLATE_STATUSES)
  @IsOptional()
  status?: (typeof TEMPLATE_STATUSES)[number];
}

export class CreateClientPortalInvitationDto {
  @IsUUID('4')
  clientId!: string;

  @Transform(lower)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  matterIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(PORTAL_SCOPES, { each: true })
  @IsOptional()
  scopes?: (typeof PORTAL_SCOPES)[number][];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(336)
  @IsOptional()
  expiresInHours?: number;
}

export class RevokeClientPortalAccessDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class CancelCommunicationReminderDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class PublishClientPortalUpdateDto {
  @IsUUID('4')
  matterId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  summary!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  stageKey?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  progressPercent?: number;
}

export class ScheduleCommunicationReminderDto {
  @IsUUID('4')
  conversationId!: string;

  @Transform(nullableText)
  @IsEmail()
  @MaxLength(320)
  @ValidateIf(
    (value: ScheduleCommunicationReminderDto) => value.channel !== 'PORTAL',
  )
  recipientAddress?: string | null;

  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  subject?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyText!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  scheduledFor!: string;

  @Transform(trim)
  @Matches(IDEMPOTENCY_PATTERN)
  idempotencyKey!: string;
}
