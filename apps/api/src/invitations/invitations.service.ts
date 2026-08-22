import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import type { Environment } from '../config/env.validation';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { Prisma } from '../generated/prisma/client';
import {
  AssignmentScope,
  InvitationStatus,
  MembershipStatus,
  OnboardingPlanStatus,
  RoleScope,
  UserProfileStatus,
} from '../generated/prisma/enums';
import { EmailService } from '../notifications/email.service';
import { CreateOrganisationInvitationDto } from './dto/create-organisation-invitation.dto';
import { InvitationTokenService } from './invitation-token.service';

type DeliveryStatus = 'QUEUED' | 'SENT' | 'FAILED';

type InvitationRecord = {
  id: string;
  organisationId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

type InvitationOnboardingMetadata = {
  planId: string;
  jobProfileId: string;
  departmentId: string | null;
  teamId: string | null;
  managerOrganisationMembershipId: string | null;
  agentProfileId: string | null;
  startsAt: string;
  isDepartmentManager: boolean;
  isTeamLead: boolean;
};

type InvitationMetadata = {
  roleKeys: string[];
  jobTitle: string | null;
  deliveryStatus: DeliveryStatus;
  providerMessageId: string | null;
  onboarding: InvitationOnboardingMetadata | null;
};

export interface OrganisationInvitationView {
  id: string;
  organisationId: string;
  email: string;
  status: InvitationStatus;
  roleKeys: string[];
  jobTitle: string | null;
  deliveryStatus: DeliveryStatus;
  onboardingPlanId: string | null;
  jobProfileId: string | null;
  departmentId: string | null;
  teamId: string | null;
  managerOrganisationMembershipId: string | null;
  agentProfileId: string | null;
  startsAt: string | null;
  isDepartmentManager: boolean;
  isTeamLead: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationInvitationList {
  items: OrganisationInvitationView[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOnboardingMetadata(
  value: unknown,
): InvitationOnboardingMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const planId = nullableString(value.planId);
  const jobProfileId = nullableString(value.jobProfileId);
  const startsAt = nullableString(value.startsAt);

  if (!planId || !jobProfileId || !startsAt) {
    return null;
  }

  return {
    planId,
    jobProfileId,
    departmentId: nullableString(value.departmentId),
    teamId: nullableString(value.teamId),
    managerOrganisationMembershipId: nullableString(
      value.managerOrganisationMembershipId,
    ),
    agentProfileId: nullableString(value.agentProfileId),
    startsAt,
    isDepartmentManager: value.isDepartmentManager === true,
    isTeamLead: value.isTeamLead === true,
  };
}

function readMetadata(value: unknown): InvitationMetadata {
  if (!isRecord(value)) {
    return {
      roleKeys: [],
      jobTitle: null,
      deliveryStatus: 'QUEUED',
      providerMessageId: null,
      onboarding: null,
    };
  }

  const roleKeys = Array.isArray(value.roleKeys)
    ? value.roleKeys.filter(
        (roleKey): roleKey is string => typeof roleKey === 'string',
      )
    : [];

  const delivery = isRecord(value.delivery) ? value.delivery : {};
  const deliveryStatus =
    delivery.status === 'SENT' || delivery.status === 'FAILED'
      ? delivery.status
      : 'QUEUED';

  return {
    roleKeys,
    jobTitle: nullableString(value.jobTitle),
    deliveryStatus,
    providerMessageId: nullableString(delivery.providerMessageId),
    onboarding: readOnboardingMetadata(value.onboarding),
  };
}

function buildMetadata({
  roleKeys,
  jobTitle,
  deliveryStatus,
  providerMessageId,
  onboarding,
}: InvitationMetadata): Prisma.JsonObject {
  const delivery: Prisma.JsonObject = {
    status: deliveryStatus,
    providerMessageId,
  };

  const onboardingValue: Prisma.JsonObject | null = onboarding
    ? {
        planId: onboarding.planId,
        jobProfileId: onboarding.jobProfileId,
        departmentId: onboarding.departmentId,
        teamId: onboarding.teamId,
        managerOrganisationMembershipId:
          onboarding.managerOrganisationMembershipId,
        agentProfileId: onboarding.agentProfileId,
        startsAt: onboarding.startsAt,
        isDepartmentManager: onboarding.isDepartmentManager,
        isTeamLead: onboarding.isTeamLead,
      }
    : null;

  return {
    schemaVersion: 2,
    roleKeys,
    jobTitle,
    onboarding: onboardingValue,
    delivery,
  };
}

function effectiveStatus(invitation: InvitationRecord): InvitationStatus {
  if (
    invitation.status === InvitationStatus.PENDING &&
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    return InvitationStatus.EXPIRED;
  }

  return invitation.status;
}

function toInvitationView(
  invitation: InvitationRecord,
): OrganisationInvitationView {
  const metadata = readMetadata(invitation.metadata);
  const onboarding = metadata.onboarding;

  return {
    id: invitation.id,
    organisationId: invitation.organisationId,
    email: invitation.email,
    status: effectiveStatus(invitation),
    roleKeys: metadata.roleKeys,
    jobTitle: metadata.jobTitle,
    deliveryStatus: metadata.deliveryStatus,
    onboardingPlanId: onboarding?.planId ?? null,
    jobProfileId: onboarding?.jobProfileId ?? null,
    departmentId: onboarding?.departmentId ?? null,
    teamId: onboarding?.teamId ?? null,
    managerOrganisationMembershipId:
      onboarding?.managerOrganisationMembershipId ?? null,
    agentProfileId: onboarding?.agentProfileId ?? null,
    startsAt: onboarding?.startsAt ?? null,
    isDepartmentManager: onboarding?.isDepartmentManager ?? false,
    isTeamLead: onboarding?.isTeamLead ?? false,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
    revocationReason: invitation.revocationReason,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
  };
}

function parseStartsAt(value: string | undefined, now: Date): Date {
  if (!value) {
    return now;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new BadRequestException('The employment start date is invalid.');
  }

  return new Date(timestamp);
}

function toAssignmentScope(scope: RoleScope): AssignmentScope {
  switch (scope) {
    case RoleScope.ORGANISATION:
      return AssignmentScope.ORGANISATION;
    case RoleScope.DEPARTMENT:
      return AssignmentScope.DEPARTMENT;
    case RoleScope.TEAM:
      return AssignmentScope.TEAM;
    default:
      throw new BadRequestException(
        'A platform role cannot be assigned through an organisation invitation.',
      );
  }
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly rls: RlsTransactionService,
    private readonly tokens: InvitationTokenService,
    private readonly emails: EmailService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async create(
    dto: CreateOrganisationInvitationDto,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<OrganisationInvitationView> {
    const now = new Date();
    const startsAt = parseStartsAt(dto.startsAt, now);
    const ttlHours =
      this.config.get('INVITATION_TTL_HOURS', { infer: true }) ?? 72;
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1_000);

    const roleKeys = dto.roleKeys
      .map((roleKey) => roleKey.trim().toLowerCase())
      .sort();

    if (roleKeys.length === 0 || new Set(roleKeys).size !== roleKeys.length) {
      throw new BadRequestException('At least one unique role is required.');
    }

    const issuedToken = this.tokens.issue();

    const created = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      async (transaction) => {
        const inviter = await transaction.userProfile.findFirst({
          where: {
            id: context.userId,
            status: UserProfileStatus.ACTIVE,
            deletedAt: null,
          },
          select: {
            displayName: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        });

        if (!inviter) {
          throw new ForbiddenException('The inviting account is unavailable.');
        }

        const organisation = await transaction.organisation.findFirst({
          where: {
            id: context.organisationId,
            deletedAt: null,
          },
          select: {
            name: true,
          },
        });

        if (!organisation) {
          throw new NotFoundException('Organisation not found.');
        }

        const existingMembership =
          await transaction.organisationMembership.findFirst({
            where: {
              organisationId: context.organisationId,
              deletedAt: null,
              userProfile: {
                email: {
                  equals: dto.email,
                  mode: 'insensitive',
                },
                deletedAt: null,
              },
            },
            select: { id: true },
          });

        if (existingMembership) {
          throw new ConflictException(
            'This person already belongs to the organisation.',
          );
        }

        const existingInvitation = await transaction.invitation.findFirst({
          where: {
            organisationId: context.organisationId,
            email: {
              equals: dto.email,
              mode: 'insensitive',
            },
            status: InvitationStatus.PENDING,
            expiresAt: { gt: now },
            deletedAt: null,
          },
          select: { id: true },
        });

        if (existingInvitation) {
          throw new ConflictException(
            'An active invitation already exists for this email address.',
          );
        }

        const roles = await transaction.role.findMany({
          where: {
            organisationId: context.organisationId,
            key: { in: roleKeys },
            isAssignable: true,
            deletedAt: null,
          },
          select: {
            id: true,
            key: true,
            scope: true,
          },
        });

        const resolvedRoleKeys = roles.map((role) => role.key).sort();

        if (
          resolvedRoleKeys.length !== roleKeys.length ||
          resolvedRoleKeys.some((roleKey, index) => roleKey !== roleKeys[index])
        ) {
          throw new BadRequestException(
            'One or more selected roles cannot be assigned.',
          );
        }

        const jobProfile = await transaction.jobProfile.findFirst({
          where: {
            id: dto.jobProfileId,
            organisationId: context.organisationId,
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            departmentId: true,
            isManagerial: true,
            kpis: {
              where: {
                deletedAt: null,
                startsAt: { lte: startsAt },
                OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }],
                kpiDefinition: {
                  is: {
                    isActive: true,
                    deletedAt: null,
                  },
                },
              },
              select: {
                id: true,
                kpiDefinitionId: true,
                targetValue: true,
                minimumValue: true,
                maximumValue: true,
                weightPercent: true,
              },
            },
          },
        });

        if (!jobProfile) {
          throw new BadRequestException(
            'The selected job profile is unavailable.',
          );
        }

        const team = dto.teamId
          ? await transaction.team.findFirst({
              where: {
                id: dto.teamId,
                organisationId: context.organisationId,
                isActive: true,
                deletedAt: null,
              },
              select: {
                id: true,
                departmentId: true,
              },
            })
          : null;

        if (dto.teamId && !team) {
          throw new BadRequestException('The selected team is unavailable.');
        }

        const requestedDepartmentId = dto.departmentId ?? null;
        const profileDepartmentId = jobProfile.departmentId;

        if (
          requestedDepartmentId &&
          profileDepartmentId &&
          requestedDepartmentId !== profileDepartmentId
        ) {
          throw new BadRequestException(
            'The selected department does not match the job profile.',
          );
        }

        const resolvedDepartmentId =
          requestedDepartmentId ??
          profileDepartmentId ??
          team?.departmentId ??
          null;

        if (team && team.departmentId !== resolvedDepartmentId) {
          throw new BadRequestException(
            'The selected team does not belong to the selected department.',
          );
        }

        if (resolvedDepartmentId) {
          const department = await transaction.department.findFirst({
            where: {
              id: resolvedDepartmentId,
              organisationId: context.organisationId,
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

        const isDepartmentManager = dto.isDepartmentManager === true;
        const isTeamLead = dto.isTeamLead === true;

        if (isDepartmentManager && !resolvedDepartmentId) {
          throw new BadRequestException(
            'A department is required for a department manager.',
          );
        }

        if (isTeamLead && !team) {
          throw new BadRequestException('A team is required for a team lead.');
        }

        if ((isDepartmentManager || isTeamLead) && !jobProfile.isManagerial) {
          throw new BadRequestException(
            'The selected job profile is not approved for management duties.',
          );
        }

        for (const role of roles) {
          if (role.scope === RoleScope.DEPARTMENT && !resolvedDepartmentId) {
            throw new BadRequestException(
              `Role ${role.key} requires a department.`,
            );
          }

          if (role.scope === RoleScope.TEAM && !team) {
            throw new BadRequestException(`Role ${role.key} requires a team.`);
          }

          if (role.scope === RoleScope.PLATFORM) {
            throw new BadRequestException(
              'Platform roles cannot be assigned through an organisation invitation.',
            );
          }
        }

        if (dto.managerOrganisationMembershipId) {
          const manager = await transaction.organisationMembership.findFirst({
            where: {
              id: dto.managerOrganisationMembershipId,
              organisationId: context.organisationId,
              status: MembershipStatus.ACTIVE,
              deletedAt: null,
            },
            select: { id: true },
          });

          if (!manager) {
            throw new BadRequestException(
              'The selected reporting manager is unavailable.',
            );
          }
        }

        if (dto.agentProfileId) {
          const agentProfile = await transaction.agentProfile.findFirst({
            where: {
              id: dto.agentProfileId,
              organisationId: context.organisationId,
              isActive: true,
              deletedAt: null,
            },
            select: {
              id: true,
              departmentId: true,
            },
          });

          if (!agentProfile) {
            throw new BadRequestException(
              'The selected AI-agent profile is unavailable.',
            );
          }

          if (
            agentProfile.departmentId &&
            agentProfile.departmentId !== resolvedDepartmentId
          ) {
            throw new BadRequestException(
              'The selected AI-agent profile is restricted to another department.',
            );
          }
        }

        const jobTitle = dto.jobTitle?.trim() || jobProfile.name;

        const invitation = await transaction.invitation.create({
          data: {
            organisationId: context.organisationId,
            email: dto.email,
            tokenHash: issuedToken.tokenHash,
            status: InvitationStatus.PENDING,
            invitedByUserProfileId: context.userId,
            expiresAt,
          },
          select: { id: true },
        });

        const onboardingPlan =
          await transaction.invitationOnboardingPlan.create({
            data: {
              organisationId: context.organisationId,
              invitationId: invitation.id,
              jobProfileId: jobProfile.id,
              departmentId: resolvedDepartmentId,
              teamId: team?.id ?? null,
              managerOrganisationMembershipId:
                dto.managerOrganisationMembershipId ?? null,
              agentProfileId: dto.agentProfileId ?? null,
              jobTitle,
              isDepartmentManager,
              isTeamLead,
              startsAt,
              createdByUserProfileId: context.userId,
            },
            select: { id: true },
          });

        await transaction.invitationOnboardingRole.createMany({
          data: roles.map((role) => {
            const scope = toAssignmentScope(role.scope);

            return {
              organisationId: context.organisationId,
              onboardingPlanId: onboardingPlan.id,
              roleId: role.id,
              scope,
              departmentId:
                scope === AssignmentScope.DEPARTMENT
                  ? resolvedDepartmentId
                  : null,
              teamId:
                scope === AssignmentScope.TEAM ? (team?.id ?? null) : null,
            };
          }),
        });

        if (jobProfile.kpis.length > 0) {
          await transaction.invitationOnboardingKpi.createMany({
            data: jobProfile.kpis.map((kpi) => ({
              organisationId: context.organisationId,
              onboardingPlanId: onboardingPlan.id,
              kpiDefinitionId: kpi.kpiDefinitionId,
              sourceJobProfileKpiId: kpi.id,
              targetValue: kpi.targetValue,
              minimumValue: kpi.minimumValue,
              maximumValue: kpi.maximumValue,
              weightPercent: kpi.weightPercent,
            })),
          });
        }

        const onboarding: InvitationOnboardingMetadata = {
          planId: onboardingPlan.id,
          jobProfileId: jobProfile.id,
          departmentId: resolvedDepartmentId,
          teamId: team?.id ?? null,
          managerOrganisationMembershipId:
            dto.managerOrganisationMembershipId ?? null,
          agentProfileId: dto.agentProfileId ?? null,
          startsAt: startsAt.toISOString(),
          isDepartmentManager,
          isTeamLead,
        };

        const queuedMetadata = buildMetadata({
          roleKeys,
          jobTitle,
          deliveryStatus: 'QUEUED',
          providerMessageId: null,
          onboarding,
        });

        const persistedInvitation = await transaction.invitation.update({
          where: { id: invitation.id },
          data: { metadata: queuedMetadata },
          select: {
            id: true,
            organisationId: true,
            email: true,
            status: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            revocationReason: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        const inviterName =
          inviter.displayName?.trim() ||
          [inviter.firstName, inviter.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          inviter.email;

        const auditValue = JSON.stringify({
          email: dto.email,
          roleKeys,
          jobTitle,
          onboardingPlanId: onboardingPlan.id,
          jobProfileId: jobProfile.id,
          departmentId: resolvedDepartmentId,
          teamId: team?.id ?? null,
          managerOrganisationMembershipId:
            dto.managerOrganisationMembershipId ?? null,
          agentProfileId: dto.agentProfileId ?? null,
          startsAt: startsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });

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
            'organisation_invitation.created',
            'invitation',
            ${persistedInvitation.id},
            'SUCCESS'::public.audit_outcome,
            NULL,
            ${auditValue}::jsonb
          )
        `;

        return {
          invitation: persistedInvitation,
          inviterName,
          organisationName: organisation.name,
          onboarding,
          jobTitle,
        };
      },
    );

    try {
      const delivery = await this.emails.sendOrganisationInvitation({
        invitationId: created.invitation.id,
        recipientEmail: created.invitation.email,
        organisationName: created.organisationName,
        inviterName: created.inviterName,
        invitationToken: issuedToken.token,
        expiresAt,
      });

      const sentMetadata = buildMetadata({
        roleKeys,
        jobTitle: created.jobTitle,
        deliveryStatus: 'SENT',
        providerMessageId: delivery.messageId,
        onboarding: created.onboarding,
      });

      await this.tryPersistDeliveryMetadata(
        created.invitation.id,
        sentMetadata,
        context,
      );

      return toInvitationView({
        ...created.invitation,
        metadata: sentMetadata,
      });
    } catch (error) {
      const failedMetadata = buildMetadata({
        roleKeys,
        jobTitle: created.jobTitle,
        deliveryStatus: 'FAILED',
        providerMessageId: null,
        onboarding: created.onboarding,
      });

      await this.tryPersistDeliveryMetadata(
        created.invitation.id,
        failedMetadata,
        context,
      );

      throw error;
    }
  }

  async findAll(
    context: Readonly<OrganisationAccessContext>,
    page = 1,
    limit = 50,
  ): Promise<OrganisationInvitationList> {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException('Invalid invitation pagination.');
    }

    const result = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      async (transaction) => {
        const where = {
          organisationId: context.organisationId,
          deletedAt: null,
        };

        const [items, total] = await Promise.all([
          transaction.invitation.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            select: {
              id: true,
              organisationId: true,
              email: true,
              status: true,
              expiresAt: true,
              acceptedAt: true,
              revokedAt: true,
              revocationReason: true,
              metadata: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          transaction.invitation.count({ where }),
        ]);

        return { items, total };
      },
    );

    return {
      items: result.items.map(toInvitationView),
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  async revoke(
    invitationId: string,
    reason: string,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<OrganisationInvitationView> {
    const normalisedReason = reason.trim();

    if (!normalisedReason || normalisedReason.length > 500) {
      throw new BadRequestException(
        'A revocation reason of 1–500 characters is required.',
      );
    }

    const now = new Date();

    return this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      async (transaction) => {
        const existing = await transaction.invitation.findFirst({
          where: {
            id: invitationId,
            organisationId: context.organisationId,
            deletedAt: null,
          },
          select: {
            id: true,
            organisationId: true,
            email: true,
            status: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            revocationReason: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!existing) {
          throw new NotFoundException('Invitation not found.');
        }

        if (
          existing.status !== InvitationStatus.PENDING ||
          existing.expiresAt.getTime() <= now.getTime()
        ) {
          throw new ConflictException(
            'Only an active pending invitation can be revoked.',
          );
        }

        const updateResult = await transaction.invitation.updateMany({
          where: {
            id: invitationId,
            organisationId: context.organisationId,
            status: InvitationStatus.PENDING,
            deletedAt: null,
          },
          data: {
            status: InvitationStatus.REVOKED,
            revokedByUserProfileId: context.userId,
            revokedAt: now,
            revocationReason: normalisedReason,
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException(
            'The invitation was changed by another request.',
          );
        }

        await transaction.invitationOnboardingPlan.updateMany({
          where: {
            invitationId,
            organisationId: context.organisationId,
            status: OnboardingPlanStatus.PENDING,
            deletedAt: null,
          },
          data: {
            status: OnboardingPlanStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: normalisedReason,
          },
        });

        const updated = await transaction.invitation.findFirst({
          where: {
            id: invitationId,
            organisationId: context.organisationId,
          },
          select: {
            id: true,
            organisationId: true,
            email: true,
            status: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            revocationReason: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!updated) {
          throw new NotFoundException('Invitation not found.');
        }

        const previousValue = JSON.stringify({ status: existing.status });
        const newValue = JSON.stringify({
          status: updated.status,
          revokedAt: updated.revokedAt?.toISOString(),
          reason: normalisedReason,
          onboardingPlanStatus: OnboardingPlanStatus.CANCELLED,
        });

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
            'organisation_invitation.revoked',
            'invitation',
            ${invitationId},
            'SUCCESS'::public.audit_outcome,
            ${previousValue}::jsonb,
            ${newValue}::jsonb
          )
        `;

        return toInvitationView(updated);
      },
    );
  }

  private async tryPersistDeliveryMetadata(
    invitationId: string,
    metadata: Prisma.JsonObject,
    context: Readonly<OrganisationAccessContext>,
  ): Promise<void> {
    try {
      const delivery = readMetadata(metadata);

      await this.rls.run(
        {
          userId: context.userId,
          organisationId: context.organisationId,
          aal: context.aal,
        },
        async (transaction) => {
          const result = await transaction.invitation.updateMany({
            where: {
              id: invitationId,
              organisationId: context.organisationId,
              status: InvitationStatus.PENDING,
              deletedAt: null,
            },
            data: { metadata },
          });

          if (result.count !== 1) {
            this.logger.error(
              `Could not persist delivery state for invitation ${invitationId}`,
            );
            return;
          }

          const auditValue = JSON.stringify({
            status: delivery.deliveryStatus,
            providerMessageId: delivery.providerMessageId,
          });

          await transaction.$executeRaw`
            INSERT INTO public.audit_events (
              id,
              organisation_id,
              actor_type,
              actor_user_profile_id,
              source,
              action,
              resource_type,
              resource_id,
              outcome,
              new_value
            )
            VALUES (
              pg_catalog.gen_random_uuid(),
              ${context.organisationId}::uuid,
              'SERVICE'::public.audit_actor_type,
              NULL,
              'businessos-api',
              ${
                delivery.deliveryStatus === 'SENT'
                  ? 'organisation_invitation.delivery_sent'
                  : 'organisation_invitation.delivery_failed'
              },
              'invitation',
              ${invitationId},
              ${
                delivery.deliveryStatus === 'SENT' ? 'SUCCESS' : 'FAILURE'
              }::public.audit_outcome,
              ${auditValue}::jsonb
            )
          `;
        },
      );
    } catch {
      this.logger.error(
        `Could not persist delivery state for invitation ${invitationId}`,
      );
    }
  }
}