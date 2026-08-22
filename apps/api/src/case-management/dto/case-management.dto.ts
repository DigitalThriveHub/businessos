import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
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

import {
  ADDITIONAL_MATTER_PARTY_ROLES,
  AML_CHECK_STATUSES,
  CLIENT_CARE_STATUSES,
  CLIENT_KINDS,
  CLIENT_RISK_RATINGS,
  CLIENT_STATUSES,
  COMMUNICATION_CHANNELS,
  CONFLICT_CHECK_STATUSES,
  IDENTITY_VERIFICATION_STATUSES,
  MATTER_PRIORITIES,
  MATTER_STATUSES,
  PROCESSING_LAWFUL_BASES,
  type AdditionalMatterPartyRole,
  type AmlCheckStatus,
  type ClientCareStatus,
  type ClientKind,
  type ClientRiskRating,
  type ClientStatus,
  type CommunicationChannel,
  type ConflictCheckStatus,
  type IdentityVerificationStatus,
  type MatterPriority,
  type MatterStatus,
  type ProcessingLawfulBasis,
} from '../case-management.types';

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const PHONE_PATTERN = /^\+?[0-9()\-.\s]{7,50}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function lowerEmail({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function upperCode({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalised = value.trim().toUpperCase();
  return normalised || null;
}

function nullableText({ value }: TransformFnParams): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalised = value.trim();
  return normalised || null;
}

function optionalUuid({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

function optionalBoolean({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return value;
}

export class ClientQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @Transform(trimString)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  @IsIn(CLIENT_STATUSES)
  @IsOptional()
  status?: ClientStatus;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string;
}

export class MatterQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @Transform(trimString)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  @IsIn(MATTER_STATUSES)
  @IsOptional()
  status?: MatterStatus;

  @IsIn(MATTER_PRIORITIES)
  @IsOptional()
  priority?: MatterPriority;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  clientId?: string;
}

export class CreateClientDto {
  @IsIn(CLIENT_KINDS)
  kind!: ClientKind;

  @Transform(nullableText)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  firstName?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  lastName?: string | null;

  @Transform(nullableText)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @IsOptional()
  organisationName?: string | null;

  @Transform(lowerEmail)
  @IsEmail()
  @MaxLength(320)
  @IsOptional()
  email?: string | null;

  @Transform(nullableText)
  @Matches(PHONE_PATTERN)
  @IsOptional()
  phone?: string | null;

  @Transform(nullableText)
  @Matches(DATE_PATTERN)
  @IsOptional()
  dateOfBirth?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  nationality?: string | null;

  @Transform(upperCode)
  @Matches(COUNTRY_CODE_PATTERN)
  @IsOptional()
  countryOfResidenceCode?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  addressLine1?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  addressLine2?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  city?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  region?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(30)
  @IsOptional()
  postalCode?: string | null;

  @Transform(upperCode)
  @Matches(COUNTRY_CODE_PATTERN)
  @IsOptional()
  addressCountryCode?: string | null;

  @Transform(trimString)
  @Matches(LANGUAGE_PATTERN)
  @IsOptional()
  preferredLanguage?: string;

  @IsIn(COMMUNICATION_CHANNELS)
  @IsOptional()
  preferredCommunication?: CommunicationChannel;

  @IsIn(PROCESSING_LAWFUL_BASES)
  processingLawfulBasis!: ProcessingLawfulBasis;

  @Transform(nullableText)
  @IsString()
  @MaxLength(40)
  @IsOptional()
  privacyNoticeVersion?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  privacyNoticeAcknowledgedAt?: string | null;

  @IsBoolean()
  @IsOptional()
  marketingConsent?: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  marketingConsentAt?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  marketingConsentSource?: string | null;

  @IsIn(CLIENT_RISK_RATINGS)
  @IsOptional()
  riskRating?: ClientRiskRating;

  @IsIn(IDENTITY_VERIFICATION_STATUSES)
  @IsOptional()
  identityVerificationStatus?: IdentityVerificationStatus;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  identityVerifiedAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  identityVerificationExpiresAt?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  retentionReviewAt?: string | null;
}

export class UpdateClientDto {
  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(100)
  lastName!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  organisationName!: string | null;

  @Transform(lowerEmail)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsEmail()
  @MaxLength(320)
  email!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @Matches(PHONE_PATTERN)
  phone!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @Matches(DATE_PATTERN)
  dateOfBirth!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(100)
  nationality!: string | null;

  @Transform(upperCode)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @Matches(COUNTRY_CODE_PATTERN)
  countryOfResidenceCode!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(240)
  addressLine1!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(240)
  addressLine2!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(120)
  city!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(120)
  region!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(30)
  postalCode!: string | null;

  @Transform(upperCode)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @Matches(COUNTRY_CODE_PATTERN)
  addressCountryCode!: string | null;

  @Transform(trimString)
  @Matches(LANGUAGE_PATTERN)
  preferredLanguage!: string;

  @IsIn(COMMUNICATION_CHANNELS)
  preferredCommunication!: CommunicationChannel;

  @IsIn(PROCESSING_LAWFUL_BASES)
  processingLawfulBasis!: ProcessingLawfulBasis;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(40)
  privacyNoticeVersion!: string | null;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  privacyNoticeAcknowledgedAt!: string | null;

  @IsDefined()
  @IsBoolean()
  marketingConsent!: boolean;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  marketingConsentAt!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(120)
  marketingConsentSource!: string | null;

  @IsIn(CLIENT_RISK_RATINGS)
  riskRating!: ClientRiskRating;

  @IsIn(IDENTITY_VERIFICATION_STATUSES)
  identityVerificationStatus!: IdentityVerificationStatus;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  identityVerifiedAt!: string | null;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  identityVerificationExpiresAt!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  assignedToUserId!: string | null;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  retentionReviewAt!: string | null;

  @IsIn(CLIENT_STATUSES.filter((status) => status !== 'ARCHIVED'))
  status!: Exclude<ClientStatus, 'ARCHIVED'>;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ArchiveClientDto {
  @Transform(trimString)
  @IsString()
  @MinLength(10)
  @MaxLength(1_000)
  reason!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateMatterDto {
  @IsUUID('4')
  primaryClientId!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  description?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  serviceType!: string;

  @Transform(upperCode)
  @Matches(COUNTRY_CODE_PATTERN)
  @IsOptional()
  jurisdictionCountryCode?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  externalReference?: string | null;

  @IsIn(MATTER_PRIORITIES)
  @IsOptional()
  priority?: MatterPriority;

  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  nextActionSummary?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  nextActionAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  criticalDeadlineAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  targetCompletionAt?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  departmentId?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  teamId?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  supervisorUserId?: string | null;
}

export class UpdateMatterDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title!: string;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(10_000)
  description!: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  serviceType!: string;

  @Transform(upperCode)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @Matches(COUNTRY_CODE_PATTERN)
  jurisdictionCountryCode!: string | null;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(120)
  externalReference!: string | null;

  @IsIn(MATTER_PRIORITIES)
  priority!: MatterPriority;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(500)
  nextActionSummary!: string | null;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  nextActionAt!: string | null;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  criticalDeadlineAt!: string | null;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  targetCompletionAt!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  departmentId!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  teamId!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  assignedToUserId!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  supervisorUserId!: string | null;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ChangeMatterStatusDto {
  @IsIn(MATTER_STATUSES)
  toStatus!: MatterStatus;

  @Transform(trimString)
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  reason!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  outcome?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UpdateMatterComplianceDto {
  @IsIn(CONFLICT_CHECK_STATUSES)
  conflictStatus!: ConflictCheckStatus;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(160)
  conflictReference!: string | null;

  @IsIn(AML_CHECK_STATUSES)
  amlStatus!: AmlCheckStatus;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(160)
  amlReference!: string | null;

  @IsIn(CLIENT_CARE_STATUSES)
  clientCareStatus!: ClientCareStatus;

  @IsIn(CLIENT_RISK_RATINGS)
  riskRating!: ClientRiskRating;

  @Transform(nullableText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(4_000)
  riskReason!: string | null;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class AddMatterPartyDto {
  @IsUUID('4')
  clientId!: string;

  @IsIn(ADDITIONAL_MATTER_PARTY_ROLES)
  role!: AdditionalMatterPartyRole;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  roleDescription?: string | null;
}

export class RemoveMatterPartyDto {
  @Transform(trimString)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ConvertEnquiryDto {
  @IsUUID('4')
  idempotencyKey!: string;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  existingClientId?: string | null;

  @IsIn(CLIENT_KINDS)
  @IsOptional()
  clientKind?: ClientKind;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  clientOrganisationName?: string | null;

  @IsIn(PROCESSING_LAWFUL_BASES)
  processingLawfulBasis!: ProcessingLawfulBasis;

  @Transform(nullableText)
  @IsString()
  @MaxLength(40)
  @IsOptional()
  privacyNoticeVersion?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  privacyNoticeAcknowledgedAt?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  clientAssignedToUserId?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  matterTitle!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(10_000)
  @IsOptional()
  matterDescription?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  serviceType!: string;

  @IsIn(MATTER_PRIORITIES)
  @IsOptional()
  priority?: MatterPriority;

  @Transform(upperCode)
  @Matches(COUNTRY_CODE_PATTERN)
  @IsOptional()
  jurisdictionCountryCode?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  departmentId?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  teamId?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  assignedToUserId?: string | null;

  @Transform(optionalUuid)
  @IsUUID('4')
  @IsOptional()
  supervisorUserId?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(500)
  @IsOptional()
  nextActionSummary?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  nextActionAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  criticalDeadlineAt?: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  @IsOptional()
  targetCompletionAt?: string | null;
}

export class CaseManagementOptionsQueryDto {
  @Transform(optionalBoolean)
  @IsBoolean()
  @IsOptional()
  includeArchivedClients?: boolean;
}
