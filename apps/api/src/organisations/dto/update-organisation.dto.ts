import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimNullableString({ value }: { value: unknown }): unknown {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normaliseSlug({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function normaliseCountryCode({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class UpdateOrganisationDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Transform(trimNullableString)
  @IsString()
  @MaxLength(250)
  legalName?: string | null;

  @IsOptional()
  @Transform(normaliseSlug)
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must contain lowercase letters, numbers and single hyphens only',
  })
  slug?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(64)
  @Matches(/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/, {
    message: 'timezone must be a valid IANA-style timezone',
  })
  timezone?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(16)
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, {
    message: 'locale must be a valid locale identifier',
  })
  locale?: string;

  @IsOptional()
  @Transform(normaliseCountryCode)
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a two-letter country code',
  })
  countryCode?: string;
}
