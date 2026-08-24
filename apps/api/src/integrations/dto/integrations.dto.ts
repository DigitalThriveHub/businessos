import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
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

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function lower({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export enum IntegrationProviderInput {
  WORDPRESS = 'WORDPRESS',
  STRIPE = 'STRIPE',
  GENERIC = 'GENERIC',
}

export enum IntegrationConnectionStatusInput {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export class CreateIntegrationConnectionDto {
  @IsEnum(IntegrationProviderInput)
  provider!: IntegrationProviderInput;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @ValidateIf(
    (dto: CreateIntegrationConnectionDto) =>
      dto.provider === IntegrationProviderInput.STRIPE,
  )
  @Transform(trim)
  @Matches(/^acct_[A-Za-z0-9]{8,}$/)
  externalAccountReference?: string;
}

export class SetIntegrationConnectionStatusDto {
  @IsEnum(IntegrationConnectionStatusInput)
  status!: IntegrationConnectionStatusInput;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RotateIntegrationSecretDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ExternalEnquiryIntakeDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Transform(lower)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  serviceType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10_000)
  message?: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  @IsIn(['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST'])
  lawfulBasis!:
    'CONSENT' | 'CONTRACT' | 'LEGAL_OBLIGATION' | 'LEGITIMATE_INTEREST';

  @IsBoolean()
  @Equals(true)
  privacyNoticeAcknowledged!: true;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  privacyNoticeVersion!: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @ValidateIf((dto: ExternalEnquiryIntakeDto) => dto.marketingConsent === true)
  @IsISO8601({ strict: true })
  marketingConsentCapturedAt?: string;
}

export class IntegrationConnectionIdDto {
  @IsUUID('4')
  connectionId!: string;
}

export class IntegrationEventLimitDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 100;
}

export class CreateIntakeFormDto {
  @IsUUID('4')
  connectionId!: string;

  @Transform(lower)
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  @MaxLength(120)
  key!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsObject()
  formSchema!: Record<string, unknown>;

  @Transform(trim)
  @IsString()
  @Matches(/^https:\/\//)
  @MaxLength(2048)
  privacyNoticeUrl!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  privacyNoticeVersion!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  allowedOrigins!: string[];
}

export class SetIntakeFormStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'DISABLED'])
  status!: 'DRAFT' | 'ACTIVE' | 'DISABLED';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class PublicIntakeSubmissionDto extends ExternalEnquiryIntakeDto {
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/)
  submissionId!: string;

  @IsISO8601({ strict: true })
  formStartedAt!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  companyWebsite?: string;
}

export class ExternalCommunicationIntakeDto {
  @IsIn(['EMAIL', 'WHATSAPP'])
  channel!: 'EMAIL' | 'WHATSAPP';

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  providerMessageId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(240)
  providerThreadId?: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  sender!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  recipients!: string[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  subject?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  body!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;
}
