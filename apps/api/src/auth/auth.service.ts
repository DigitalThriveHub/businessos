import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JWTPayload } from 'jose';
import {
  MembershipStatus,
  OrganisationStatus,
  UserProfileStatus,
} from '../generated/prisma/enums';
import { RlsTransactionService } from '../database/rls-transaction.service';
import {
  resolveAssuranceLevel,
  verifyUserJwtPayload,
} from './verified-jwt-payload';

export interface CurrentUserOrganisation {
  organisationId: string;
  membershipId: string;
  organisationName: string;
  organisationSlug: string;
  organisationStatus: OrganisationStatus;
  jobTitle: string | null;
  roles: string[];
  permissions: string[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly rls: RlsTransactionService,
  ) {}

  async getCurrentUser(
    tokenUser: JWTPayload | undefined,
  ) {
    const verifiedUser = verifyUserJwtPayload(tokenUser);
    const userId = verifiedUser.sub;
    const aal = resolveAssuranceLevel(verifiedUser);
    const now = new Date();

    const profile = await this.rls.run(
      {
        userId,
        aal,
      },
      (transaction) =>
        transaction.userProfile.findUnique({
          where: {
            id: userId,
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true,
            status: true,
            deletedAt: true,
            organisationMemberships: {
              where: {
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                organisation: {
                  status: {
                    in: [
                      OrganisationStatus.PROVISIONING,
                      OrganisationStatus.ACTIVE,
                    ],
                  },
                  deletedAt: null,
                },
              },
              select: {
                id: true,
                organisationId: true,
                jobTitle: true,
                organisation: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    status: true,
                  },
                },
              },
            },
          },
        }),
    );

    if (!profile) {
      return {
        id: userId,
        email: optionalString(verifiedUser.email),
        authenticated: true,
        onboardingRequired: true,
        organisations: [] as CurrentUserOrganisation[],
      };
    }

    if (
      profile.status !== UserProfileStatus.ACTIVE ||
      profile.deletedAt !== null
    ) {
      throw new ForbiddenException(
        'Account access is unavailable',
      );
    }

    const organisations: CurrentUserOrganisation[] = [];

    for (const membership of profile.organisationMemberships) {
      const assignments = await this.rls.run(
        {
          userId,
          organisationId: membership.organisationId,
          aal,
        },
        (transaction) =>
          transaction.roleAssignment.findMany({
            where: {
              userProfileId: userId,
              organisationId: membership.organisationId,
              organisationMembershipId: membership.id,
              revokedAt: null,
              deletedAt: null,
              validFrom: {
                lte: now,
              },
              OR: [
                {
                  validUntil: null,
                },
                {
                  validUntil: {
                    gt: now,
                  },
                },
              ],
              role: {
                organisationId: membership.organisationId,
                deletedAt: null,
              },
            },
            select: {
              role: {
                select: {
                  key: true,
                  permissions: {
                    where: {
                      permission: {
                        isActive: true,
                        deletedAt: null,
                      },
                    },
                    select: {
                      permission: {
                        select: {
                          key: true,
                          requiresMfa: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
      );

      const roles = [
        ...new Set(
          assignments.map(
            (assignment) => assignment.role.key,
          ),
        ),
      ].sort();

      const permissions = [
        ...new Set(
          assignments.flatMap((assignment) =>
            assignment.role.permissions
              .filter(
                ({ permission }) =>
                  !permission.requiresMfa ||
                  aal === 'AAL2',
              )
              .map(({ permission }) => permission.key),
          ),
        ),
      ].sort();

      organisations.push({
        organisationId: membership.organisationId,
        membershipId: membership.id,
        organisationName: membership.organisation.name,
        organisationSlug: membership.organisation.slug,
        organisationStatus: membership.organisation.status,
        jobTitle: membership.jobTitle,
        roles,
        permissions,
      });
    }

    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      status: profile.status,
      authenticated: true,
      onboardingRequired: false,
      organisations,
    };
  }
}