import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import {
  CreateIntegrationConnectionDto,
  ExternalEnquiryIntakeDto,
  RotateIntegrationSecretDto,
  SetIntegrationConnectionStatusDto,
} from './dto/integrations.dto';
import { IntegrationsService } from './integrations.service';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

function requiredHeader(
  value: string | string[] | undefined,
  name: string,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength
  ) {
    throw new BadRequestException(`${name} is required.`);
  }
  return value;
}

@Controller('organisations/:organisationId/integrations')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('integrations.read')
  getDashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.integrations.getDashboard(
      requireOrganisationAccessContext(request),
    );
  }

  @Post('connections')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('integrations.manage')
  createConnection(
    @Body() dto: CreateIntegrationConnectionDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.integrations.createConnection(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('connections/:connectionId/status')
  @SecureResponse()
  @RequirePermissions('integrations.manage')
  setStatus(
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
    @Body() dto: SetIntegrationConnectionStatusDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.integrations.setStatus(
      connectionId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('connections/:connectionId/rotate-secret')
  @SecureResponse()
  @RequirePermissions('integrations.manage')
  rotateSecret(
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
    @Body() dto: RotateIntegrationSecretDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.integrations.rotateSecret(
      connectionId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}

@Controller('webhooks/intake')
export class ExternalIntakeWebhookController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post(':connectionId')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  receive(
    @Param('connectionId', new ParseUUIDPipe({ version: '4' }))
    connectionId: string,
    @Body() dto: ExternalEnquiryIntakeDto,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.integrations.receiveExternalEnquiry({
      connectionId,
      eventId: requiredHeader(
        request.headers['x-businessos-event-id'],
        'x-businessos-event-id',
        240,
      ),
      eventType: requiredHeader(
        request.headers['x-businessos-event-type'],
        'x-businessos-event-type',
        160,
      ),
      timestamp: requiredHeader(
        request.headers['x-businessos-timestamp'],
        'x-businessos-timestamp',
        20,
      ),
      signature: requiredHeader(
        request.headers['x-businessos-signature'],
        'x-businessos-signature',
        80,
      ),
      rawBody: request.rawBody,
      dto,
    });
  }
}
