import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
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
  AgentAuthorityLevel,
  KpiDirection,
  KpiFrequency,
  KpiValueType,
  PermissionDataScope,
} from '../../generated/prisma/enums';

const CONFIGURATION_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DECIMAL_PATTERN = /^-?\d{1,14}(?:\.\d{1,4})?$/;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function lowerCaseKey({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function upperCaseCode({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalised = value.trim().toUpperCase();

  return normalised || null;
}

function optionalText({ value }: TransformFnParams): unknown {
  if (value === null || value === undefined) {
    return null;
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

function optionalDecimal({ value }: TransformFnParams): unknown {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return typeof value === 'string' ? value.trim() : value;
}

export class CreateDepartmentDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(upperCaseCode)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/)
  code?: string | null;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string | null;

  @Transform(optionalUuid)
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDepartmentDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(upperCaseCode)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/)
  code!: string | null;

  @Transform(optionalText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(4_000)
  description!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  parentId!: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;
}

export class CreateTeamDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(upperCaseCode)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/)
  code?: string | null;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string | null;

  @Transform(optionalUuid)
  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTeamDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(upperCaseCode)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/)
  code!: string | null;

  @Transform(optionalText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(4_000)
  description!: string | null;

  @Transform(optionalUuid)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID('4')
  departmentId!: string | null;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;
}

export class CreateKpiDefinitionDto {
  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(CONFIGURATION_KEY_PATTERN)
  key!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @Transform(optionalUuid)
  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsEnum(KpiValueType)
  valueType!: KpiValueType;

  @IsEnum(KpiDirection)
  direction!: KpiDirection;

  @IsEnum(KpiFrequency)
  frequency!: KpiFrequency;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unitLabel?: string | null;

  @Transform(upperCaseCode)
  @ValidateIf(
    (dto: CreateKpiDefinitionDto) => dto.valueType === KpiValueType.CURRENCY,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  measurementSource!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateKpiDefinitionDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @IsEnum(KpiValueType)
  valueType!: KpiValueType;

  @IsEnum(KpiDirection)
  direction!: KpiDirection;

  @IsEnum(KpiFrequency)
  frequency!: KpiFrequency;

  @Transform(optionalText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(40)
  unitLabel!: string | null;

  @Transform(upperCaseCode)
  @ValidateIf(
    (dto: UpdateKpiDefinitionDto) => dto.valueType === KpiValueType.CURRENCY,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  measurementSource!: string;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;
}

export class CreateJobProfileDto {
  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(CONFIGURATION_KEY_PATTERN)
  key!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string | null;

  @Transform(optionalText)
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  purpose?: string | null;

  @Transform(optionalUuid)
  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isManagerial?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateJobProfileDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(optionalText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(4_000)
  description!: string | null;

  @Transform(optionalText)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(4_000)
  purpose!: string | null;

  @IsDefined()
  @IsBoolean()
  isManagerial!: boolean;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateJobProfileDutyDto {
  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(CONFIGURATION_KEY_PATTERN)
  code!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32_767)
  position!: number;

  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresEvidence?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateJobProfileDutyDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32_767)
  position!: number;

  @IsDefined()
  @IsBoolean()
  isCritical!: boolean;

  @IsDefined()
  @IsBoolean()
  requiresEvidence!: boolean;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;
}

export class CreateJobProfileKpiDto {
  @IsUUID('4')
  kpiDefinitionId!: string;

  @Transform(optionalDecimal)
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  targetValue?: string | null;

  @Transform(optionalDecimal)
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  minimumValue?: string | null;

  @Transform(optionalDecimal)
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  maximumValue?: string | null;

  @Type(() => Number)
  @Min(0)
  @Max(100)
  weightPercent!: number;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  endsAt?: string | null;
}

export class UpdateJobProfileKpiDto {
  @Transform(optionalDecimal)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  targetValue!: string | null;

  @Transform(optionalDecimal)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  minimumValue!: string | null;

  @Transform(optionalDecimal)
  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @Matches(DECIMAL_PATTERN)
  maximumValue!: string | null;

  @Type(() => Number)
  @Min(0)
  @Max(100)
  weightPercent!: number;

  @ValidateIf((_dto: unknown, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true, strictSeparator: true })
  endsAt!: string | null;

  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;
}

export class CreateAgentProfileDto {
  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(CONFIGURATION_KEY_PATTERN)
  key!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  behaviourInstructions!: string;

  @Transform(optionalUuid)
  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsEnum(AgentAuthorityLevel)
  authorityCeiling!: AgentAuthorityLevel;

  @IsDefined()
  @IsBoolean()
  requiresHumanReview!: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAgentProfileDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  description!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  behaviourInstructions!: string;

  @IsEnum(AgentAuthorityLevel)
  authorityCeiling!: AgentAuthorityLevel;

  @IsDefined()
  @IsBoolean()
  requiresHumanReview!: boolean;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateAgentPolicyDto {
  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(CONFIGURATION_KEY_PATTERN)
  toolKey!: string;

  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  @Matches(CONFIGURATION_KEY_PATTERN)
  requiredPermissionKey!: string;

  @IsEnum(AgentAuthorityLevel)
  authorityLevel!: AgentAuthorityLevel;

  @IsEnum(PermissionDataScope)
  maximumDataScope!: PermissionDataScope;

  @IsDefined()
  @IsBoolean()
  requiresApproval!: boolean;

  @IsDefined()
  @IsBoolean()
  requiresMfa!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  maxActionsPerRun!: number;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAgentPolicyDto {
  @Transform(lowerCaseKey)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  @Matches(CONFIGURATION_KEY_PATTERN)
  requiredPermissionKey!: string;

  @IsEnum(AgentAuthorityLevel)
  authorityLevel!: AgentAuthorityLevel;

  @IsEnum(PermissionDataScope)
  maximumDataScope!: PermissionDataScope;

  @IsDefined()
  @IsBoolean()
  requiresApproval!: boolean;

  @IsDefined()
  @IsBoolean()
  requiresMfa!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  maxActionsPerRun!: number;

  @IsDefined()
  @IsObject()
  configuration!: Record<string, unknown>;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;

  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;
}
