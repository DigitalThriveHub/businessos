import { Module } from '@nestjs/common';

import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';

@Module({
  controllers: [OrganisationsController],
  providers: [OrganisationsService, OrganisationAccessGuard],
})
export class OrganisationsModule {}
