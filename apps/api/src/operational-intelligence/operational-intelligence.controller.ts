import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
  ReviewDocumentIntelligenceDto,
  UpdateOperationalValueBenchmarkDto,
} from './dto/operational-intelligence.dto';
import { OperationalIntelligenceService } from './operational-intelligence.service';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('Referrer-Policy', 'no-referrer'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/operational-intelligence')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class OperationalIntelligenceController {
  constructor(
    private readonly operationalIntelligence: OperationalIntelligenceService,
  ) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('my_work.read')
  getDashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.operationalIntelligence.getDashboard(
      requireOrganisationAccessContext(request),
    );
  }

  @Post('documents/:analysisId/review')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('document_intelligence.review')
  reviewDocument(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('analysisId', new ParseUUIDPipe({ version: '4' }))
    analysisId: string,
    @Body() dto: ReviewDocumentIntelligenceDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.operationalIntelligence.reviewDocument(
      analysisId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('benchmarks/:benchmarkId')
  @SecureResponse()
  @RequirePermissions('operational_value.manage')
  updateBenchmark(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('benchmarkId', new ParseUUIDPipe({ version: '4' }))
    benchmarkId: string,
    @Body() dto: UpdateOperationalValueBenchmarkDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.operationalIntelligence.updateBenchmark(
      benchmarkId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
