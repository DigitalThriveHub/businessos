import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { RlsTransactionService } from '../../../database/rls-transaction.service';
import {
  REQUIRED_PERMISSIONS_KEY,
} from '../../decorators/require-permissions.decorator';

type PermissionRequest = Request & {
  user?: JWTPayload;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveOrganisationId(
  request: PermissionRequest,
): string | null {
  const body = request.body as
    | { organisationId?: unknown }
    | undefined;

  const query = request.query as
    | { organisationId?: unknown }
    | undefined;

  const candidate =
    body?.organisationId ?? query?.organisationId;

  return typeof candidate === 'string' &&
    UUID_PATTERN.test(candidate)
    ? candidate
    : null;
}

function resolveAal(user: JWTPayload): 'AAL1' | 'AAL2' {
  return user.aal === 'aal2' || user.aal === 'AAL2'
    ? 'AAL2'
    : 'AAL1';
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rls: RlsTransactionService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRED_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request =
      context.switchToHttp().getRequest<PermissionRequest>();

    const user = request.user;
    const userId = user?.sub;
    const organisationId = resolveOrganisationId(request);

    if (!user || !userId || !organisationId) {
      throw new ForbiddenException(
        'Permission access could not be verified',
      );
    }

    const now = new Date();

    const assignments = await this.rls.run(
      {
        userId,
        organisationId,
        aal: resolveAal(user),
      },
      (transaction) =>
        transaction.roleAssignment.findMany({
          where: {
            userProfileId: userId,
            organisationId,
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
                status: 'ACTIVE',
                deletedAt: null,
                organisation: {
                  status: 'ACTIVE',
                  deletedAt: null,
                },
              },
            },
            role: {
              deletedAt: null,
              OR: [
                {
                  organisationId,
                },
                {
                  organisationId: null,
                },
              ],
            },
          },
          select: {
            role: {
              select: {
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
                      },
                    },
                  },
                },
              },
            },
          },
        }),
    );

    const grantedPermissions = new Set(
      assignments.flatMap((assignment) =>
        assignment.role.permissions.map(
          (rolePermission) =>
            rolePermission.permission.key,
        ),
      ),
    );

    if (
      !requiredPermissions.every((permission) =>
        grantedPermissions.has(permission),
      )
    ) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    return true;
  }
}