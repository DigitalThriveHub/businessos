import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { CreateOrganisationInvitationDto } from './dto/create-organisation-invitation.dto';
import { InvitationQueryDto } from './dto/invitation-query.dto';
import { RevokeOrganisationInvitationDto } from './dto/revoke-organisation-invitation.dto';
import { InvitationsService } from './invitations.service';

@Controller('organisations/:organisationId/invitations')
@UseGuards(
  JwtAuthGuard,
  OrganisationAccessGuard,
  PermissionGuard,
)
export class InvitationsController {
  constructor(
    private readonly invitationsService:
      InvitationsService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(
    'invitations.create',
    'onboarding.manage',
  )
  create(
    @Param(
      'organisationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    _organisationId: string,
    @Body()
    dto: CreateOrganisationInvitationDto,
    @Req()
    request: OrganisationScopedRequest,
  ) {
    return this.invitationsService.create(
      dto,
      requireOrganisationAccessContext(
        request,
      ),
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(
    'invitations.read',
    'onboarding.manage',
  )
  findAll(
    @Param(
      'organisationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    _organisationId: string,
    @Query()
    query: InvitationQueryDto,
    @Req()
    request: OrganisationScopedRequest,
  ) {
    return this.invitationsService.findAll(
      requireOrganisationAccessContext(
        request,
      ),
      query.page,
      query.limit,
    );
  }

  @Post(':invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(
    'invitations.revoke',
    'onboarding.manage',
  )
  revoke(
    @Param(
      'organisationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    _organisationId: string,
    @Param(
      'invitationId',
      new ParseUUIDPipe({ version: '4' }),
    )
    invitationId: string,
    @Body()
    dto: RevokeOrganisationInvitationDto,
    @Req()
    request: OrganisationScopedRequest,
  ) {
    return this.invitationsService.revoke(
      invitationId,
      dto.reason,
      requireOrganisationAccessContext(
        request,
      ),
    );
  }
}