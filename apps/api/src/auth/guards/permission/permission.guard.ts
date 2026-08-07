import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import {
  REQUIRED_PERMISSIONS_KEY,
} from '../../decorators/require-permissions.decorator';
import { PrismaService } from '../../../database/prisma.service';

type PermissionRequest = Request & {
  user?: JWTPayload;
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRED_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<PermissionRequest>();

    const userId = request.user?.sub;

    const body = request.body as
      | { organisationId?: unknown }
      | undefined;

    const query = request.query as
      | { organisationId?: unknown }
      | undefined;

    const organisationId =
      typeof body?.organisationId === 'string'
        ? body.organisationId
        : typeof query?.organisationId === 'string'
          ? query.organisationId
          : undefined;

    if (!userId || !organisationId) {
      throw new ForbiddenException(
        'Permission access could not be verified',
      );
    }

    const now = new Date();

    const assignments = await this.prisma.roleAssignment.findMany({
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
    });

    const grantedPermissions = new Set(
      assignments.flatMap((assignment) =>
        assignment.role.permissions.map(
          (rolePermission) => rolePermission.permission.key,
        ),
      ),
    );

    const hasEveryRequiredPermission = requiredPermissions.every(
      (permission) => grantedPermissions.has(permission),
    );

    if (!hasEveryRequiredPermission) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    return true;
  }
}