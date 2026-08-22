import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
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
  ValidateNested,
} from 'class-validator';

const VAT_SCHEMES = [
  'NOT_REGISTERED',
  'STANDARD',
  'CASH_ACCOUNTING',
  'FLAT_RATE',
] as const;
const TAX_CATEGORIES = [
  'STANDARD',
  'REDUCED',
  'ZERO',
  'EXEMPT',
  'OUTSIDE_SCOPE',
] as const;
const DOCUMENT_TYPES = ['INVOICE', 'CREDIT_NOTE'] as const;
const PAYMENT_TYPES = ['RECEIPT', 'REFUND'] as const;
const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'CARD',
  'CASH',
  'DIRECT_DEBIT',
  'CHEQUE',
  'OTHER',
] as const;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/;
const PREFIX_PATTERN = /^[A-Z][A-Z0-9-]{1,11}$/;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function upper({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function nullableText({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null) return value;
  return typeof value === 'string' ? value.trim() || null : value;
}

export class UpdateFinanceSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @Transform(nullableText)
  @IsString()
  @MaxLength(250)
  @IsOptional()
  legalName?: string | null;

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

  @Transform(upper)
  @IsISO31661Alpha2()
  countryCode!: string;

  @IsIn(VAT_SCHEMES)
  vatScheme!: (typeof VAT_SCHEMES)[number];

  @Transform(nullableText)
  @IsString()
  @MaxLength(32)
  @ValidateIf(
    (value: UpdateFinanceSettingsDto) => value.vatScheme !== 'NOT_REGISTERED',
  )
  vatRegistrationNumber?: string | null;

  @Transform(upper)
  @IsISO4217CurrencyCode()
  baseCurrency!: string;

  @Transform(upper)
  @Matches(PREFIX_PATTERN)
  invoicePrefix!: string;

  @Transform(upper)
  @Matches(PREFIX_PATTERN)
  creditNotePrefix!: string;

  @Transform(upper)
  @Matches(PREFIX_PATTERN)
  paymentPrefix!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays!: number;

  @Transform(nullableText)
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  paymentInstructions?: string | null;
}

export class FinanceDocumentLineDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantityMilli!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000_000)
  unitAmountMinor!: number;

  @IsIn(TAX_CATEGORIES)
  taxCategory!: (typeof TAX_CATEGORIES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  vatRateBasisPoints!: number;
}

export class CreateFinanceDocumentDto {
  @IsUUID('4')
  clientId!: string;

  @IsUUID('4')
  @IsOptional()
  matterId?: string;

  @IsIn(DOCUMENT_TYPES)
  documentType!: (typeof DOCUMENT_TYPES)[number];

  @IsUUID('4')
  @ValidateIf(
    (value: CreateFinanceDocumentDto) => value.documentType === 'CREDIT_NOTE',
  )
  relatedDocumentId?: string;

  @Transform(upper)
  @IsISO4217CurrencyCode()
  currencyCode!: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  issueDate?: string;

  @IsISO8601({ strict: true })
  @IsOptional()
  dueDate?: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  reference?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notes?: string | null;

  @IsBoolean()
  @IsOptional()
  clientVisible?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FinanceDocumentLineDto)
  lines!: FinanceDocumentLineDto[];
}

export class IssueFinanceDocumentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class VoidFinanceDocumentDto extends IssueFinanceDocumentDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class FinancePaymentAllocationDto {
  @IsUUID('4')
  documentId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000_000)
  amountMinor!: number;
}

export class RecordFinancePaymentDto {
  @IsUUID('4')
  clientId!: string;

  @IsIn(PAYMENT_TYPES)
  paymentType!: (typeof PAYMENT_TYPES)[number];

  @IsIn(PAYMENT_METHODS)
  method!: (typeof PAYMENT_METHODS)[number];

  @Transform(upper)
  @IsISO4217CurrencyCode()
  currencyCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000_000)
  amountMinor!: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  occurredAt!: string;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  reference?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(80)
  @IsOptional()
  provider?: string | null;

  @Transform(nullableText)
  @IsString()
  @MaxLength(240)
  @IsOptional()
  providerReference?: string | null;

  @IsUUID('4')
  @ValidateIf(
    (value: RecordFinancePaymentDto) => value.paymentType === 'REFUND',
  )
  relatedPaymentId?: string;

  @Transform(trim)
  @Matches(IDEMPOTENCY_PATTERN)
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FinancePaymentAllocationDto)
  allocations!: FinancePaymentAllocationDto[];
}
