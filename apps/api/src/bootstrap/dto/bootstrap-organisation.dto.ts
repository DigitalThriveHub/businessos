import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BootstrapOrganisationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must contain lowercase letters, numbers and single hyphens only',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  legalName?: string;

  @IsEmail()
  @MaxLength(320)
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ownerDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownerFirstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownerLastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  ownerJobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string = 'Europe/London';

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string = 'en-GB';

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string = 'GB';
}
