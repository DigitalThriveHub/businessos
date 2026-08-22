import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import type {
  VerifiedUserJwtPayload,
} from '../auth/verified-jwt-payload';
import { AcceptOrganisationInvitationDto } from './dto/accept-organisation-invitation.dto';
import { InvitationAcceptanceService } from './invitation-acceptance.service';

@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationAcceptanceController {
  constructor(
    private readonly acceptanceService:
      InvitationAcceptanceService,
  ) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  accept(
    @CurrentUser()
    user: VerifiedUserJwtPayload,
    @Body() dto: AcceptOrganisationInvitationDto,
  ) {
    return this.acceptanceService.accept(
      user,
      dto.token,
    );
  }
}