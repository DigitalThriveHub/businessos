import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

function normaliseToken({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class AcceptOrganisationInvitationDto {
  @Transform(normaliseToken)
  @IsString()
  @Length(50, 50)
  @Matches(/^boi_v1_[A-Za-z0-9_-]{43}$/, {
    message: 'The invitation link is invalid or has expired',
  })
  token!: string;
}
