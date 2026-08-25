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

const CHANNELS = ['PORTAL', 'EMAIL', 'WHATSAPP'] as const;
const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE'] as const;
const PORTAL_SCOPES = [
  'MATTER_PROGRESS',
  'DOCUMENTS',
  'MESSAGES',
  'NOTIFICATIONS',
  'BILLING',
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

  @IsUUID('4')
  @IsOptional()
  integrationConnectionId?: string;
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
  @IsString({ each: true })
  @Matches(/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|\+[1-9][0-9]{7,14})$/, {
    each: true,
  })
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

const LIVE_PROVIDERS = [
  'MICROSOFT_365',
  'GOOGLE_WORKSPACE',
  'WHATSAPP_BUSINESS',
] as const;

const PROVIDER_CAPABILITIES = ['EMAIL', 'WHATSAPP', 'CALENDAR'] as const;

export class ConfigureProviderConnectionDto {
  @IsUUID('4')
  @IsOptional()
  connectionId?: string;

  @IsIn(LIVE_PROVIDERS)
  provider!: (typeof LIVE_PROVIDERS)[number];

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/)
  secretReference!: string;

  @ValidateIf(
    (dto: ConfigureProviderConnectionDto) =>
      dto.provider !== 'WHATSAPP_BUSINESS',
  )
  @Transform(lower)
  @IsEmail()
  @MaxLength(320)
  mailboxAddress?: string;

  @ValidateIf(
    (dto: ConfigureProviderConnectionDto) =>
      dto.provider === 'WHATSAPP_BUSINESS',
  )
  @Transform(trim)
  @Matches(/^\+[1-9][0-9]{7,14}$/)
  phoneNumber?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(PROVIDER_CAPABILITIES, { each: true })
  capabilities!: (typeof PROVIDER_CAPABILITIES)[number][];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number = 0;
}

export class SetProviderConnectionStatusDto {
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateBusinessCalendarEventDto {
  @IsUUID('4')
  integrationConnectionId!: string;

  @IsUUID('4')
  @IsOptional()
  clientId?: string;

  @IsUUID('4')
  @IsOptional()
  matterId?: string;

  @IsUUID('4')
  @IsOptional()
  conversationId?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(4000)
  @IsOptional()
  description?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  startsAt!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  endsAt!: string;

  @Transform(trim)
  @Matches(/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/)
  @MaxLength(80)
  timezone: string = 'Europe/London';

  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  location?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsEmail({}, { each: true })
  @Transform(({ value }: TransformFnParams) =>
    Array.isArray(value)
      ? value.map((item) =>
          typeof item === 'string' ? item.trim().toLowerCase() : item,
        )
      : value,
  )
  attendeeAddresses!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10_080)
  @IsOptional()
  reminderMinutesBefore?: number;

  @Transform(trim)
  @Matches(IDEMPOTENCY_PATTERN)
  idempotencyKey!: string;
}

export class CancelBusinessCalendarEventDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RetryBusinessCalendarEventDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class SetBusinessCalendarOutcomeDto extends CancelBusinessCalendarEventDto {
  @IsIn(['COMPLETED', 'NO_SHOW'])
  status!: 'COMPLETED' | 'NO_SHOW';
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
  @ArrayMaxSize(5)
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
  @Matches(/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|\+[1-9][0-9]{7,14})$/)
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

export class ResolveCommunicationMatchDto {
  @IsIn(['MATCH', 'DISMISS'])
  action!: 'MATCH' | 'DISMISS';

  @IsUUID('4')
  @ValidateIf((value: ResolveCommunicationMatchDto) => value.action === 'MATCH')
  clientId?: string;

  @IsUUID('4')
  @IsOptional()
  matterId?: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
