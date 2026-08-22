import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AutomationControlModule } from './automation-control/automation-control.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { CaseManagementModule } from './case-management/case-management.module';
import { CaseOperationsModule } from './case-operations/case-operations.module';
import { ClientPortalModule } from './client-portal/client-portal.module';
import { CommunicationsModule } from './communications/communications.module';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { EnquiriesModule } from './enquiries/enquiries.module';
import { FinanceModule } from './finance/finance.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { WorkforceConfigurationModule } from './workforce-configuration/workforce-configuration.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AutomationControlModule,
    AuthModule,
    BootstrapModule,
    CaseManagementModule,
    CaseOperationsModule,
    ClientPortalModule,
    CommunicationsModule,
    EnquiriesModule,
    FinanceModule,
    InvitationsModule,
    OrganisationsModule,
    WorkforceConfigurationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
