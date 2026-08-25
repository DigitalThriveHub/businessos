import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
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

import {
  ASSURANCE_EVIDENCE_STATUSES,
  BREACH_NOTIFICATION_DECISIONS,
  DATA_SUBJECT_REQUEST_STATUSES,
  DATA_SUBJECT_REQUEST_TYPES,
  IDENTITY_PROOF_STATUSES,
  PRIVACY_INCIDENT_SEVERITIES,
  PRIVACY_INCIDENT_STATUSES,
  RELEASE_DECISION_STATUSES,
  RETENTION_ACTIONS,
  RETENTION_REVIEW_STATUSES,
  type AssuranceEvidenceStatus,
  type BreachNotificationDecision,
  type DataSubjectRequestStatus,
  type DataSubjectRequestType,
  type IdentityProofStatus,
  type PrivacyIncidentSeverity,
  type PrivacyIncidentStatus,
  type ReleaseDecisionStatus,
  type RetentionAction,
  type RetentionReviewStatus,
} from '../compliance-assurance.types';

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function emptyToNull({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null) return value;
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

export class CreateDataSubjectRequestDto {
  @IsIn(DATA_SUBJECT_REQUEST_TYPES)
  requestType!: DataSubjectRequestType;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  subjectName!: string;

  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(320)
  @IsOptional()
  subjectEmail?: string | null;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(50)
  @IsOptional()
  subjectPhone?: string | null;

  @Transform(emptyToNull)
  @IsUUID('4')
  @IsOptional()
  clientId?: string | null;

  @Transform(emptyToNull)
  @IsISO8601({ strict: true })
  @IsOptional()
  receivedAt?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  requestDetails!: string;

  @Transform(emptyToNull)
  @IsUUID('4')
  @IsOptional()
  ownerUserId?: string | null;
}

export class TransitionDataSubjectRequestDto {
  @IsIn(DATA_SUBJECT_REQUEST_STATUSES)
  status!: DataSubjectRequestStatus;

  @IsIn(IDENTITY_PROOF_STATUSES)
  @IsOptional()
  identityStatus?: IdentityProofStatus;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  note!: string;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  evidenceReference?: string | null;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  responseReference?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ExtendDataSubjectRequestDto {
  @IsISO8601({ strict: true })
  extendedDueAt!: string;

  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  reason!: string;

  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  notificationReference!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreatePrivacyIncidentDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(8000)
  description!: string;

  @IsIn(PRIVACY_INCIDENT_SEVERITIES)
  severity!: PrivacyIncidentSeverity;

  @IsBoolean()
  personalDataBreach!: boolean;

  @IsISO8601({ strict: true })
  discoveredAt!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  dataCategories!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  approximatePeopleAffected!: number;

  @Transform(emptyToNull)
  @IsUUID('4')
  @IsOptional()
  ownerUserId?: string | null;
}

export class UpdatePrivacyIncidentDto {
  @IsIn(PRIVACY_INCIDENT_STATUSES)
  status!: PrivacyIncidentStatus;

  @IsIn(PRIVACY_INCIDENT_SEVERITIES)
  severity!: PrivacyIncidentSeverity;

  @IsBoolean()
  personalDataBreach!: boolean;

  @IsIn(BREACH_NOTIFICATION_DECISIONS)
  notificationDecision!: BreachNotificationDecision;

  @Transform(emptyToNull)
  @IsISO8601({ strict: true })
  @IsOptional()
  containedAt?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(8000)
  riskAssessment!: string;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(4000)
  @IsOptional()
  resolution?: string | null;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  icoReference?: string | null;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  subjectNotificationEvidence?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  eventNote!: string;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  evidenceReference?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateLegalHoldDto {
  @IsIn(['ORGANISATION', 'CLIENT', 'MATTER', 'DOCUMENT'])
  scopeType!: 'ORGANISATION' | 'CLIENT' | 'MATTER' | 'DOCUMENT';

  @Transform(emptyToNull)
  @IsUUID('4')
  @ValidateIf((value: CreateLegalHoldDto) => value.scopeType !== 'ORGANISATION')
  scopeId?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  reason!: string;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @Transform(emptyToNull)
  @IsISO8601({ strict: true })
  @IsOptional()
  expiresAt?: string | null;
}

export class ReleaseLegalHoldDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  releaseReason!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UpsertRetentionPolicyDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  @MaxLength(120)
  policyKey!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(120)
  resourceType!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  triggerEvent!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36_500)
  retentionDays!: number;

  @IsIn(RETENTION_ACTIONS)
  action!: RetentionAction;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  lawfulReason!: string;

  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  expectedVersion?: number;
}

export class CreateRetentionReviewDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(120)
  resourceType!: string;

  @IsUUID('4')
  resourceId!: string;

  @IsUUID('4')
  policyId!: string;

  @IsISO8601({ strict: true })
  dueAt!: string;

  @Transform(emptyToNull)
  @IsUUID('4')
  @IsOptional()
  ownerUserId?: string | null;
}

export class DecideRetentionReviewDto {
  @IsIn(RETENTION_REVIEW_STATUSES)
  status!: RetentionReviewStatus;

  @IsIn(RETENTION_ACTIONS)
  decision!: RetentionAction;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  notes!: string;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  completionEvidenceReference?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RecordAssuranceEvidenceDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  @MaxLength(120)
  evidenceKey!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  title!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  @MaxLength(80)
  category!: string;

  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  evidenceReference!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  evidenceSha256!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  assessorName!: string;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  assessorOrganisation?: string | null;

  @IsObject()
  scope!: Record<string, unknown>;

  @IsISO8601({ strict: true })
  testedAt!: string;

  @IsISO8601({ strict: true })
  expiresAt!: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  notes!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  expectedVersion?: number;
}

export class ReviewAssuranceEvidenceDto {
  @IsIn(
    ASSURANCE_EVIDENCE_STATUSES.filter((status) =>
      ['PASS', 'FAIL', 'BLOCKED'].includes(status),
    ),
  )
  status!: AssuranceEvidenceStatus;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  reviewNote!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class DecideProductionReleaseDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{6,127}$/)
  releaseReference!: string;

  @IsIn(['PRODUCTION', 'STAGING'])
  environment!: 'PRODUCTION' | 'STAGING';

  @IsIn(RELEASE_DECISION_STATUSES)
  decision!: ReleaseDecisionStatus;

  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  rationale!: string;

  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  changeReference?: string | null;
}
