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
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import type { VerifiedUserJwtPayload } from '../auth/verified-jwt-payload';
import { ClientPortalService } from './client-portal.service';
import {
  AcceptClientPortalInvitationDto,
  FinaliseClientPortalDocumentDto,
  PostClientPortalMessageDto,
  RegisterClientPortalDocumentDto,
} from './dto/client-portal.dto';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('client-portal')
@UseGuards(JwtAuthGuard)
export class ClientPortalController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get()
  @SecureResponse()
  getDashboard(@CurrentUser() user: VerifiedUserJwtPayload) {
    return this.portal.getDashboard(user);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  acceptInvitation(
    @Body() dto: AcceptClientPortalInvitationDto,
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.portal.acceptInvitation(dto.token, user);
  }

  @Post('conversations/:conversationId/messages')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  postMessage(
    @Param('conversationId', new ParseUUIDPipe({ version: '4' }))
    conversationId: string,
    @Body() dto: PostClientPortalMessageDto,
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.portal.postMessage(conversationId, dto, user);
  }

  @Post('documents/uploads')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  registerDocument(
    @Body() dto: RegisterClientPortalDocumentDto,
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.portal.registerDocument(dto, user);
  }

  @Post('documents/finalise')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  finaliseDocument(
    @Body() dto: FinaliseClientPortalDocumentDto,
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.portal.finaliseDocument(dto, user);
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  markNotificationRead(
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.portal.markNotificationRead(notificationId, user);
  }
}
