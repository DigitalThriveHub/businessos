import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ProviderWebhookService } from './provider-webhook.service';

@Controller('webhooks/providers/:webhookPublicId')
export class ProviderWebhookController {
  constructor(private readonly webhooks: ProviderWebhookService) {}

  @Get('whatsapp')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verifyWhatsApp(
    @Param('webhookPublicId', new ParseUUIDPipe({ version: '4' }))
    webhookPublicId: string,
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response,
  ) {
    const verified = await this.webhooks.verifyWhatsApp(
      webhookPublicId,
      mode,
      token,
      challenge,
    );
    return response.status(200).type('text/plain').send(verified);
  }

  @Post('whatsapp')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  receiveWhatsApp(
    @Param('webhookPublicId', new ParseUUIDPipe({ version: '4' }))
    webhookPublicId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.webhooks.receiveWhatsApp({
      webhookPublicId,
      rawBody: request.rawBody,
      signature,
      payload,
    });
  }

  @Post('microsoft')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async receiveMicrosoft(
    @Param('webhookPublicId', new ParseUUIDPipe({ version: '4' }))
    webhookPublicId: string,
    @Query('validationToken') validationToken: string | undefined,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ) {
    const result = await this.webhooks.receiveMicrosoft({
      webhookPublicId,
      validationToken,
      rawBody: request.rawBody,
      payload,
    });
    if (result.validation !== undefined) {
      return response.status(200).type('text/plain').send(result.validation);
    }
    return response.status(202).json(result);
  }

  @Post('google')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  receiveGoogle(
    @Param('webhookPublicId', new ParseUUIDPipe({ version: '4' }))
    webhookPublicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: unknown,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (
      request.headers['content-type']?.includes('application/json') !== true
    ) {
      throw new BadRequestException(
        'The Google webhook content type is invalid.',
      );
    }
    return this.webhooks.receiveGoogle({
      webhookPublicId,
      authorization,
      rawBody: request.rawBody,
      payload,
    });
  }
}
