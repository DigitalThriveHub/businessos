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
import { ComplianceAssuranceService } from './compliance-assurance.service';
import {
  CreateDataSubjectRequestDto,
  CreateLegalHoldDto,
  CreatePrivacyIncidentDto,
  CreateRetentionReviewDto,
  DecideProductionReleaseDto,
  DecideRetentionReviewDto,
  ExtendDataSubjectRequestDto,
  RecordAssuranceEvidenceDto,
  ReleaseLegalHoldDto,
  ReviewAssuranceEvidenceDto,
  TransitionDataSubjectRequestDto,
  UpdatePrivacyIncidentDto,
  UpsertRetentionPolicyDto,
} from './dto/compliance-assurance.dto';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('Referrer-Policy', 'no-referrer'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/compliance-assurance')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class ComplianceAssuranceController {
  constructor(private readonly assurance: ComplianceAssuranceService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('compliance.read')
  dashboard(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.getDashboard(
      requireOrganisationAccessContext(request),
    );
  }

  @Post('rights')
  @HttpCode(201)
  @SecureResponse()
  @RequirePermissions('compliance.manage')
  createRight(
    @Body() dto: CreateDataSubjectRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.createDataSubjectRequest(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('rights/:requestId/transition')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('compliance.manage')
  transitionRight(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() dto: TransitionDataSubjectRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.transitionDataSubjectRequest(
      requestId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('rights/:requestId/extend')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('compliance.manage')
  extendRight(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Body() dto: ExtendDataSubjectRequestDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.extendDataSubjectRequest(
      requestId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Get('rights/:requestId/export-candidate')
  @SecureResponse()
  @RequirePermissions('compliance.manage')
  exportCandidate(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.buildDataSubjectExport(
      requestId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('incidents')
  @HttpCode(201)
  @SecureResponse()
  @RequirePermissions('incidents.manage')
  createIncident(
    @Body() dto: CreatePrivacyIncidentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.createPrivacyIncident(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('incidents/:incidentId')
  @SecureResponse()
  @RequirePermissions('incidents.manage')
  updateIncident(
    @Param('incidentId', new ParseUUIDPipe({ version: '4' }))
    incidentId: string,
    @Body() dto: UpdatePrivacyIncidentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.updatePrivacyIncident(
      incidentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('legal-holds')
  @HttpCode(201)
  @SecureResponse()
  @RequirePermissions('retention.manage')
  createLegalHold(
    @Body() dto: CreateLegalHoldDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.createLegalHold(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('legal-holds/:holdId/release')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('retention.manage')
  releaseLegalHold(
    @Param('holdId', new ParseUUIDPipe({ version: '4' })) holdId: string,
    @Body() dto: ReleaseLegalHoldDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.releaseLegalHold(
      holdId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('retention-policies')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('retention.manage')
  upsertRetentionPolicy(
    @Body() dto: UpsertRetentionPolicyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.upsertRetentionPolicy(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('retention-reviews')
  @HttpCode(201)
  @SecureResponse()
  @RequirePermissions('retention.manage')
  createRetentionReview(
    @Body() dto: CreateRetentionReviewDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.createRetentionReview(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('retention-reviews/:reviewId/decision')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('retention.manage')
  decideRetentionReview(
    @Param('reviewId', new ParseUUIDPipe({ version: '4' })) reviewId: string,
    @Body() dto: DecideRetentionReviewDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.decideRetentionReview(
      reviewId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('evidence')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('assurance.manage')
  recordEvidence(
    @Body() dto: RecordAssuranceEvidenceDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.recordEvidence(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('evidence/:evidenceId/review')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('assurance.manage')
  reviewEvidence(
    @Param('evidenceId', new ParseUUIDPipe({ version: '4' }))
    evidenceId: string,
    @Body() dto: ReviewAssuranceEvidenceDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.reviewEvidence(
      evidenceId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('release-decisions')
  @HttpCode(200)
  @SecureResponse()
  @RequirePermissions('release.approve')
  decideRelease(
    @Body() dto: DecideProductionReleaseDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.assurance.decideProductionRelease(
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
