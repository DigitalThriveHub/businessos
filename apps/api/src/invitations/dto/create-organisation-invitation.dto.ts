import {
  Transform,
  type TransformFnParams,
} from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

function normaliseEmail({
  value,
}: TransformFnParams): unknown {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : value;
}

function normaliseRoleKeys({
  value,
}: TransformFnParams): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((roleKey) =>
    typeof roleKey === 'string'
      ? roleKey.trim().toLowerCase()
      : roleKey,
  );
}

function optionalTrimmedString({
  value,
}: TransformFnParams): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalised = value.trim();

  return normalised || undefined;
}

/**
 * Creates a tenant-bound invitation and its immutable workforce onboarding
 * plan. The service resolves the selected role keys, job profile, reporting
 * structure, KPI snapshot and AI-agent boundary inside verified tenant RLS.
 */
export class CreateOrganisationInvitationDto {
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(normaliseRoleKeys)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,
    {
      each: true,
      message:
        'Each role key must be a valid registered role key',
    },
  )
  roleKeys!: string[];

  @Transform(optionalTrimmedString)
  @IsUUID('4')
  jobProfileId!: string;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  jobTitle?: string;

  @Transform(optionalTrimmedString)
  @ValidateIf(
    (dto: CreateOrganisationInvitationDto) =>
      dto.isDepartmentManager === true ||
      dto.departmentId !== undefined,
  )
  @IsDefined({
    message:
      'departmentId is required for a department manager',
  })
  @IsUUID('4')
  departmentId?: string;

  @Transform(optionalTrimmedString)
  @ValidateIf(
    (dto: CreateOrganisationInvitationDto) =>
      dto.isTeamLead === true ||
      dto.teamId !== undefined,
  )
  @IsDefined({
    message: 'teamId is required for a team lead',
  })
  @IsUUID('4')
  teamId?: string;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsUUID('4')
  managerOrganisationMembershipId?: string;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsUUID('4')
  agentProfileId?: string;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsISO8601({
    strict: true,
    strictSeparator: true,
  })
  startsAt?: string;

  @IsOptional()
  @IsBoolean()
  isDepartmentManager?: boolean;

  @IsOptional()
  @IsBoolean()
  isTeamLead?: boolean;
}