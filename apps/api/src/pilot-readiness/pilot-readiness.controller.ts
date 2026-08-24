import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { PilotReadinessService } from './pilot-readiness.service';

class AcceptanceDto {
  @IsString() @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/) key!: string;
  @IsString() @MinLength(2) @MaxLength(120) roleName!: string;
  @IsString() @MinLength(3) @MaxLength(240) scenarioName!: string;
  @IsIn(['NOT_TESTED', 'PASS', 'FAIL', 'BLOCKED']) status!:
    'NOT_TESTED' | 'PASS' | 'FAIL' | 'BLOCKED';
  @IsOptional() @IsString() @MaxLength(2000) evidenceNote?: string;
  @IsOptional() @IsString() @MaxLength(1000) evidenceReference?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
class FeedbackDto {
  @IsString() @MinLength(2) @MaxLength(120) affectedRole!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!:
    'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @IsString() @MinLength(3) @MaxLength(240) title!: string;
  @IsString() @MinLength(10) @MaxLength(4000) detail!: string;
  @IsString() @MinLength(10) @MaxLength(4000) reproductionSteps!: string;
}
class ResolutionDto {
  @IsIn(['RESOLVED', 'ACCEPTED_RISK']) status!: 'RESOLVED' | 'ACCEPTED_RISK';
  @IsString() @MinLength(10) @MaxLength(4000) resolution!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}

@Controller('organisations/:organisationId/pilot-readiness')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class PilotReadinessController {
  constructor(private readonly pilot: PilotReadinessService) {}
  @Get() @RequirePermissions('command_centre.read') dashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.pilot.dashboard(requireOrganisationAccessContext(req));
  }

  @Post('acceptances') @RequirePermissions('organisation.update') acceptance(
    @Body() body: AcceptanceDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.pilot.recordAcceptance(
      body,
      requireOrganisationAccessContext(req),
    );
  }

  @Post('feedback') @RequirePermissions('command_centre.read') feedback(
    @Body() body: FeedbackDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.pilot.createFeedback(
      body,
      requireOrganisationAccessContext(req),
    );
  }

  @Post('feedback/:feedbackId/resolve')
  @RequirePermissions('organisation.update')
  resolve(
    @Param('feedbackId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ResolutionDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.pilot.resolveFeedback(
      id,
      body,
      requireOrganisationAccessContext(req),
    );
  }
}
