import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
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
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { OrganisationsService } from './organisations.service';

@Controller('organisations/:organisationId')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class OrganisationsController {
  constructor(private readonly organisationsService: OrganisationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('organisation.read')
  findCurrent(@Req() request: OrganisationScopedRequest) {
    return this.organisationsService.findCurrent(
      requireOrganisationAccessContext(request),
    );
  }

  @Patch()
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('organisation.update')
  updateCurrent(
    @Body() dto: UpdateOrganisationDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.organisationsService.updateCurrent(
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
