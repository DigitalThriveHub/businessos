import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const TOKEN_PATTERN = /^bop_v1_[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function lower({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class AcceptClientPortalInvitationDto {
  @Transform(trim)
  @Matches(TOKEN_PATTERN)
  token!: string;
}

export class PostClientPortalMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  bodyText!: string;

  @Transform(trim)
  @Matches(IDEMPOTENCY_PATTERN)
  idempotencyKey!: string;
}

export class RegisterClientPortalDocumentDto {
  @IsUUID('4')
  requestItemId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[^\\/]+$/)
  originalFileName!: string;

  @Transform(lower)
  @IsIn(CONTENT_TYPES)
  contentType!: (typeof CONTENT_TYPES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52_428_800)
  sizeBytes!: number;

  @Transform(lower)
  @Matches(SHA256_PATTERN)
  sha256Hex!: string;
}

export class FinaliseClientPortalDocumentDto {
  @IsUUID('4')
  documentId!: string;

  @IsUUID('4')
  versionId!: string;
}
