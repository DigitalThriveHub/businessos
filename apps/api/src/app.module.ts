import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AutomationControlModule } from './automation-control/automation-control.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { CaseManagementModule } from './case-management/case-management.module';
import { CaseOperationsModule } from './case-operations/case-operations.module';
import { ClientPortalModule } from './client-portal/client-portal.module';
import { CommandCentreModule } from './command-centre/command-centre.module';
import { CommunicationsModule } from './communications/communications.module';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { EnquiriesModule } from './enquiries/enquiries.module';
import { FinanceModule } from './finance/finance.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MyAiModule } from './my-ai/my-ai.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { OperationalReadinessModule } from './operational-readiness/operational-readiness.module';
import { PaymentsModule } from './payments/payments.module';
import { PilotReadinessModule } from './pilot-readiness/pilot-readiness.module';
import { ServiceLifecycleModule } from './service-lifecycle/service-lifecycle.module';
import { WorkforceConfigurationModule } from './workforce-configuration/workforce-configuration.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 180 }],
    }),
    DatabaseModule,
    AutomationControlModule,
    AuthModule,
    BootstrapModule,
    CaseManagementModule,
    CaseOperationsModule,
    ClientPortalModule,
    CommandCentreModule,
    CommunicationsModule,
    EnquiriesModule,
    FinanceModule,
    IntegrationsModule,
    InvitationsModule,
    MyAiModule,
    OrganisationsModule,
    OperationalReadinessModule,
    PaymentsModule,
    PilotReadinessModule,
    ServiceLifecycleModule,
    WorkforceConfigurationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
