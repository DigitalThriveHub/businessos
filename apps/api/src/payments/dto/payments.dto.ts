import { Transform, type TransformFnParams } from 'class-transformer';
import { Matches } from 'class-validator';

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreatePortalCheckoutDto {
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$/)
  idempotencyKey!: string;
}
