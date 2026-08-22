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
import {
  CreateFinanceDocumentDto,
  IssueFinanceDocumentDto,
  RecordFinancePaymentDto,
  UpdateFinanceSettingsDto,
  VoidFinanceDocumentDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/finance')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('finance.read')
  getDashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.finance.getDashboard(requireOrganisationAccessContext(request));
  }

  @Patch('settings')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('finance.settings.manage')
  updateSettings(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: UpdateFinanceSettingsDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.finance.updateSettings(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('invoices.create')
  createDocument(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateFinanceDocumentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.finance.createDocument(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/:documentId/issue')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('invoices.issue')
  issueDocument(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Body() dto: IssueFinanceDocumentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.finance.issueDocument(
      documentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/:documentId/void')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('invoices.void')
  voidDocument(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Body() dto: VoidFinanceDocumentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.finance.voidDocument(
      documentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('payments.record')
  recordPayment(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: RecordFinancePaymentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.finance.recordPayment(
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
