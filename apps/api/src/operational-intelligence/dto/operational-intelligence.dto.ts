import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_REVIEW_DECISIONS,
  type DocumentCategory,
  type DocumentReviewDecision,
} from '../operational-intelligence.types';

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function nullableDate({ value }: TransformFnParams): unknown {
  if (value === null || value === undefined) return value;
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

export class ReviewDocumentIntelligenceDto {
  @IsIn(DOCUMENT_REVIEW_DECISIONS)
  decision!: DocumentReviewDecision;

  @IsIn(DOCUMENT_CATEGORIES)
  confirmedCategory!: DocumentCategory;

  @Transform(nullableDate)
  @IsISO8601({ strict: true })
  @IsOptional()
  confirmedExpiryDate?: string | null;

  @IsObject()
  corrections!: Record<string, unknown>;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  notes!: string;

  @IsBoolean()
  createFollowUpTask!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UpdateOperationalValueBenchmarkDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  estimatedManualMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  estimatedAutomatedMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  hourlyCostMinor!: number;

  @IsBoolean()
  isActive!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
