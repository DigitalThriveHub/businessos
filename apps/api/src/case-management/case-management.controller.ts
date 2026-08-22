import {
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
  Query,
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
import { CaseManagementService } from './case-management.service';
import {
  AddMatterPartyDto,
  ArchiveClientDto,
  CaseManagementOptionsQueryDto,
  ChangeMatterStatusDto,
  ClientQueryDto,
  ConvertEnquiryDto,
  CreateClientDto,
  CreateMatterDto,
  MatterQueryDto,
  RemoveMatterPartyDto,
  UpdateClientDto,
  UpdateMatterComplianceDto,
  UpdateMatterDto,
} from './dto/case-management.dto';

@Controller('organisations/:organisationId/case-management')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class CaseManagementController {
  constructor(private readonly caseManagementService: CaseManagementService) {}

  @Get('options')
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('clients.read')
  getOptions(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Query() query: CaseManagementOptionsQueryDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.getOptions(
      query,
      requireOrganisationAccessContext(request),
    );
  }

  @Get('clients')
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('clients.read')
  listClients(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Query() query: ClientQueryDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.listClients(
      query,
      requireOrganisationAccessContext(request),
    );
  }

  @Get('clients/:clientId')
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('clients.read')
  getClient(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.getClient(
      clientId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('clients')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('clients.create')
  createClient(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateClientDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.createClient(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('clients/:clientId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('clients.update')
  updateClient(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Body() dto: UpdateClientDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.updateClient(
      clientId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('clients/:clientId/archive')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('clients.archive')
  archiveClient(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Body() dto: ArchiveClientDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.archiveClient(
      clientId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Get('matters')
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.read')
  listMatters(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Query() query: MatterQueryDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.listMatters(
      query,
      requireOrganisationAccessContext(request),
    );
  }

  @Get('matters/:matterId')
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.read')
  getMatter(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.getMatter(
      matterId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('matters')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.create', 'matters.parties.manage')
  createMatter(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateMatterDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.createMatter(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('matters/:matterId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.update')
  updateMatter(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: UpdateMatterDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.updateMatter(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('matters/:matterId/status')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.status.manage')
  changeMatterStatus(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: ChangeMatterStatusDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.changeMatterStatus(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('matters/:matterId/compliance')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.compliance.manage')
  updateMatterCompliance(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: UpdateMatterComplianceDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.updateMatterCompliance(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('matters/:matterId/parties')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.parties.manage')
  addMatterParty(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Body() dto: AddMatterPartyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.addMatterParty(
      matterId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('matters/:matterId/parties/:partyId/remove')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('matters.parties.manage')
  removeMatterParty(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('matterId', new ParseUUIDPipe({ version: '4' })) matterId: string,
    @Param('partyId', new ParseUUIDPipe({ version: '4' })) partyId: string,
    @Body() dto: RemoveMatterPartyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.removeMatterParty(
      matterId,
      partyId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('enquiries/:enquiryId/convert')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(
    'enquiries.convert',
    'enquiries.update',
    'clients.create',
    'matters.create',
    'matters.parties.manage',
  )
  convertEnquiry(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('enquiryId', new ParseUUIDPipe({ version: '4' })) enquiryId: string,
    @Body() dto: ConvertEnquiryDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.caseManagementService.convertEnquiry(
      enquiryId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
