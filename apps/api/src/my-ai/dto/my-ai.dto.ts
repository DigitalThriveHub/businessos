import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class GetMyAiWorkspaceDto {
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}

export class RunMyAiCommandDto {
  @IsUUID('4')
  clientRequestId!: string;

  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @IsIn(['CHAT', 'DAILY_BRIEF'])
  mode!: 'CHAT' | 'DAILY_BRIEF';

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(4_000)
  message!: string;
}
