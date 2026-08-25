import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f]*$/u;

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateCurrentUserProfileDto {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString()
  @MaxLength(200)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'Display name contains unsupported characters',
  })
  displayName?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'First name contains unsupported characters',
  })
  firstName?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'Last name contains unsupported characters',
  })
  lastName?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @MaxLength(16)
  @Matches(LOCALE_PATTERN, {
    message: 'Locale must be a valid locale identifier',
  })
  locale?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
