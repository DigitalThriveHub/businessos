import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { CommunicationWebhookService } from './communication-webhook.service';

function requiredHeader(
  value: string | string[] | undefined,
  name: string,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new BadRequestException(`${name} is required.`);
  }
  return value;
}

@Controller('webhooks/resend')
export class CommunicationWebhookController {
  constructor(private readonly webhooks: CommunicationWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  handle(@Req() request: RawBodyRequest<Request>) {
    return this.webhooks.handleResend(request.rawBody, {
      id: requiredHeader(request.headers['svix-id'], 'svix-id', 240),
      timestamp: requiredHeader(
        request.headers['svix-timestamp'],
        'svix-timestamp',
        100,
      ),
      signature: requiredHeader(
        request.headers['svix-signature'],
        'svix-signature',
        500,
      ),
    });
  }
}
