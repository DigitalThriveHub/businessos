import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvitationAcceptanceController } from './invitation-acceptance.controller';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { InvitationRolesController } from './invitation-roles.controller';
import { InvitationRolesService } from './invitation-roles.service';
import { InvitationTokenService } from './invitation-token.service';
import { InvitationWorkforceOptionsController } from './invitation-workforce-options.controller';
import { InvitationWorkforceOptionsService } from './invitation-workforce-options.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [
    InvitationsController,
    InvitationAcceptanceController,
    InvitationRolesController,
    InvitationWorkforceOptionsController,
  ],
  providers: [
    InvitationsService,
    InvitationAcceptanceService,
    InvitationRolesService,
    InvitationWorkforceOptionsService,
    InvitationTokenService,
    OrganisationAccessGuard,
  ],
})
export class InvitationsModule {}
