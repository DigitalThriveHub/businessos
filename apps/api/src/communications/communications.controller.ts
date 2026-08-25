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
  CancelBusinessCalendarEventDto,
  CancelCommunicationReminderDto,
  ConfigureProviderConnectionDto,
  CreateBusinessCalendarEventDto,
  CreateClientPortalInvitationDto,
  CreateCommunicationConversationDto,
  CreateCommunicationTemplateDto,
  PublishClientPortalUpdateDto,
  RevokeClientPortalAccessDto,
  ResolveCommunicationMatchDto,
  RetryBusinessCalendarEventDto,
  ScheduleCommunicationReminderDto,
  SendCommunicationMessageDto,
  SetBusinessCalendarOutcomeDto,
  SetProviderConnectionStatusDto,
} from './dto/communications.dto';
import { GateLOperationsService } from './gate-l-operations.service';

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
  constructor(
    private readonly communications: CommunicationsService,
    private readonly gateL: GateLOperationsService,
  ) {}

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

  @Get('live-operations')
  @SecureResponse()
  @RequirePermissions('communications.read')
  getLiveOperations(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.getDashboard(requireOrganisationAccessContext(request));
  }

  @Post('provider-connections')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('integrations.manage')
  configureProvider(
    @Body() dto: ConfigureProviderConnectionDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.configureProvider(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('provider-connections/:connectionId/health')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('integrations.manage')
  testProvider(
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.testProvider(
      connectionId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('provider-connections/:connectionId/status')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('integrations.manage')
  setProviderStatus(
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
    @Body() dto: SetProviderConnectionStatusDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.setProviderStatus(
      connectionId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('provider-connections/:connectionId/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @SecureResponse()
  @RequirePermissions('communications.manage')
  syncProvider(
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.manualSync(
      connectionId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('calendar-events')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('communications.send')
  createCalendarEvent(
    @Body() dto: CreateBusinessCalendarEventDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.createCalendarEvent(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('calendar-events/:eventId/cancel')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('communications.send')
  cancelCalendarEvent(
    @Param('eventId', new ParseUUIDPipe({ version: '4' })) eventId: string,
    @Body() dto: CancelBusinessCalendarEventDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.cancelCalendarEvent(
      eventId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('calendar-events/:eventId/retry')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('communications.send')
  retryCalendarEvent(
    @Param('eventId', new ParseUUIDPipe({ version: '4' })) eventId: string,
    @Body() dto: RetryBusinessCalendarEventDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.retryCalendarEvent(
      eventId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('calendar-events/:eventId/outcome')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('communications.manage')
  setCalendarOutcome(
    @Param('eventId', new ParseUUIDPipe({ version: '4' })) eventId: string,
    @Body() dto: SetBusinessCalendarOutcomeDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.gateL.setCalendarOutcome(
      eventId,
      dto,
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
