import { Module } from '@nestjs/common';

import { CommunicationsModule } from '../communications/communications.module';
import { DatabaseModule } from '../database/database.module';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';

@Module({
  imports: [DatabaseModule, CommunicationsModule],
  controllers: [ClientPortalController],
  providers: [ClientPortalService],
})
export class ClientPortalModule {}
