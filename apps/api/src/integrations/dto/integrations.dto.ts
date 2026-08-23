import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
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
