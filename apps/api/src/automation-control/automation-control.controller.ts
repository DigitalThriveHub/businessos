import {
  applyDecorators,
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

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { AutomationControlService } from './automation-control.service';
import {
  CompleteWorkflowActionDto,
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
  UpdateSlaPolicyDto,
} from './dto/automation-control.dto';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/automation-control')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class AutomationControlController {
  constructor(
    private readonly automationControlService: AutomationControlService,
  ) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('automation.read')
  getControlTower(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.automationControlService.getControlTower(
      requireOrganisationAccessContext(request),
    );
  }

  @Post('actions/:actionId/complete')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('work_items.complete')
  completeWorkItem(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('actionId', new ParseUUIDPipe({ version: '4' }))
    actionId: string,
    @Body() dto: CompleteWorkflowActionDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.automationControlService.completeWorkItem(
      actionId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('approvals')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('approvals.request')
  createApproval(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateApprovalRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.automationControlService.createApproval(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('approvals/:approvalId/decision')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('approvals.decide')
  decideApproval(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('approvalId', new ParseUUIDPipe({ version: '4' }))
    approvalId: string,
    @Body() dto: DecideApprovalRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.automationControlService.decideApproval(
      approvalId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('sla-policies/:policyId')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('sla.manage')
  updateSlaPolicy(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('policyId', new ParseUUIDPipe({ version: '4' }))
    policyId: string,
    @Body() dto: UpdateSlaPolicyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.automationControlService.updateSlaPolicy(
      policyId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
