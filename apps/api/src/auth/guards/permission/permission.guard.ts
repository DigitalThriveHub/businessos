import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MembershipStatus,
  OrganisationStatus,
} from '../../../generated/prisma/enums';
import { RlsTransactionService } from '../../../database/rls-transaction.service';
import {
  requireOrganisationAccessContext,
  type OrganisationScopedRequest,
} from '../../request-security-context';
import { REQUIRED_PERMISSIONS_KEY } from '../../decorators/require-permissions.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rls: RlsTransactionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const declaredPermissions = this.reflector.getAllAndOverride<
      readonly string[]
    >(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!declaredPermissions?.length) {
      return true;
    }

    const requiredPermissions = [...new Set(declaredPermissions)];

    const request = context
      .switchToHttp()
      .getRequest<OrganisationScopedRequest>();

    const access = requireOrganisationAccessContext(request);

    const now = new Date();

    const assignments = await this.rls.run(
      {
        userId: access.userId,
        organisationId: access.organisationId,
        aal: access.aal,
      },
      (transaction) =>
        transaction.roleAssignment.findMany({
          where: {
            userProfileId: access.userId,
            organisationId: access.organisationId,
            organisationMembershipId: access.membershipId,
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
            organisationMembership: {
              is: {
                id: access.membershipId,
                userProfileId: access.userId,
                organisationId: access.organisationId,
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                organisation: {
                  status: OrganisationStatus.ACTIVE,
                  deletedAt: null,
                },
              },
            },
            role: {
              organisationId: access.organisationId,
              deletedAt: null,
              permissions: {
                some: {
                  permission: {
                    key: {
                      in: requiredPermissions,
                    },
                    isActive: true,
                    deletedAt: null,
                  },
                },
              },
            },
          },
          select: {
            role: {
              select: {
                permissions: {
                  where: {
                    permission: {
                      key: {
                        in: requiredPermissions,
                      },
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

    const grantedPermissions = new Map<
      string,
      {
        requiresMfa: boolean;
      }
    >();

    for (const assignment of assignments) {
      for (const rolePermission of assignment.role.permissions) {
        grantedPermissions.set(rolePermission.permission.key, {
          requiresMfa: rolePermission.permission.requiresMfa,
        });
      }
    }

    const missingPermission = requiredPermissions.find(
      (permission) => !grantedPermissions.has(permission),
    );

    if (missingPermission) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    const requiresMfa = requiredPermissions.some(
      (permission) => grantedPermissions.get(permission)?.requiresMfa === true,
    );

    if (requiresMfa && access.aal !== 'AAL2') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'MFA_REQUIRED',
        message:
          'Multi-factor authentication is required to perform this action',
      });
    }

    return true;
  }
}
