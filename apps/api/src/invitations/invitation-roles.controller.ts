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
import { InvitationRolesService } from './invitation-roles.service';

@Controller('organisations/:organisationId/invitations/assignable-roles')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class InvitationRolesController {
  constructor(
    private readonly invitationRolesService: InvitationRolesService,
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
    return this.invitationRolesService.findAll(
      requireOrganisationAccessContext(request),
    );
  }
}