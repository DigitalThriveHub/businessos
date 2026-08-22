import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { Prisma } from '../generated/prisma/client';
import {
  AgentAuthorityLevel,
  OnboardingPlanStatus,
  PermissionDataScope,
  WorkforceAssignmentStatus,
} from '../generated/prisma/enums';
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
import type {
  AgentPolicyView,
  AgentProfileView,
  JobProfileKpiView,
  JobProfileView,
  KpiDefinitionView,
  WorkforceConfigurationMutationResult,
  WorkforceConfigurationSnapshot,
  WorkforceDepartmentView,
  WorkforceTeamView,
} from './workforce-configuration.types';

const CONFIGURATION_JSON_MAX_BYTES = 16_384;

type Transaction = Prisma.TransactionClient;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function databaseCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  const code = error.code;

  return typeof code === 'string' ? code : null;
}

function decimal(value: string | null | undefined): Prisma.Decimal | null {
  return value === null || value === undefined
    ? null
    : new Prisma.Decimal(value);
}

function decimalString(value: Prisma.Decimal | null): string | null {
  return value?.toFixed() ?? null;
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function authorityRank(authority: AgentAuthorityLevel): number {
  switch (authority) {
    case AgentAuthorityLevel.DISABLED:
      return 0;
    case AgentAuthorityLevel.READ:
      return 1;
    case AgentAuthorityLevel.DRAFT:
      return 2;
    case AgentAuthorityLevel.PROPOSE:
      return 3;
    case AgentAuthorityLevel.EXECUTE_WITH_APPROVAL:
      return 4;
    case AgentAuthorityLevel.EXECUTE_AUTOMATIC:
      return 5;
  }
}

function scopeIsWithin(
  requested: PermissionDataScope,
  permitted: PermissionDataScope,
): boolean {
  if (requested === permitted) {
    return true;
  }

  switch (permitted) {
    case PermissionDataScope.OWN:
    case PermissionDataScope.SHARED:
      return false;
    case PermissionDataScope.ASSIGNED:
      return requested === PermissionDataScope.OWN;
    case PermissionDataScope.TEAM:
      return (
        [
          PermissionDataScope.OWN,
          PermissionDataScope.ASSIGNED,
        ] as PermissionDataScope[]
      ).includes(requested);
    case PermissionDataScope.DEPARTMENT:
      return (
        [
          PermissionDataScope.OWN,
          PermissionDataScope.ASSIGNED,
          PermissionDataScope.TEAM,
        ] as PermissionDataScope[]
      ).includes(requested);
    case PermissionDataScope.ORGANISATION:
      return (
        [
          PermissionDataScope.OWN,
          PermissionDataScope.ASSIGNED,
          PermissionDataScope.TEAM,
          PermissionDataScope.DEPARTMENT,
        ] as PermissionDataScope[]
      ).includes(requested);
    case PermissionDataScope.PLATFORM:
      return true;
  }
}

function toDepartmentView(value: {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  updatedAt: Date;
}): WorkforceDepartmentView {
  return {
    ...value,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toTeamView(value: {
  id: string;
  departmentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  updatedAt: Date;
}): WorkforceTeamView {
  return {
    ...value,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toKpiDefinitionView(value: {
  id: string;
  departmentId: string | null;
  key: string;
  name: string;
  description: string;
  valueType: KpiDefinitionView['valueType'];
  direction: KpiDefinitionView['direction'];
  frequency: KpiDefinitionView['frequency'];
  unitLabel: string | null;
  currencyCode: string | null;
  measurementSource: string;
  isActive: boolean;
  updatedAt: Date;
}): KpiDefinitionView {
  return {
    ...value,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toJobProfileKpiView(value: {
  id: string;
  kpiDefinitionId: string;
  targetValue: Prisma.Decimal | null;
  minimumValue: Prisma.Decimal | null;
  maximumValue: Prisma.Decimal | null;
  weightPercent: Prisma.Decimal;
  startsAt: Date;
  endsAt: Date | null;
  updatedAt: Date;
}): JobProfileKpiView {
  return {
    id: value.id,
    kpiDefinitionId: value.kpiDefinitionId,
    targetValue: decimalString(value.targetValue),
    minimumValue: decimalString(value.minimumValue),
    maximumValue: decimalString(value.maximumValue),
    weightPercent: value.weightPercent.toFixed(),
    startsAt: value.startsAt.toISOString(),
    endsAt: value.endsAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function validateNumericRange(input: {
  targetValue?: string | null;
  minimumValue?: string | null;
  maximumValue?: string | null;
}): void {
  const target = decimal(input.targetValue);
  const minimum = decimal(input.minimumValue);
  const maximum = decimal(input.maximumValue);

  if (minimum && maximum && minimum.greaterThan(maximum)) {
    throw new BadRequestException(
      'The KPI minimum value cannot exceed its maximum value.',
    );
  }

  if (target && minimum && target.lessThan(minimum)) {
    throw new BadRequestException(
      'The KPI target cannot be lower than its minimum value.',
    );
  }

  if (target && maximum && target.greaterThan(maximum)) {
    throw new BadRequestException(
      'The KPI target cannot exceed its maximum value.',
    );
  }
}

@Injectable()
export class WorkforceConfigurationService {
  private readonly logger = new Logger(WorkforceConfigurationService.name);

  constructor(private readonly rls: RlsTransactionService) {}

  async getSnapshot(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationSnapshot> {
    return this.runSafely('read', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [
          departments,
          teams,
          jobProfiles,
          kpiDefinitions,
          agentProfiles,
          aiPermissions,
        ] = await Promise.all([
          transaction.department.findMany({
            where: {
              organisationId: context.organisationId,
              deletedAt: null,
            },
            select: {
              id: true,
              parentId: true,
              name: true,
              code: true,
              description: true,
              isActive: true,
              updatedAt: true,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          }),
          transaction.team.findMany({
            where: {
              organisationId: context.organisationId,
              deletedAt: null,
            },
            select: {
              id: true,
              departmentId: true,
              name: true,
              code: true,
              description: true,
              isActive: true,
              updatedAt: true,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          }),
          transaction.jobProfile.findMany({
            where: {
              organisationId: context.organisationId,
              deletedAt: null,
            },
            select: {
              id: true,
              departmentId: true,
              key: true,
              name: true,
              description: true,
              purpose: true,
              version: true,
              isManagerial: true,
              isActive: true,
              updatedAt: true,
              duties: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  code: true,
                  title: true,
                  description: true,
                  position: true,
                  isCritical: true,
                  requiresEvidence: true,
                  isActive: true,
                  updatedAt: true,
                },
                orderBy: [{ position: 'asc' }, { code: 'asc' }],
              },
              kpis: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  kpiDefinitionId: true,
                  targetValue: true,
                  minimumValue: true,
                  maximumValue: true,
                  weightPercent: true,
                  startsAt: true,
                  endsAt: true,
                  updatedAt: true,
                },
                orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
              },
            },
            orderBy: [{ name: 'asc' }, { key: 'asc' }],
          }),
          transaction.kpiDefinition.findMany({
            where: {
              organisationId: context.organisationId,
              deletedAt: null,
            },
            select: {
              id: true,
              departmentId: true,
              key: true,
              name: true,
              description: true,
              valueType: true,
              direction: true,
              frequency: true,
              unitLabel: true,
              currencyCode: true,
              measurementSource: true,
              isActive: true,
              updatedAt: true,
            },
            orderBy: [{ name: 'asc' }, { key: 'asc' }],
          }),
          transaction.agentProfile.findMany({
            where: {
              organisationId: context.organisationId,
              deletedAt: null,
            },
            select: {
              id: true,
              departmentId: true,
              key: true,
              name: true,
              description: true,
              behaviourInstructions: true,
              authorityCeiling: true,
              requiresHumanReview: true,
              version: true,
              isActive: true,
              updatedAt: true,
              policies: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  toolKey: true,
                  requiredPermissionKey: true,
                  authorityLevel: true,
                  maximumDataScope: true,
                  requiresApproval: true,
                  requiresMfa: true,
                  maxActionsPerRun: true,
                  configuration: true,
                  isActive: true,
                  updatedAt: true,
                },
                orderBy: [{ toolKey: 'asc' }, { id: 'asc' }],
              },
            },
            orderBy: [{ name: 'asc' }, { key: 'asc' }],
          }),
          transaction.permission.findMany({
            where: {
              allowsAiUse: true,
              isActive: true,
              deletedAt: null,
            },
            select: {
              key: true,
              name: true,
              description: true,
              resource: true,
              action: true,
              dataScope: true,
              requiresMfa: true,
            },
            orderBy: [{ resource: 'asc' }, { action: 'asc' }, { key: 'asc' }],
          }),
        ]);

        return {
          organisationId: context.organisationId,
          generatedAt: new Date().toISOString(),
          departments: departments.map(toDepartmentView),
          teams: teams.map(toTeamView),
          jobProfiles: jobProfiles.map((profile): JobProfileView => ({
            id: profile.id,
            departmentId: profile.departmentId,
            key: profile.key,
            name: profile.name,
            description: profile.description,
            purpose: profile.purpose,
            version: profile.version,
            isManagerial: profile.isManagerial,
            isActive: profile.isActive,
            updatedAt: profile.updatedAt.toISOString(),
            duties: profile.duties.map((duty) => ({
              ...duty,
              updatedAt: duty.updatedAt.toISOString(),
            })),
            kpis: profile.kpis.map(toJobProfileKpiView),
          })),
          kpiDefinitions: kpiDefinitions.map(toKpiDefinitionView),
          agentProfiles: agentProfiles.map((profile): AgentProfileView => ({
            id: profile.id,
            departmentId: profile.departmentId,
            key: profile.key,
            name: profile.name,
            description: profile.description,
            behaviourInstructions: profile.behaviourInstructions,
            authorityCeiling: profile.authorityCeiling,
            requiresHumanReview: profile.requiresHumanReview,
            version: profile.version,
            isActive: profile.isActive,
            updatedAt: profile.updatedAt.toISOString(),
            policies: profile.policies.map((policy): AgentPolicyView => ({
              id: policy.id,
              toolKey: policy.toolKey,
              requiredPermissionKey: policy.requiredPermissionKey,
              authorityLevel: policy.authorityLevel,
              maximumDataScope: policy.maximumDataScope,
              requiresApproval: policy.requiresApproval,
              requiresMfa: policy.requiresMfa,
              maxActionsPerRun: policy.maxActionsPerRun,
              configuration: jsonObject(policy.configuration),
              isActive: policy.isActive,
              updatedAt: policy.updatedAt.toISOString(),
            })),
          })),
          aiPermissions,
        };
      }),
    );
  }

  async createDepartment(
    dto: CreateDepartmentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('department.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        await this.assertDepartmentParent(
          transaction,
          context.organisationId,
          dto.parentId ?? null,
          null,
        );

        const created = await transaction.department.create({
          data: {
            organisationId: context.organisationId,
            parentId: dto.parentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            isActive: dto.isActive ?? true,
          },
          select: { id: true, updatedAt: true },
        });

        await this.writeAudit(
          transaction,
          context,
          'workforce_department.created',
          'department',
          created.id,
          null,
          {
            name: dto.name,
            code: dto.code ?? null,
            parentId: dto.parentId ?? null,
            isActive: dto.isActive ?? true,
          },
        );

        return this.mutationResult('department', created);
      }),
    );
  }

  async updateDepartment(
    departmentId: string,
    dto: UpdateDepartmentDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('department.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const existing = await transaction.department.findFirst({
          where: {
            id: departmentId,
            organisationId: context.organisationId,
            deletedAt: null,
          },
          select: {
            id: true,
            parentId: true,
            name: true,
            code: true,
            description: true,
            isActive: true,
            updatedAt: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('Department not found.');
        }

        this.assertExpectedTimestamp(existing.updatedAt, dto.expectedUpdatedAt);

        await this.assertDepartmentParent(
          transaction,
          context.organisationId,
          dto.parentId ?? null,
          departmentId,
        );

        if (existing.isActive && !dto.isActive) {
          await this.assertDepartmentCanBeArchived(
            transaction,
            context.organisationId,
            departmentId,
          );
        }

        const now = new Date();
        const update = await transaction.department.updateMany({
          where: {
            id: departmentId,
            organisationId: context.organisationId,
            deletedAt: null,
            updatedAt: existing.updatedAt,
          },
          data: {
            parentId: dto.parentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            isActive: dto.isActive,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);

        await this.writeAudit(
          transaction,
          context,
          'workforce_department.updated',
          'department',
          departmentId,
          existing,
          {
            parentId: dto.parentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            isActive: dto.isActive,
          },
        );

        return this.mutationResult('department', {
          id: departmentId,
          updatedAt: now,
        });
      }),
    );
  }

  async createTeam(
    dto: CreateTeamDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('team.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        await this.assertActiveDepartment(
          transaction,
          context.organisationId,
          dto.departmentId ?? null,
        );

        const created = await transaction.team.create({
          data: {
            organisationId: context.organisationId,
            departmentId: dto.departmentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            isActive: dto.isActive ?? true,
          },
          select: { id: true, updatedAt: true },
        });

        await this.writeAudit(
          transaction,
          context,
          'workforce_team.created',
          'team',
          created.id,
          null,
          {
            departmentId: dto.departmentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            isActive: dto.isActive ?? true,
          },
        );

        return this.mutationResult('team', created);
      }),
    );
  }

  async updateTeam(
    teamId: string,
    dto: UpdateTeamDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('team.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const existing = await transaction.team.findFirst({
          where: {
            id: teamId,
            organisationId: context.organisationId,
            deletedAt: null,
          },
          select: {
            id: true,
            departmentId: true,
            name: true,
            code: true,
            description: true,
            isActive: true,
            updatedAt: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('Team not found.');
        }

        this.assertExpectedTimestamp(existing.updatedAt, dto.expectedUpdatedAt);

        await this.assertActiveDepartment(
          transaction,
          context.organisationId,
          dto.departmentId ?? null,
        );

        if (
          existing.departmentId !== (dto.departmentId ?? null) ||
          (existing.isActive && !dto.isActive)
        ) {
          await this.assertTeamCanBeArchived(
            transaction,
            context.organisationId,
            teamId,
          );
        }

        const now = new Date();
        const update = await transaction.team.updateMany({
          where: {
            id: teamId,
            organisationId: context.organisationId,
            deletedAt: null,
            updatedAt: existing.updatedAt,
          },
          data: {
            departmentId: dto.departmentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            isActive: dto.isActive,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);

        await this.writeAudit(
          transaction,
          context,
          'workforce_team.updated',
          'team',
          teamId,
          existing,
          {
            departmentId: dto.departmentId ?? null,
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            isActive: dto.isActive,
          },
        );

        return this.mutationResult('team', { id: teamId, updatedAt: now });
      }),
    );
  }

  async createKpiDefinition(
    dto: CreateKpiDefinitionDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('kpi_definition.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        await this.assertActiveDepartment(
          transaction,
          context.organisationId,
          dto.departmentId ?? null,
        );

        const created = await transaction.kpiDefinition.create({
          data: {
            organisationId: context.organisationId,
            departmentId: dto.departmentId ?? null,
            key: dto.key,
            name: dto.name,
            description: dto.description,
            valueType: dto.valueType,
            direction: dto.direction,
            frequency: dto.frequency,
            unitLabel: dto.unitLabel ?? null,
            currencyCode:
              dto.valueType === 'CURRENCY' ? (dto.currencyCode ?? null) : null,
            measurementSource: dto.measurementSource,
            isActive: dto.isActive ?? true,
            createdByUserProfileId: context.userId,
          },
          select: { id: true, updatedAt: true },
        });

        await this.writeAudit(
          transaction,
          context,
          'kpi_definition.created',
          'kpi_definition',
          created.id,
          null,
          {
            key: dto.key,
            name: dto.name,
            departmentId: dto.departmentId ?? null,
            valueType: dto.valueType,
            direction: dto.direction,
            frequency: dto.frequency,
            measurementSource: dto.measurementSource,
            isActive: dto.isActive ?? true,
          },
        );

        return this.mutationResult('kpi_definition', created);
      }),
    );
  }

  async updateKpiDefinition(
    kpiDefinitionId: string,
    dto: UpdateKpiDefinitionDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('kpi_definition.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const existing = await transaction.kpiDefinition.findFirst({
          where: {
            id: kpiDefinitionId,
            organisationId: context.organisationId,
            deletedAt: null,
          },
          select: {
            id: true,
            key: true,
            departmentId: true,
            name: true,
            description: true,
            valueType: true,
            direction: true,
            frequency: true,
            unitLabel: true,
            currencyCode: true,
            measurementSource: true,
            isActive: true,
            updatedAt: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('KPI definition not found.');
        }

        this.assertExpectedTimestamp(existing.updatedAt, dto.expectedUpdatedAt);

        if (existing.isActive && !dto.isActive) {
          await this.assertKpiCanBeArchived(
            transaction,
            context.organisationId,
            kpiDefinitionId,
          );
        }

        const now = new Date();
        const update = await transaction.kpiDefinition.updateMany({
          where: {
            id: kpiDefinitionId,
            organisationId: context.organisationId,
            deletedAt: null,
            updatedAt: existing.updatedAt,
          },
          data: {
            name: dto.name,
            description: dto.description,
            valueType: dto.valueType,
            direction: dto.direction,
            frequency: dto.frequency,
            unitLabel: dto.unitLabel ?? null,
            currencyCode:
              dto.valueType === 'CURRENCY' ? (dto.currencyCode ?? null) : null,
            measurementSource: dto.measurementSource,
            isActive: dto.isActive,
            updatedByUserProfileId: context.userId,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);

        await this.writeAudit(
          transaction,
          context,
          'kpi_definition.updated',
          'kpi_definition',
          kpiDefinitionId,
          existing,
          {
            name: dto.name,
            valueType: dto.valueType,
            direction: dto.direction,
            frequency: dto.frequency,
            measurementSource: dto.measurementSource,
            isActive: dto.isActive,
          },
        );

        return this.mutationResult('kpi_definition', {
          id: kpiDefinitionId,
          updatedAt: now,
        });
      }),
    );
  }

  async createJobProfile(
    dto: CreateJobProfileDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    if (dto.isActive === true) {
      throw new BadRequestException(
        'Create the job profile as a draft, add at least one duty, then activate it.',
      );
    }

    return this.runSafely('job_profile.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        await this.assertActiveDepartment(
          transaction,
          context.organisationId,
          dto.departmentId ?? null,
        );

        const created = await transaction.jobProfile.create({
          data: {
            organisationId: context.organisationId,
            departmentId: dto.departmentId ?? null,
            key: dto.key,
            name: dto.name,
            description: dto.description ?? null,
            purpose: dto.purpose ?? null,
            isManagerial: dto.isManagerial ?? false,
            isActive: false,
            createdByUserProfileId: context.userId,
          },
          select: { id: true, version: true, updatedAt: true },
        });

        await this.writeAudit(
          transaction,
          context,
          'job_profile.created',
          'job_profile',
          created.id,
          null,
          {
            key: dto.key,
            name: dto.name,
            departmentId: dto.departmentId ?? null,
            isManagerial: dto.isManagerial ?? false,
            isActive: false,
            version: created.version,
          },
        );

        return this.mutationResult('job_profile', created);
      }),
    );
  }

  async updateJobProfile(
    jobProfileId: string,
    dto: UpdateJobProfileDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('job_profile.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const existing = await transaction.jobProfile.findFirst({
          where: {
            id: jobProfileId,
            organisationId: context.organisationId,
            deletedAt: null,
          },
          select: {
            id: true,
            key: true,
            departmentId: true,
            name: true,
            description: true,
            purpose: true,
            version: true,
            isManagerial: true,
            isActive: true,
            updatedAt: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('Job profile not found.');
        }

        this.assertExpectedVersion(existing.version, dto.expectedVersion);

        if (!existing.isActive && dto.isActive) {
          const activeDutyCount = await transaction.jobProfileDuty.count({
            where: {
              organisationId: context.organisationId,
              jobProfileId,
              isActive: true,
              deletedAt: null,
            },
          });

          if (activeDutyCount === 0) {
            throw new BadRequestException(
              'An active job profile must contain at least one active duty.',
            );
          }
        }

        if (existing.isActive && !dto.isActive) {
          await this.assertJobProfileCanBeArchived(
            transaction,
            context.organisationId,
            jobProfileId,
          );
        }

        const now = new Date();
        const update = await transaction.jobProfile.updateMany({
          where: {
            id: jobProfileId,
            organisationId: context.organisationId,
            version: existing.version,
            deletedAt: null,
          },
          data: {
            name: dto.name,
            description: dto.description ?? null,
            purpose: dto.purpose ?? null,
            isManagerial: dto.isManagerial,
            isActive: dto.isActive,
            version: { increment: 1 },
            updatedByUserProfileId: context.userId,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);
        const version = existing.version + 1;

        await this.writeAudit(
          transaction,
          context,
          'job_profile.updated',
          'job_profile',
          jobProfileId,
          existing,
          {
            name: dto.name,
            isManagerial: dto.isManagerial,
            isActive: dto.isActive,
            version,
          },
        );

        return this.mutationResult('job_profile', {
          id: jobProfileId,
          version,
          updatedAt: now,
        });
      }),
    );
  }

  async createJobProfileDuty(
    jobProfileId: string,
    dto: CreateJobProfileDutyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('job_profile_duty.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const profile = await this.requireJobProfile(
          transaction,
          context.organisationId,
          jobProfileId,
        );

        const created = await transaction.jobProfileDuty.create({
          data: {
            organisationId: context.organisationId,
            jobProfileId,
            code: dto.code,
            title: dto.title,
            description: dto.description,
            position: dto.position,
            isCritical: dto.isCritical ?? false,
            requiresEvidence: dto.requiresEvidence ?? false,
            isActive: dto.isActive ?? true,
          },
          select: { id: true, updatedAt: true },
        });

        await this.bumpJobProfileVersion(
          transaction,
          context,
          jobProfileId,
          profile.version,
        );

        await this.writeAudit(
          transaction,
          context,
          'job_profile_duty.created',
          'job_profile_duty',
          created.id,
          null,
          {
            jobProfileId,
            code: dto.code,
            title: dto.title,
            position: dto.position,
            isCritical: dto.isCritical ?? false,
            requiresEvidence: dto.requiresEvidence ?? false,
            isActive: dto.isActive ?? true,
          },
        );

        return this.mutationResult('job_profile_duty', created);
      }),
    );
  }

  async updateJobProfileDuty(
    jobProfileId: string,
    dutyId: string,
    dto: UpdateJobProfileDutyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    return this.runSafely('job_profile_duty.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [profile, existing] = await Promise.all([
          this.requireJobProfile(
            transaction,
            context.organisationId,
            jobProfileId,
          ),
          transaction.jobProfileDuty.findFirst({
            where: {
              id: dutyId,
              organisationId: context.organisationId,
              jobProfileId,
              deletedAt: null,
            },
            select: {
              id: true,
              code: true,
              title: true,
              description: true,
              position: true,
              isCritical: true,
              requiresEvidence: true,
              isActive: true,
              updatedAt: true,
            },
          }),
        ]);

        if (!existing) {
          throw new NotFoundException('Job-profile duty not found.');
        }

        this.assertExpectedTimestamp(existing.updatedAt, dto.expectedUpdatedAt);

        if (profile.isActive && existing.isActive && !dto.isActive) {
          const remainingActiveDuties = await transaction.jobProfileDuty.count({
            where: {
              organisationId: context.organisationId,
              jobProfileId,
              id: { not: dutyId },
              isActive: true,
              deletedAt: null,
            },
          });

          if (remainingActiveDuties === 0) {
            throw new BadRequestException(
              'An active job profile must retain at least one active duty.',
            );
          }
        }

        const now = new Date();
        const update = await transaction.jobProfileDuty.updateMany({
          where: {
            id: dutyId,
            organisationId: context.organisationId,
            jobProfileId,
            updatedAt: existing.updatedAt,
            deletedAt: null,
          },
          data: {
            title: dto.title,
            description: dto.description,
            position: dto.position,
            isCritical: dto.isCritical,
            requiresEvidence: dto.requiresEvidence,
            isActive: dto.isActive,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);
        await this.bumpJobProfileVersion(
          transaction,
          context,
          jobProfileId,
          profile.version,
        );

        await this.writeAudit(
          transaction,
          context,
          'job_profile_duty.updated',
          'job_profile_duty',
          dutyId,
          existing,
          {
            jobProfileId,
            title: dto.title,
            position: dto.position,
            isCritical: dto.isCritical,
            requiresEvidence: dto.requiresEvidence,
            isActive: dto.isActive,
          },
        );

        return this.mutationResult('job_profile_duty', {
          id: dutyId,
          updatedAt: now,
        });
      }),
    );
  }

  async createJobProfileKpi(
    jobProfileId: string,
    dto: CreateJobProfileKpiDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    validateNumericRange(dto);

    return this.runSafely('job_profile_kpi.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [profile, kpiDefinition] = await Promise.all([
          this.requireJobProfile(
            transaction,
            context.organisationId,
            jobProfileId,
          ),
          this.requireKpiDefinition(
            transaction,
            context.organisationId,
            dto.kpiDefinitionId,
          ),
        ]);

        if (
          kpiDefinition.departmentId &&
          kpiDefinition.departmentId !== profile.departmentId
        ) {
          throw new BadRequestException(
            'The KPI definition is restricted to another department.',
          );
        }

        const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
        const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
        this.assertDateWindow(startsAt, endsAt);

        await this.assertKpiWeightLimit(
          transaction,
          context.organisationId,
          jobProfileId,
          dto.weightPercent,
          startsAt,
          null,
          endsAt,
        );

        const created = await transaction.jobProfileKpi.create({
          data: {
            organisationId: context.organisationId,
            jobProfileId,
            kpiDefinitionId: dto.kpiDefinitionId,
            targetValue: decimal(dto.targetValue),
            minimumValue: decimal(dto.minimumValue),
            maximumValue: decimal(dto.maximumValue),
            weightPercent: new Prisma.Decimal(dto.weightPercent),
            startsAt,
            endsAt,
          },
          select: { id: true, updatedAt: true },
        });

        await this.bumpJobProfileVersion(
          transaction,
          context,
          jobProfileId,
          profile.version,
        );

        await this.writeAudit(
          transaction,
          context,
          'job_profile_kpi.created',
          'job_profile_kpi',
          created.id,
          null,
          {
            jobProfileId,
            kpiDefinitionId: dto.kpiDefinitionId,
            targetValue: dto.targetValue ?? null,
            minimumValue: dto.minimumValue ?? null,
            maximumValue: dto.maximumValue ?? null,
            weightPercent: dto.weightPercent,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt?.toISOString() ?? null,
          },
        );

        return this.mutationResult('job_profile_kpi', created);
      }),
    );
  }

  async updateJobProfileKpi(
    jobProfileId: string,
    assignmentId: string,
    dto: UpdateJobProfileKpiDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    validateNumericRange(dto);

    return this.runSafely('job_profile_kpi.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [profile, existing] = await Promise.all([
          this.requireJobProfile(
            transaction,
            context.organisationId,
            jobProfileId,
          ),
          transaction.jobProfileKpi.findFirst({
            where: {
              id: assignmentId,
              organisationId: context.organisationId,
              jobProfileId,
              deletedAt: null,
            },
            select: {
              id: true,
              kpiDefinitionId: true,
              targetValue: true,
              minimumValue: true,
              maximumValue: true,
              weightPercent: true,
              startsAt: true,
              endsAt: true,
              updatedAt: true,
            },
          }),
        ]);

        if (!existing) {
          throw new NotFoundException('Job-profile KPI assignment not found.');
        }

        this.assertExpectedTimestamp(existing.updatedAt, dto.expectedUpdatedAt);

        const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
        this.assertDateWindow(existing.startsAt, endsAt);

        if (existing.endsAt && !endsAt) {
          throw new ConflictException(
            'An ended KPI assignment cannot be reopened; create a new effective assignment.',
          );
        }

        await this.assertKpiWeightLimit(
          transaction,
          context.organisationId,
          jobProfileId,
          dto.weightPercent,
          existing.startsAt,
          assignmentId,
          endsAt,
        );

        const now = new Date();
        const update = await transaction.jobProfileKpi.updateMany({
          where: {
            id: assignmentId,
            organisationId: context.organisationId,
            jobProfileId,
            updatedAt: existing.updatedAt,
            deletedAt: null,
          },
          data: {
            targetValue: decimal(dto.targetValue),
            minimumValue: decimal(dto.minimumValue),
            maximumValue: decimal(dto.maximumValue),
            weightPercent: new Prisma.Decimal(dto.weightPercent),
            endsAt,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);
        await this.bumpJobProfileVersion(
          transaction,
          context,
          jobProfileId,
          profile.version,
        );

        await this.writeAudit(
          transaction,
          context,
          'job_profile_kpi.updated',
          'job_profile_kpi',
          assignmentId,
          {
            kpiDefinitionId: existing.kpiDefinitionId,
            targetValue: decimalString(existing.targetValue),
            minimumValue: decimalString(existing.minimumValue),
            maximumValue: decimalString(existing.maximumValue),
            weightPercent: existing.weightPercent.toFixed(),
            endsAt: existing.endsAt?.toISOString() ?? null,
          },
          {
            jobProfileId,
            targetValue: dto.targetValue ?? null,
            minimumValue: dto.minimumValue ?? null,
            maximumValue: dto.maximumValue ?? null,
            weightPercent: dto.weightPercent,
            endsAt: endsAt?.toISOString() ?? null,
          },
        );

        return this.mutationResult('job_profile_kpi', {
          id: assignmentId,
          updatedAt: now,
        });
      }),
    );
  }

  async createAgentProfile(
    dto: CreateAgentProfileDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    this.assertAgentProfileBoundary(
      dto.authorityCeiling,
      dto.requiresHumanReview,
    );

    return this.runSafely('agent_profile.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        await this.assertActiveDepartment(
          transaction,
          context.organisationId,
          dto.departmentId ?? null,
        );

        const created = await transaction.agentProfile.create({
          data: {
            organisationId: context.organisationId,
            departmentId: dto.departmentId ?? null,
            key: dto.key,
            name: dto.name,
            description: dto.description,
            behaviourInstructions: dto.behaviourInstructions,
            authorityCeiling: dto.authorityCeiling,
            requiresHumanReview: dto.requiresHumanReview,
            isActive: dto.isActive ?? true,
            createdByUserProfileId: context.userId,
          },
          select: { id: true, version: true, updatedAt: true },
        });

        await this.writeAudit(
          transaction,
          context,
          'agent_profile.created',
          'agent_profile',
          created.id,
          null,
          {
            key: dto.key,
            name: dto.name,
            departmentId: dto.departmentId ?? null,
            authorityCeiling: dto.authorityCeiling,
            requiresHumanReview: dto.requiresHumanReview,
            instructionCharacters: dto.behaviourInstructions.length,
            isActive: dto.isActive ?? true,
            version: created.version,
          },
        );

        return this.mutationResult('agent_profile', created);
      }),
    );
  }

  async updateAgentProfile(
    agentProfileId: string,
    dto: UpdateAgentProfileDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    this.assertAgentProfileBoundary(
      dto.authorityCeiling,
      dto.requiresHumanReview,
    );

    return this.runSafely('agent_profile.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const existing = await transaction.agentProfile.findFirst({
          where: {
            id: agentProfileId,
            organisationId: context.organisationId,
            deletedAt: null,
          },
          select: {
            id: true,
            key: true,
            departmentId: true,
            name: true,
            authorityCeiling: true,
            requiresHumanReview: true,
            version: true,
            isActive: true,
            updatedAt: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('AI-agent profile not found.');
        }

        this.assertExpectedVersion(existing.version, dto.expectedVersion);

        if (existing.isActive && !dto.isActive) {
          await this.assertAgentProfileCanBeArchived(
            transaction,
            context.organisationId,
            agentProfileId,
          );

          await transaction.agentPolicy.updateMany({
            where: {
              organisationId: context.organisationId,
              agentProfileId,
              isActive: true,
              deletedAt: null,
            },
            data: {
              isActive: false,
              updatedAt: new Date(),
            },
          });
        }

        if (dto.isActive) {
          const policiesAboveCeiling = await transaction.agentPolicy.count({
            where: {
              organisationId: context.organisationId,
              agentProfileId,
              isActive: true,
              deletedAt: null,
              authorityLevel: {
                in: this.authoritiesAbove(dto.authorityCeiling),
              },
            },
          });

          if (policiesAboveCeiling > 0) {
            throw new BadRequestException(
              'Lower or disable policies that exceed the new AI authority ceiling.',
            );
          }
        }

        const now = new Date();
        const update = await transaction.agentProfile.updateMany({
          where: {
            id: agentProfileId,
            organisationId: context.organisationId,
            version: existing.version,
            deletedAt: null,
          },
          data: {
            name: dto.name,
            description: dto.description,
            behaviourInstructions: dto.behaviourInstructions,
            authorityCeiling: dto.authorityCeiling,
            requiresHumanReview: dto.requiresHumanReview,
            isActive: dto.isActive,
            version: { increment: 1 },
            updatedByUserProfileId: context.userId,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);
        const version = existing.version + 1;

        await this.writeAudit(
          transaction,
          context,
          'agent_profile.updated',
          'agent_profile',
          agentProfileId,
          existing,
          {
            name: dto.name,
            authorityCeiling: dto.authorityCeiling,
            requiresHumanReview: dto.requiresHumanReview,
            instructionCharacters: dto.behaviourInstructions.length,
            isActive: dto.isActive,
            version,
          },
        );

        return this.mutationResult('agent_profile', {
          id: agentProfileId,
          version,
          updatedAt: now,
        });
      }),
    );
  }

  async createAgentPolicy(
    agentProfileId: string,
    dto: CreateAgentPolicyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    this.assertConfigurationSize(dto.configuration ?? {});

    return this.runSafely('agent_policy.create', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [profile, permission] = await Promise.all([
          this.requireActiveAgentProfile(
            transaction,
            context.organisationId,
            agentProfileId,
          ),
          this.requireAiPermission(
            transaction,
            dto.requiredPermissionKey,
          ),
        ]);

        this.assertAgentPolicyBoundary(profile, permission, dto);

        const created = await transaction.agentPolicy.create({
          data: {
            organisationId: context.organisationId,
            agentProfileId,
            toolKey: dto.toolKey,
            requiredPermissionKey: dto.requiredPermissionKey,
            authorityLevel: dto.authorityLevel,
            maximumDataScope: dto.maximumDataScope,
            requiresApproval: dto.requiresApproval,
            requiresMfa: dto.requiresMfa,
            maxActionsPerRun: dto.maxActionsPerRun,
            configuration: this.toJsonConfiguration(dto.configuration ?? {}),
            isActive: dto.isActive ?? true,
          },
          select: { id: true, updatedAt: true },
        });

        await this.bumpAgentProfileVersion(
          transaction,
          context,
          agentProfileId,
          profile.version,
        );

        await this.writeAudit(
          transaction,
          context,
          'agent_policy.created',
          'agent_policy',
          created.id,
          null,
          this.safeAgentPolicyAudit(agentProfileId, dto),
        );

        return this.mutationResult('agent_policy', created);
      }),
    );
  }

  async updateAgentPolicy(
    agentProfileId: string,
    policyId: string,
    dto: UpdateAgentPolicyDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<WorkforceConfigurationMutationResult> {
    this.assertConfigurationSize(dto.configuration ?? {});

    return this.runSafely('agent_policy.update', () =>
      this.rls.run(this.rlsContext(context), async (transaction) => {
        const [profile, permission, existing] = await Promise.all([
          this.requireActiveAgentProfile(
            transaction,
            context.organisationId,
            agentProfileId,
          ),
          this.requireAiPermission(
            transaction,
            dto.requiredPermissionKey,
          ),
          transaction.agentPolicy.findFirst({
            where: {
              id: policyId,
              organisationId: context.organisationId,
              agentProfileId,
              deletedAt: null,
            },
            select: {
              id: true,
              toolKey: true,
              requiredPermissionKey: true,
              authorityLevel: true,
              maximumDataScope: true,
              requiresApproval: true,
              requiresMfa: true,
              maxActionsPerRun: true,
              configuration: true,
              isActive: true,
              updatedAt: true,
            },
          }),
        ]);

        if (!existing) {
          throw new NotFoundException('AI-agent policy not found.');
        }

        this.assertExpectedTimestamp(existing.updatedAt, dto.expectedUpdatedAt);
        this.assertAgentPolicyBoundary(profile, permission, dto);

        const now = new Date();
        const update = await transaction.agentPolicy.updateMany({
          where: {
            id: policyId,
            organisationId: context.organisationId,
            agentProfileId,
            updatedAt: existing.updatedAt,
            deletedAt: null,
          },
          data: {
            requiredPermissionKey: dto.requiredPermissionKey,
            authorityLevel: dto.authorityLevel,
            maximumDataScope: dto.maximumDataScope,
            requiresApproval: dto.requiresApproval,
            requiresMfa: dto.requiresMfa,
            maxActionsPerRun: dto.maxActionsPerRun,
            configuration: this.toJsonConfiguration(dto.configuration ?? {}),
            isActive: dto.isActive,
            updatedAt: now,
          },
        });

        this.assertSingleUpdate(update.count);
        await this.bumpAgentProfileVersion(
          transaction,
          context,
          agentProfileId,
          profile.version,
        );

        await this.writeAudit(
          transaction,
          context,
          'agent_policy.updated',
          'agent_policy',
          policyId,
          {
            toolKey: existing.toolKey,
            requiredPermissionKey: existing.requiredPermissionKey,
            authorityLevel: existing.authorityLevel,
            maximumDataScope: existing.maximumDataScope,
            requiresApproval: existing.requiresApproval,
            requiresMfa: existing.requiresMfa,
            maxActionsPerRun: existing.maxActionsPerRun,
            configurationKeys: Object.keys(jsonObject(existing.configuration)),
            isActive: existing.isActive,
          },
          this.safeAgentPolicyAudit(agentProfileId, dto),
        );

        return this.mutationResult('agent_policy', {
          id: policyId,
          updatedAt: now,
        });
      }),
    );
  }

  private rlsContext(context: Readonly<OrganisationAccessContext>) {
    return {
      userId: context.userId,
      organisationId: context.organisationId,
      aal: context.aal,
    } as const;
  }

  private async runSafely<T>(
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const code = databaseCode(error);

      if (code === 'P2002' || code === '23505') {
        throw new ConflictException(
          'A configuration record with the same protected identifier already exists.',
        );
      }

      if (
        code === 'P2003' ||
        code === 'P2004' ||
        code === '23503' ||
        code === '23514'
      ) {
        throw new BadRequestException(
          'The configuration conflicts with an active security or workforce dependency.',
        );
      }

      if (code === 'P2025') {
        throw new NotFoundException('Configuration record not found.');
      }

      this.logger.error(
        `Workforce configuration operation failed; operation=${operation}; databaseCode=${code ?? 'unknown'}; errorType=${
          error instanceof Error ? error.name : typeof error
        }`,
      );

      throw new InternalServerErrorException(
        'The workforce configuration operation could not be completed.',
      );
    }
  }

  private assertExpectedTimestamp(
    current: Date,
    expectedValue: string,
  ): void {
    const expected = new Date(expectedValue);

    if (expected.getTime() !== current.getTime()) {
      throw new ConflictException(
        'This configuration was changed by another request. Refresh before saving.',
      );
    }
  }

  private assertExpectedVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictException(
        'This version was changed by another request. Refresh before saving.',
      );
    }
  }

  private assertSingleUpdate(count: number): void {
    if (count !== 1) {
      throw new ConflictException(
        'The configuration changed while it was being saved. Refresh and retry.',
      );
    }
  }

  private mutationResult(
    resource: WorkforceConfigurationMutationResult['resource'],
    value: {
      id: string;
      updatedAt: Date;
      version?: number;
    },
  ): WorkforceConfigurationMutationResult {
    return {
      resource,
      id: value.id,
      version: value.version ?? null,
      updatedAt: value.updatedAt.toISOString(),
    };
  }

  private async writeAudit(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    action: string,
    resourceType: string,
    resourceId: string,
    previousValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    const previousJson =
      previousValue === null ? null : JSON.stringify(previousValue);
    const newJson = newValue === null ? null : JSON.stringify(newValue);

    await transaction.$executeRaw`
      INSERT INTO public.audit_events (
        id,
        organisation_id,
        actor_type,
        actor_user_profile_id,
        subject_user_profile_id,
        source,
        action,
        resource_type,
        resource_id,
        outcome,
        previous_value,
        new_value
      )
      VALUES (
        pg_catalog.gen_random_uuid(),
        ${context.organisationId}::uuid,
        'USER'::public.audit_actor_type,
        ${context.userId}::uuid,
        NULL,
        'businessos-api',
        ${action},
        ${resourceType},
        ${resourceId},
        'SUCCESS'::public.audit_outcome,
        ${previousJson}::jsonb,
        ${newJson}::jsonb
      )
    `;
  }

  private async assertActiveDepartment(
    transaction: Transaction,
    organisationId: string,
    departmentId: string | null,
  ): Promise<void> {
    if (!departmentId) {
      return;
    }

    const department = await transaction.department.findFirst({
      where: {
        id: departmentId,
        organisationId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!department) {
      throw new BadRequestException(
        'The selected department is unavailable.',
      );
    }
  }

  private async assertDepartmentParent(
    transaction: Transaction,
    organisationId: string,
    parentId: string | null,
    currentDepartmentId: string | null,
  ): Promise<void> {
    if (!parentId) {
      return;
    }

    if (parentId === currentDepartmentId) {
      throw new BadRequestException('A department cannot be its own parent.');
    }

    const departments = await transaction.department.findMany({
      where: {
        organisationId,
        deletedAt: null,
      },
      select: {
        id: true,
        parentId: true,
        isActive: true,
      },
    });

    const parentById = new Map(
      departments.map((department) => [department.id, department]),
    );
    const selectedParent = parentById.get(parentId);

    if (!selectedParent?.isActive) {
      throw new BadRequestException(
        'The selected parent department is unavailable.',
      );
    }

    let cursor: string | null = parentId;
    const visited = new Set<string>();

    while (cursor) {
      if (cursor === currentDepartmentId) {
        throw new BadRequestException(
          'The department hierarchy cannot contain a cycle.',
        );
      }

      if (visited.has(cursor)) {
        throw new BadRequestException(
          'The existing department hierarchy contains a cycle.',
        );
      }

      visited.add(cursor);
      cursor = parentById.get(cursor)?.parentId ?? null;
    }
  }

  private async assertDepartmentCanBeArchived(
    transaction: Transaction,
    organisationId: string,
    departmentId: string,
  ): Promise<void> {
    const now = new Date();
    const [
      childDepartments,
      teams,
      jobProfiles,
      kpiDefinitions,
      agentProfiles,
      departmentMemberships,
      roleAssignments,
      workforceAssignments,
      pendingOnboardingPlans,
    ] = await Promise.all([
      transaction.department.count({
        where: {
          organisationId,
          parentId: departmentId,
          isActive: true,
          deletedAt: null,
        },
      }),
      transaction.team.count({
        where: {
          organisationId,
          departmentId,
          isActive: true,
          deletedAt: null,
        },
      }),
      transaction.jobProfile.count({
        where: {
          organisationId,
          departmentId,
          isActive: true,
          deletedAt: null,
        },
      }),
      transaction.kpiDefinition.count({
        where: {
          organisationId,
          departmentId,
          isActive: true,
          deletedAt: null,
        },
      }),
      transaction.agentProfile.count({
        where: {
          organisationId,
          departmentId,
          isActive: true,
          deletedAt: null,
        },
      }),
      transaction.departmentMembership.count({
        where: {
          organisationId,
          departmentId,
          deletedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      }),
      transaction.roleAssignment.count({
        where: {
          organisationId,
          departmentId,
          revokedAt: null,
          deletedAt: null,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
      }),
      transaction.workforceAssignment.count({
        where: {
          organisationId,
          departmentId,
          status: {
            in: [
              WorkforceAssignmentStatus.ACTIVE,
              WorkforceAssignmentStatus.SUSPENDED,
            ],
          },
          deletedAt: null,
        },
      }),
      transaction.invitationOnboardingPlan.count({
        where: {
          organisationId,
          departmentId,
          status: OnboardingPlanStatus.PENDING,
          deletedAt: null,
        },
      }),
    ]);

    if (
      childDepartments +
        teams +
        jobProfiles +
        kpiDefinitions +
        agentProfiles +
        departmentMemberships +
        roleAssignments +
        workforceAssignments +
        pendingOnboardingPlans >
      0
    ) {
      throw new ConflictException(
        'Archive or reassign active department dependencies before archiving this department.',
      );
    }
  }

  private async assertTeamCanBeArchived(
    transaction: Transaction,
    organisationId: string,
    teamId: string,
  ): Promise<void> {
    const now = new Date();
    const [teamMemberships, roleAssignments, workforce, onboarding] =
      await Promise.all([
        transaction.teamMembership.count({
          where: {
            organisationId,
            teamId,
            deletedAt: null,
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        }),
        transaction.roleAssignment.count({
          where: {
            organisationId,
            teamId,
            revokedAt: null,
            deletedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
        }),
        transaction.workforceAssignment.count({
          where: {
            organisationId,
            teamId,
            status: {
              in: [
                WorkforceAssignmentStatus.ACTIVE,
                WorkforceAssignmentStatus.SUSPENDED,
              ],
            },
            deletedAt: null,
          },
        }),
        transaction.invitationOnboardingPlan.count({
          where: {
            organisationId,
            teamId,
            status: OnboardingPlanStatus.PENDING,
            deletedAt: null,
          },
        }),
      ]);

    if (teamMemberships + roleAssignments + workforce + onboarding > 0) {
      throw new ConflictException(
        'End or reassign active team dependencies before archiving this team.',
      );
    }
  }

  private async assertKpiCanBeArchived(
    transaction: Transaction,
    organisationId: string,
    kpiDefinitionId: string,
  ): Promise<void> {
    const now = new Date();
    const [profileAssignments, workforceAssignments, onboardingPlans] =
      await Promise.all([
        transaction.jobProfileKpi.count({
          where: {
            organisationId,
            kpiDefinitionId,
            deletedAt: null,
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        }),
        transaction.workforceAssignmentKpi.count({
          where: {
            organisationId,
            kpiDefinitionId,
            deletedAt: null,
            effectiveFrom: { lte: now },
            isActive: true,
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gt: now } },
            ],
          },
        }),
        transaction.invitationOnboardingKpi.count({
          where: {
            organisationId,
            kpiDefinitionId,
            onboardingPlan: {
              is: {
                status: OnboardingPlanStatus.PENDING,
                deletedAt: null,
              },
            },
          },
        }),
      ]);

    if (profileAssignments + workforceAssignments + onboardingPlans > 0) {
      throw new ConflictException(
        'End active KPI assignments before archiving this KPI definition.',
      );
    }
  }

  private async assertJobProfileCanBeArchived(
    transaction: Transaction,
    organisationId: string,
    jobProfileId: string,
  ): Promise<void> {
    const [workforce, onboarding] = await Promise.all([
      transaction.workforceAssignment.count({
        where: {
          organisationId,
          jobProfileId,
          status: {
            in: [
              WorkforceAssignmentStatus.ACTIVE,
              WorkforceAssignmentStatus.SUSPENDED,
            ],
          },
          deletedAt: null,
        },
      }),
      transaction.invitationOnboardingPlan.count({
        where: {
          organisationId,
          jobProfileId,
          status: OnboardingPlanStatus.PENDING,
          deletedAt: null,
        },
      }),
    ]);

    if (workforce + onboarding > 0) {
      throw new ConflictException(
        'End active assignments and revoke pending onboarding plans before archiving this job profile.',
      );
    }
  }

  private async assertAgentProfileCanBeArchived(
    transaction: Transaction,
    organisationId: string,
    agentProfileId: string,
  ): Promise<void> {
    const [workforce, onboarding] = await Promise.all([
      transaction.workforceAssignment.count({
        where: {
          organisationId,
          agentProfileId,
          status: {
            in: [
              WorkforceAssignmentStatus.ACTIVE,
              WorkforceAssignmentStatus.SUSPENDED,
            ],
          },
          deletedAt: null,
        },
      }),
      transaction.invitationOnboardingPlan.count({
        where: {
          organisationId,
          agentProfileId,
          status: OnboardingPlanStatus.PENDING,
          deletedAt: null,
        },
      }),
    ]);

    if (workforce + onboarding > 0) {
      throw new ConflictException(
        'Remove active workforce and onboarding assignments before archiving this AI profile.',
      );
    }
  }

  private async requireJobProfile(
    transaction: Transaction,
    organisationId: string,
    jobProfileId: string,
  ): Promise<{
    id: string;
    departmentId: string | null;
    version: number;
    isActive: boolean;
  }> {
    const profile = await transaction.jobProfile.findFirst({
      where: {
        id: jobProfileId,
        organisationId,
        deletedAt: null,
      },
      select: {
        id: true,
        departmentId: true,
        version: true,
        isActive: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Job profile not found.');
    }

    return profile;
  }

  private async requireKpiDefinition(
    transaction: Transaction,
    organisationId: string,
    kpiDefinitionId: string,
  ): Promise<{
    id: string;
    departmentId: string | null;
  }> {
    const definition = await transaction.kpiDefinition.findFirst({
      where: {
        id: kpiDefinitionId,
        organisationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        departmentId: true,
      },
    });

    if (!definition) {
      throw new BadRequestException(
        'The selected KPI definition is unavailable.',
      );
    }

    return definition;
  }

  private assertDateWindow(startsAt: Date, endsAt: Date | null): void {
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('The KPI start date is invalid.');
    }

    if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException(
        'The KPI end date must be later than its start date.',
      );
    }
  }

  private async assertKpiWeightLimit(
    transaction: Transaction,
    organisationId: string,
    jobProfileId: string,
    proposedWeight: number,
    startsAt: Date,
    excludedAssignmentId: string | null,
    endsAt: Date | null,
  ): Promise<void> {
    const overlapping = await transaction.jobProfileKpi.findMany({
      where: {
        organisationId,
        jobProfileId,
        deletedAt: null,
        ...(excludedAssignmentId
          ? { id: { not: excludedAssignmentId } }
          : {}),
        ...(endsAt ? { startsAt: { lt: endsAt } } : {}),
        OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }],
      },
      select: {
        startsAt: true,
        endsAt: true,
        weightPercent: true,
      },
    });

    const boundaries = [
      startsAt,
      ...overlapping
        .map((assignment) => assignment.startsAt)
        .filter(
          (boundary) =>
            boundary.getTime() > startsAt.getTime() &&
            (!endsAt || boundary.getTime() < endsAt.getTime()),
        ),
    ];
    const addedWeight = new Prisma.Decimal(proposedWeight);

    for (const boundary of boundaries) {
      const existingWeight = overlapping.reduce(
        (total, assignment) => {
          const activeAtBoundary =
            assignment.startsAt.getTime() <= boundary.getTime() &&
            (!assignment.endsAt ||
              assignment.endsAt.getTime() > boundary.getTime());

          return activeAtBoundary
            ? total.plus(assignment.weightPercent)
            : total;
        },
        new Prisma.Decimal(0),
      );

      if (existingWeight.plus(addedWeight).greaterThan(100)) {
        throw new BadRequestException(
          'Overlapping KPI weights for a job profile cannot exceed 100%.',
        );
      }
    }
  }

  private async bumpJobProfileVersion(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    jobProfileId: string,
    expectedVersion: number,
  ): Promise<void> {
    const update = await transaction.jobProfile.updateMany({
      where: {
        id: jobProfileId,
        organisationId: context.organisationId,
        version: expectedVersion,
        deletedAt: null,
      },
      data: {
        version: { increment: 1 },
        updatedByUserProfileId: context.userId,
        updatedAt: new Date(),
      },
    });

    this.assertSingleUpdate(update.count);
  }

  private assertAgentProfileBoundary(
    authorityCeiling: AgentAuthorityLevel,
    requiresHumanReview: boolean,
  ): void {
    if (
      authorityCeiling === AgentAuthorityLevel.EXECUTE_AUTOMATIC &&
      requiresHumanReview
    ) {
      throw new BadRequestException(
        'Automatic execution cannot also require per-action human review. Use execution with approval instead.',
      );
    }
  }

  private authoritiesAbove(
    ceiling: AgentAuthorityLevel,
  ): AgentAuthorityLevel[] {
    return Object.values(AgentAuthorityLevel).filter(
      (authority) => authorityRank(authority) > authorityRank(ceiling),
    );
  }

  private async requireActiveAgentProfile(
    transaction: Transaction,
    organisationId: string,
    agentProfileId: string,
  ): Promise<{
    id: string;
    authorityCeiling: AgentAuthorityLevel;
    requiresHumanReview: boolean;
    version: number;
  }> {
    const profile = await transaction.agentProfile.findFirst({
      where: {
        id: agentProfileId,
        organisationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        authorityCeiling: true,
        requiresHumanReview: true,
        version: true,
      },
    });

    if (!profile) {
      throw new BadRequestException(
        'AI policies require an active AI-agent profile.',
      );
    }

    return profile;
  }

  private async requireAiPermission(
    transaction: Transaction,
    permissionKey: string,
  ): Promise<{
    key: string;
    dataScope: PermissionDataScope | null;
    requiresMfa: boolean;
  }> {
    const permission = await transaction.permission.findFirst({
      where: {
        key: permissionKey,
        allowsAiUse: true,
        isActive: true,
        deletedAt: null,
      },
      select: {
        key: true,
        dataScope: true,
        requiresMfa: true,
      },
    });

    if (!permission) {
      throw new BadRequestException(
        'The selected permission is not approved for AI use.',
      );
    }

    return permission;
  }

  private assertAgentPolicyBoundary(
    profile: {
      authorityCeiling: AgentAuthorityLevel;
      requiresHumanReview: boolean;
    },
    permission: {
      dataScope: PermissionDataScope | null;
      requiresMfa: boolean;
    },
    policy: {
      authorityLevel: AgentAuthorityLevel;
      maximumDataScope: PermissionDataScope;
      requiresApproval: boolean;
      requiresMfa: boolean;
    },
  ): void {
    if (
      authorityRank(policy.authorityLevel) >
      authorityRank(profile.authorityCeiling)
    ) {
      throw new BadRequestException(
        'The policy authority exceeds the AI-agent profile ceiling.',
      );
    }

    if (
      policy.authorityLevel === AgentAuthorityLevel.EXECUTE_WITH_APPROVAL &&
      !policy.requiresApproval
    ) {
      throw new BadRequestException(
        'Execution-with-approval policies must require approval.',
      );
    }

    if (
      policy.authorityLevel === AgentAuthorityLevel.EXECUTE_AUTOMATIC &&
      policy.requiresApproval
    ) {
      throw new BadRequestException(
        'Automatic-execution policies cannot require per-action approval.',
      );
    }

    if (
      policy.authorityLevel === AgentAuthorityLevel.EXECUTE_AUTOMATIC &&
      profile.requiresHumanReview
    ) {
      throw new BadRequestException(
        'This AI-agent profile requires human review and cannot execute automatically.',
      );
    }

    if (policy.maximumDataScope === PermissionDataScope.PLATFORM) {
      throw new BadRequestException(
        'Organisation AI agents cannot be granted platform-wide data scope.',
      );
    }

    if (
      permission.dataScope &&
      !scopeIsWithin(policy.maximumDataScope, permission.dataScope)
    ) {
      throw new BadRequestException(
        'The policy data scope exceeds the selected permission scope.',
      );
    }

    if (permission.requiresMfa && !policy.requiresMfa) {
      throw new BadRequestException(
        'The policy cannot weaken the selected permission MFA requirement.',
      );
    }
  }

  private assertConfigurationSize(configuration: Record<string, unknown>): void {
    try {
      const serialised = JSON.stringify(configuration);

      if (
        !serialised ||
        Buffer.byteLength(serialised, 'utf8') > CONFIGURATION_JSON_MAX_BYTES
      ) {
        throw new BadRequestException(
          'AI policy configuration must not exceed 16 KiB.',
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        'AI policy configuration must be a valid JSON object.',
      );
    }
  }

  private toJsonConfiguration(
    configuration: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    try {
      const parsed: unknown = JSON.parse(JSON.stringify(configuration));

      if (!isRecord(parsed)) {
        throw new Error('Configuration is not a JSON object.');
      }

      return parsed as Prisma.InputJsonObject;
    } catch {
      throw new BadRequestException(
        'AI policy configuration must be a valid JSON object.',
      );
    }
  }

  private safeAgentPolicyAudit(
    agentProfileId: string,
    policy: {
      toolKey?: string;
      requiredPermissionKey: string;
      authorityLevel: AgentAuthorityLevel;
      maximumDataScope: PermissionDataScope;
      requiresApproval: boolean;
      requiresMfa: boolean;
      maxActionsPerRun: number;
      configuration?: Record<string, unknown>;
      isActive?: boolean;
    },
  ): Record<string, unknown> {
    return {
      agentProfileId,
      ...(policy.toolKey ? { toolKey: policy.toolKey } : {}),
      requiredPermissionKey: policy.requiredPermissionKey,
      authorityLevel: policy.authorityLevel,
      maximumDataScope: policy.maximumDataScope,
      requiresApproval: policy.requiresApproval,
      requiresMfa: policy.requiresMfa,
      maxActionsPerRun: policy.maxActionsPerRun,
      configurationKeys: Object.keys(policy.configuration ?? {}).sort(),
      isActive: policy.isActive ?? true,
    };
  }

  private async bumpAgentProfileVersion(
    transaction: Transaction,
    context: Readonly<OrganisationAccessContext>,
    agentProfileId: string,
    expectedVersion: number,
  ): Promise<void> {
    const update = await transaction.agentProfile.updateMany({
      where: {
        id: agentProfileId,
        organisationId: context.organisationId,
        version: expectedVersion,
        deletedAt: null,
      },
      data: {
        version: { increment: 1 },
        updatedByUserProfileId: context.userId,
        updatedAt: new Date(),
      },
    });

    this.assertSingleUpdate(update.count);
  }
}