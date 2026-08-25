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
  CreateAgentPolicyDto,
  CreateAgentProfileDto,
  CreateDepartmentDto,
  CreateJobProfileDto,
  CreateJobProfileDutyDto,
  CreateJobProfileKpiDto,
  CreateKpiDefinitionDto,
  CreateTeamDto,
  UpdateAgentPolicyDto,
  UpdateAgentProfileDto,
  UpdateDepartmentDto,
  UpdateJobProfileDto,
  UpdateJobProfileDutyDto,
  UpdateJobProfileKpiDto,
  UpdateKpiDefinitionDto,
  UpdateTeamDto,
} from './dto/workforce-configuration.dto';
import { WorkforceConfigurationService } from './workforce-configuration.service';

@Controller('organisations/:organisationId/workforce-configuration')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class WorkforceConfigurationController {
  constructor(
    private readonly workforceConfigurationService: WorkforceConfigurationService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions(
    'workforce.read',
    'job_profiles.read',
    'kpis.read',
    'agent_profiles.read',
  )
  getSnapshot(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.getSnapshot(
      requireOrganisationAccessContext(request),
    );
  }

  @Post('departments')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('workforce.manage')
  createDepartment(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateDepartmentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createDepartment(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('departments/:departmentId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('workforce.manage')
  updateDepartment(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('departmentId', new ParseUUIDPipe({ version: '4' }))
    departmentId: string,
    @Body() dto: UpdateDepartmentDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateDepartment(
      departmentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('teams')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('workforce.manage')
  createTeam(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateTeamDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createTeam(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('teams/:teamId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('workforce.manage')
  updateTeam(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('teamId', new ParseUUIDPipe({ version: '4' }))
    teamId: string,
    @Body() dto: UpdateTeamDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateTeam(
      teamId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('kpi-definitions')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('kpis.manage')
  createKpiDefinition(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateKpiDefinitionDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createKpiDefinition(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('kpi-definitions/:kpiDefinitionId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('kpis.manage')
  updateKpiDefinition(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('kpiDefinitionId', new ParseUUIDPipe({ version: '4' }))
    kpiDefinitionId: string,
    @Body() dto: UpdateKpiDefinitionDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateKpiDefinition(
      kpiDefinitionId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('job-profiles')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('job_profiles.manage')
  createJobProfile(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateJobProfileDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createJobProfile(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('job-profiles/:jobProfileId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('job_profiles.manage')
  updateJobProfile(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('jobProfileId', new ParseUUIDPipe({ version: '4' }))
    jobProfileId: string,
    @Body() dto: UpdateJobProfileDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateJobProfile(
      jobProfileId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('job-profiles/:jobProfileId/duties')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('job_profiles.manage')
  createJobProfileDuty(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('jobProfileId', new ParseUUIDPipe({ version: '4' }))
    jobProfileId: string,
    @Body() dto: CreateJobProfileDutyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createJobProfileDuty(
      jobProfileId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('job-profiles/:jobProfileId/duties/:dutyId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('job_profiles.manage')
  updateJobProfileDuty(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('jobProfileId', new ParseUUIDPipe({ version: '4' }))
    jobProfileId: string,
    @Param('dutyId', new ParseUUIDPipe({ version: '4' }))
    dutyId: string,
    @Body() dto: UpdateJobProfileDutyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateJobProfileDuty(
      jobProfileId,
      dutyId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('job-profiles/:jobProfileId/kpis')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('job_profiles.manage', 'kpis.manage')
  createJobProfileKpi(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('jobProfileId', new ParseUUIDPipe({ version: '4' }))
    jobProfileId: string,
    @Body() dto: CreateJobProfileKpiDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createJobProfileKpi(
      jobProfileId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('job-profiles/:jobProfileId/kpis/:assignmentId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('job_profiles.manage', 'kpis.manage')
  updateJobProfileKpi(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('jobProfileId', new ParseUUIDPipe({ version: '4' }))
    jobProfileId: string,
    @Param('assignmentId', new ParseUUIDPipe({ version: '4' }))
    assignmentId: string,
    @Body() dto: UpdateJobProfileKpiDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateJobProfileKpi(
      jobProfileId,
      assignmentId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('agent-profiles')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('agent_profiles.manage')
  createAgentProfile(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: CreateAgentProfileDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createAgentProfile(
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('agent-profiles/:agentProfileId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('agent_profiles.manage')
  updateAgentProfile(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('agentProfileId', new ParseUUIDPipe({ version: '4' }))
    agentProfileId: string,
    @Body() dto: UpdateAgentProfileDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateAgentProfile(
      agentProfileId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('agent-profiles/:agentProfileId/policies')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('agent_profiles.manage')
  createAgentPolicy(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('agentProfileId', new ParseUUIDPipe({ version: '4' }))
    agentProfileId: string,
    @Body() dto: CreateAgentPolicyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.createAgentPolicy(
      agentProfileId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }

  @Patch('agent-profiles/:agentProfileId/policies/:policyId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @RequirePermissions('agent_profiles.manage')
  updateAgentPolicy(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Param('agentProfileId', new ParseUUIDPipe({ version: '4' }))
    agentProfileId: string,
    @Param('policyId', new ParseUUIDPipe({ version: '4' }))
    policyId: string,
    @Body() dto: UpdateAgentPolicyDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.workforceConfigurationService.updateAgentPolicy(
      agentProfileId,
      policyId,
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
