import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import type { VerifiedUserJwtPayload } from '../auth/verified-jwt-payload';
import { CreatePortalCheckoutDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

@Controller('client-portal/invoices')
@UseGuards(JwtAuthGuard)
export class PortalPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':invoiceId/checkout')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  createCheckout(
    @Param('invoiceId', new ParseUUIDPipe({ version: '4' })) invoiceId: string,
    @Body() dto: CreatePortalCheckoutDto,
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.payments.createPortalCheckout(invoiceId, dto, user);
  }
}

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  handle(@Req() request: RawBodyRequest<Request>) {
    const header = request.headers['stripe-signature'];
    if (
      typeof header !== 'string' ||
      header.length < 1 ||
      header.length > 2_000
    ) {
      throw new BadRequestException('stripe-signature is required.');
    }
    return this.payments.handleStripeWebhook(request.rawBody, header);
  }
}
