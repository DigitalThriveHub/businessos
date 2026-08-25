import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { WorkforceConfigurationController } from './workforce-configuration.controller';
import { WorkforceConfigurationService } from './workforce-configuration.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkforceConfigurationController],
  providers: [WorkforceConfigurationService, OrganisationAccessGuard],
})
export class WorkforceConfigurationModule {}
