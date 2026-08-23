import {
  applyDecorators,
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
import { CommandCentreService } from './command-centre.service';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/command-centre')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class CommandCentreController {
  constructor(private readonly commandCentre: CommandCentreService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('command_centre.read')
  getDashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.commandCentre.getDashboard(
      requireOrganisationAccessContext(request),
    );
  }
}
