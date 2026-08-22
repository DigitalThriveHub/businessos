import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { InvitationWorkforceOptionsService } from './invitation-workforce-options.service';

@Controller('organisations/:organisationId/invitations/workforce-options')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class InvitationWorkforceOptionsController {
  constructor(
    private readonly optionsService: InvitationWorkforceOptionsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('onboarding.manage')
  findAll(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.optionsService.findAll(
      requireOrganisationAccessContext(request),
    );
  }
}