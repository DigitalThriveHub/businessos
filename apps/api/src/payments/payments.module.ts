import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import {
  PortalPaymentsController,
  StripeWebhookController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeGatewayService } from './stripe-gateway.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PortalPaymentsController, StripeWebhookController],
  providers: [PaymentsService, StripeGatewayService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
