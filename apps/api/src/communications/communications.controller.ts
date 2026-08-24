import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { CommunicationsService } from './communications.service';
import {
  CancelCommunicationReminderDto,
  CreateClientPortalInvitationDto,
  CreateCommunicationConversationDto,
  CreateCommunicationTemplateDto,
  PublishClientPortalUpdateDto,
  RevokeClientPortalAccessDto,
  ResolveCommunicationMatchDto,
  ScheduleCommunicationReminderDto,
  SendCommunicationMessageDto,
} from './dto/communications.dto';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/communications')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('communications.read')
  getDashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.getDashboard(
      requireOrganisationAccessContext(request),
    );
  }

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('communications.send')
  createConversation(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateCommunicationConversationDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.createConversation(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('conversations/:conversationId/messages')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('communications.send')
  sendMessage(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Body() dto: SendCommunicationMessageDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.sendMessage(
      conversationId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('communication_templates.manage')
  createTemplate(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateCommunicationTemplateDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.createTemplate(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('portal-invitations')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('portal_access.manage')
  createPortalInvitation(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateClientPortalInvitationDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.createPortalInvitation(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('portal-invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('portal_access.manage')
  revokePortalInvitation(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('invitationId', new ParseUUIDPipe({ version: '4' }))
    invitationId: string,
    @Body() dto: RevokeClientPortalAccessDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.revokePortalInvitation(
      invitationId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('portal-access/:accessGrantId/revoke')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('portal_access.manage')
  revokePortalAccess(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('accessGrantId', new ParseUUIDPipe({ version: '4' }))
    accessGrantId: string,
    @Body() dto: RevokeClientPortalAccessDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.revokePortalAccess(
      accessGrantId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('portal-updates')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('portal_updates.publish')
  publishPortalUpdate(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: PublishClientPortalUpdateDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.publishPortalUpdate(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('reminders')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('communication_reminders.manage')
  scheduleReminder(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: ScheduleCommunicationReminderDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.scheduleReminder(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('reminders/:reminderId/cancel')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('communication_reminders.manage')
  cancelReminder(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('reminderId', new ParseUUIDPipe({ version: '4' }))
    reminderId: string,
    @Body() dto: CancelCommunicationReminderDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.cancelReminder(
      reminderId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('matching/:queueId/decision')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('communications.send')
  resolveMatch(
    @Param('queueId', new ParseUUIDPipe({ version: '4' })) queueId: string,
    @Body() dto: ResolveCommunicationMatchDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.communications.resolveMatch(
      queueId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
