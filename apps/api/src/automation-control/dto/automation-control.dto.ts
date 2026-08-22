import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';

const AUTOMATION_SUBJECT_TYPES = ['ENQUIRY', 'CLIENT', 'MATTER'] as const;
const APPROVAL_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const APPROVAL_DECISIONS = ['APPROVED', 'REJECTED'] as const;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CompleteWorkflowActionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completionNote?: string;
}

export class CreateApprovalRequestDto {
  @IsIn(AUTOMATION_SUBJECT_TYPES)
  subjectType!: 'ENQUIRY' | 'CLIENT' | 'MATTER';

  @IsUUID('4')
  subjectId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  summary!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  @MaxLength(160)
  actionKey!: string;

  @IsIn(APPROVAL_RISK_LEVELS)
  riskLevel!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsUUID('4')
  approverUserId!: string;

  @IsISO8601({ strict: true })
  expiresAt!: string;

  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @IsOptional()
  @IsObject()
  proposedPayload?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  workflowRunId?: string;

  @IsOptional()
  @IsUUID('4')
  workflowActionId?: string;
}

export class DecideApprovalRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(APPROVAL_DECISIONS)
  decision!: 'APPROVED' | 'REJECTED';

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class UpdateSlaPolicyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(2_592_000)
  targetSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_592_000)
  warningSeconds?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
