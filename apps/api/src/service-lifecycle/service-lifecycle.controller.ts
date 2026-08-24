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
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
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
import { ServiceLifecycleService } from './service-lifecycle.service';

class CreateEngagementDto {
  @IsUUID('4') matterId!: string;
  @IsInt() @Min(0) professionalFeeMinor!: number;
  @IsInt() @Min(0) governmentFeeMinor!: number;
  @IsInt() @Min(0) initialPaymentMinor!: number;
  @IsInt() @Min(0) submissionClearanceMinor!: number;
  @IsString() @MinLength(1) @MaxLength(80) termsVersion!: string;
  @IsArray() instalments!: unknown[];
}
class OverrideDto {
  @IsUUID('4') engagementId!: string;
  @IsIn(['LEGAL_WORK', 'SUBMISSION', 'CLOSURE']) gate!:
    'LEGAL_WORK' | 'SUBMISSION' | 'CLOSURE';
  @IsString() @MinLength(20) @MaxLength(1000) reason!: string;
  @IsDateString() expiresAt!: string;
}
class CreateExceptionDto {
  @IsUUID('4') matterId!: string;
  @IsString() @MinLength(2) @MaxLength(80) category!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!:
    'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @IsString() @MinLength(3) @MaxLength(240) title!: string;
  @IsString() @MinLength(10) @MaxLength(4000) detail!: string;
  @IsUUID('4') ownerUserId!: string;
  @IsDateString() dueAt!: string;
}
class ResolveExceptionDto {
  @IsString() @MinLength(20) @MaxLength(4000) resolution!: string;
}

@Controller('organisations/:organisationId/service-lifecycle')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class ServiceLifecycleController {
  constructor(private readonly service: ServiceLifecycleService) {}
  @Get() @RequirePermissions('engagements.read') dashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.dashboard(requireOrganisationAccessContext(req));
  }
  @Post('engagements') @RequirePermissions('engagements.manage') create(
    @Body() body: CreateEngagementDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.create(body, requireOrganisationAccessContext(req));
  }
  @Post('engagements/:engagementId/accept')
  @RequirePermissions('engagements.manage')
  accept(
    @Param('engagementId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.accept(id, requireOrganisationAccessContext(req));
  }
  @Post('overrides') @RequirePermissions('engagements.override') override(
    @Body() body: OverrideDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.override(body, requireOrganisationAccessContext(req));
  }

  @Get('matters/:matterId/readiness')
  @RequirePermissions('engagements.read')
  readiness(
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.readiness(
      matterId,
      requireOrganisationAccessContext(req),
    );
  }

  @Post('exceptions')
  @RequirePermissions('engagements.manage')
  createException(
    @Body() body: CreateExceptionDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.createException(
      body,
      requireOrganisationAccessContext(req),
    );
  }

  @Post('exceptions/:exceptionId/resolve')
  @RequirePermissions('engagements.manage')
  resolveException(
    @Param('exceptionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ResolveExceptionDto,
    @Req() req: OrganisationScopedRequest,
  ) {
    return this.service.resolveException(
      id,
      body.resolution,
      requireOrganisationAccessContext(req),
    );
  }
}
