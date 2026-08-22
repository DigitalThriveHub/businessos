import { Injectable } from '@nestjs/common';

import type { OrganisationAccessContext } from '../auth/request-security-context';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  MembershipStatus,
  RoleScope,
  UserProfileStatus,
} from '../generated/prisma/enums';

export interface InvitationJobProfileOption {
  id: string;
  key: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  isManagerial: boolean;
  activeDutyCount: number;
  activeKpiCount: number;
}

export interface InvitationDepartmentOption {
  id: string;
  name: string;
  code: string | null;
}

export interface InvitationTeamOption {
  id: string;
  departmentId: string | null;
  name: string;
  code: string | null;
}

export interface InvitationManagerOption {
  organisationMembershipId: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
}

export interface InvitationAgentProfileOption {
  id: string;
  key: string;
  name: string;
  description: string;
  departmentId: string | null;
  authorityCeiling: string;
  requiresHumanReview: boolean;
}

export interface InvitationWorkforceOptionsView {
  configurationReady: boolean;
  assignableRoleCount: number;
  jobProfiles: InvitationJobProfileOption[];
  departments: InvitationDepartmentOption[];
  teams: InvitationTeamOption[];
  managers: InvitationManagerOption[];
  agentProfiles: InvitationAgentProfileOption[];
}

function managerDisplayName(userProfile: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const displayName = userProfile.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  const fullName = [userProfile.firstName, userProfile.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return fullName || userProfile.email;
}

@Injectable()
export class InvitationWorkforceOptionsService {
  constructor(private readonly rls: RlsTransactionService) {}

  async findAll(
    context: Readonly<OrganisationAccessContext>,
  ): Promise<InvitationWorkforceOptionsView> {
    const now = new Date();

    const result = await this.rls.run(
      {
        userId: context.userId,
        organisationId: context.organisationId,
        aal: context.aal,
      },
      async (transaction) => {
        const [
          jobProfiles,
          departments,
          teams,
          managers,
          agentProfiles,
          assignableRoleCount,
        ] = await Promise.all([
          transaction.jobProfile.findMany({
            where: {
              organisationId: context.organisationId,
              isActive: true,
              deletedAt: null,
            },
            select: {
              id: true,
              key: true,
              name: true,
              description: true,
              departmentId: true,
              isManagerial: true,
              duties: {
                where: {
                  isActive: true,
                  deletedAt: null,
                },
                select: { id: true },
              },
              kpis: {
                where: {
                  deletedAt: null,
                  startsAt: { lte: now },
                  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
                  kpiDefinition: {
                    is: {
                      isActive: true,
                      deletedAt: null,
                    },
                  },
                },
                select: { id: true },
              },
            },
            orderBy: [{ name: 'asc' }, { key: 'asc' }],
          }),
          transaction.department.findMany({
            where: {
              organisationId: context.organisationId,
              isActive: true,
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
              code: true,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          }),
          transaction.team.findMany({
            where: {
              organisationId: context.organisationId,
              isActive: true,
              deletedAt: null,
            },
            select: {
              id: true,
              departmentId: true,
              name: true,
              code: true,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          }),
          transaction.organisationMembership.findMany({
            where: {
              organisationId: context.organisationId,
              status: MembershipStatus.ACTIVE,
              deletedAt: null,
              userProfile: {
                status: UserProfileStatus.ACTIVE,
                deletedAt: null,
              },
            },
            select: {
              id: true,
              jobTitle: true,
              userProfile: {
                select: {
                  displayName: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          transaction.agentProfile.findMany({
            where: {
              organisationId: context.organisationId,
              isActive: true,
              deletedAt: null,
            },
            select: {
              id: true,
              key: true,
              name: true,
              description: true,
              departmentId: true,
              authorityCeiling: true,
              requiresHumanReview: true,
            },
            orderBy: [{ name: 'asc' }, { key: 'asc' }],
          }),
          transaction.role.count({
            where: {
              organisationId: context.organisationId,
              scope: {
                in: [
                  RoleScope.ORGANISATION,
                  RoleScope.DEPARTMENT,
                  RoleScope.TEAM,
                ],
              },
              isAssignable: true,
              deletedAt: null,
              key: { not: 'organisation_owner' },
            },
          }),
        ]);

        return {
          jobProfiles,
          departments,
          teams,
          managers,
          agentProfiles,
          assignableRoleCount,
        };
      },
    );

    const managers = result.managers
      .map((membership) => ({
        organisationMembershipId: membership.id,
        displayName: managerDisplayName(membership.userProfile),
        email: membership.userProfile.email,
        jobTitle: membership.jobTitle,
      }))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, 'en-GB', {
          sensitivity: 'base',
        }),
      );

    const jobProfiles = result.jobProfiles.map((profile) => ({
      id: profile.id,
      key: profile.key,
      name: profile.name,
      description: profile.description,
      departmentId: profile.departmentId,
      isManagerial: profile.isManagerial,
      activeDutyCount: profile.duties.length,
      activeKpiCount: profile.kpis.length,
    }));

    return {
      configurationReady:
        jobProfiles.length > 0 && result.assignableRoleCount > 0,
      assignableRoleCount: result.assignableRoleCount,
      jobProfiles,
      departments: result.departments,
      teams: result.teams,
      managers,
      agentProfiles: result.agentProfiles.map((profile) => ({
        ...profile,
        authorityCeiling: profile.authorityCeiling.toString(),
      })),
    };
  }
}