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
import { CaseOperationsService } from './case-operations.service';
import {
  ArchiveDocumentDto,
  ChangeMatterDeadlineStatusDto,
  ChangeMatterTaskStatusDto,
  CreateDocumentRequestDto,
  CreateMatterDeadlineDto,
  CreateMatterTaskDto,
  ManageDocumentRequestDto,
  RegisterDocumentUploadDto,
  RegisterDocumentVersionDto,
  SendDocumentRequestDto,
  UpdateDocumentMetadataDto,
  UpdateMatterDeadlineDto,
  UpdateMatterTaskDto,
} from './dto/case-operations.dto';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/matters/:matterId/operations')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class CaseOperationsController {
  constructor(private readonly caseOperationsService: CaseOperationsService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('matters.read')
  getOperations(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.getOperations(
      matterId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('tasks.create')
  createTask(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: CreateMatterTaskDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.createTask(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('tasks/:taskId')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('tasks.update')
  updateTask(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() dto: UpdateMatterTaskDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.updateTask(
      matterId,
      taskId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('tasks/:taskId/status')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('tasks.complete')
  changeTaskStatus(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() dto: ChangeMatterTaskStatusDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.changeTaskStatus(
      matterId,
      taskId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('deadlines')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('deadlines.create')
  createDeadline(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: CreateMatterDeadlineDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.createDeadline(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('deadlines/:deadlineId')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('deadlines.update')
  updateDeadline(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('deadlineId', new ParseUUIDPipe({ version: '4' })) deadlineId: string,
    @Body() dto: UpdateMatterDeadlineDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.updateDeadline(
      matterId,
      deadlineId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('deadlines/:deadlineId/status')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('deadlines.manage')
  changeDeadlineStatus(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('deadlineId', new ParseUUIDPipe({ version: '4' })) deadlineId: string,
    @Body() dto: ChangeMatterDeadlineStatusDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.changeDeadlineStatus(
      matterId,
      deadlineId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('document-requests')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('document_requests.create')
  createDocumentRequest(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: CreateDocumentRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.createDocumentRequest(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('document-requests/:requestId/send')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('document_requests.send')
  sendDocumentRequest(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() dto: SendDocumentRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.sendDocumentRequest(
      matterId,
      requestId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('document-requests/:requestId/status')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('document_requests.manage')
  manageDocumentRequest(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() dto: ManageDocumentRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.manageDocumentRequest(
      matterId,
      requestId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/uploads')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('documents.upload')
  registerDocumentUpload(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: RegisterDocumentUploadDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.registerDocumentUpload(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/:documentId/versions')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('documents.upload')
  registerDocumentVersion(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Body() dto: RegisterDocumentVersionDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.registerDocumentVersion(
      matterId,
      documentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/:documentId/versions/:versionId/finalise')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('documents.upload')
  finaliseDocumentUpload(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.finaliseDocumentUpload(
      matterId,
      documentId,
      versionId,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('documents/:documentId')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('documents.classification.manage')
  updateDocumentMetadata(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Body() dto: UpdateDocumentMetadataDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.updateDocumentMetadata(
      matterId,
      documentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/:documentId/archive')
  @HttpCode(HttpStatus.OK)
  @SecureResponse()
  @RequirePermissions('documents.archive')
  archiveDocument(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Body() dto: ArchiveDocumentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseOperationsService.archiveDocument(
      matterId,
      documentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}