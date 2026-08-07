import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentUser(tokenUser: JWTPayload) {
    if (!tokenUser.sub) {
      throw new UnauthorizedException('Token has no user ID');
    }

    const now = new Date();

    const profile = await this.prisma.userProfile.findUnique({
      where: {
        id: tokenUser.sub,
      },
      include: {
        organisationMemberships: {
          where: {
            status: 'ACTIVE',
            deletedAt: null,
          },
          include: {
            organisation: true,
            roleAssignments: {
              where: {
                revokedAt: null,
                deletedAt: null,
                validFrom: { lte: now },
                OR: [
                  { validUntil: null },
                  { validUntil: { gt: now } },
                ],
              },
              include: {
                role: {
                  include: {
                    permissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!profile) {
      return {
        id: tokenUser.sub,
        email: tokenUser.email,
        authenticated: true,
        onboardingRequired: true,
        organisations: [],
      };
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
      organisations: profile.organisationMemberships.map((membership) => ({
        organisationId: membership.organisationId,
        membershipId: membership.id,
        organisationName: membership.organisation.name,
        organisationSlug: membership.organisation.slug,
        organisationStatus: membership.organisation.status,
        jobTitle: membership.jobTitle,
        roles: membership.roleAssignments.map(
          (assignment) => assignment.role.key,
        ),
        permissions: [
          ...new Set(
            membership.roleAssignments.flatMap((assignment) =>
              assignment.role.permissions
                .filter((item) => item.permission.isActive)
                .map((item) => item.permission.key),
            ),
          ),
        ],
      })),
    };
  }
}