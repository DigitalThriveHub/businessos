import { Module } from '@nestjs/common';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { EnquiriesController } from './enquiries.controller';
import { EnquiriesService } from './enquiries.service';

@Module({
  controllers: [EnquiriesController],
  providers: [EnquiriesService, OrganisationAccessGuard],
})
export class EnquiriesModule {}
