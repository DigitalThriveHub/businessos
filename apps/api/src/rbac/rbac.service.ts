import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DEFAULT_PERMISSION_KEYS } from './default-permissions';
import { DEFAULT_ROLES } from './default-roles';

export interface ProvisionedRbacResult {
  organisationId: string;
  rolesProvisioned: number;
  permissionsConnected: number;
}

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async provisionDefaultRoles(
    organisationId: string,
  ): Promise<ProvisionedRbacResult> {
    return this.prisma.$transaction(async (transaction) => {
      const organisation = await transaction.organisation.findFirst({
        where: {
          id: organisationId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!organisation) {
        throw new InternalServerErrorException(
          'Cannot provision RBAC for an unavailable organisation.',
        );
      }

      const permissions = await transaction.permission.findMany({
        where: {
          key: {
            in: [...DEFAULT_PERMISSION_KEYS],
          },
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          key: true,
        },
      });

      if (permissions.length !== DEFAULT_PERMISSION_KEYS.length) {
        const availableKeys = new Set(
          permissions.map((permission) => permission.key),
        );

        const missingKeys = DEFAULT_PERMISSION_KEYS.filter(
          (key) => !availableKeys.has(key),
        );

        throw new InternalServerErrorException(
          `RBAC permission catalogue is incomplete: ${missingKeys.join(', ')}`,
        );
      }

      const permissionIdByKey = new Map(
        permissions.map((permission) => [
          permission.key,
          permission.id,
        ]),
      );

      let permissionsConnected = 0;

      for (const definition of DEFAULT_ROLES) {
        const role = await transaction.role.upsert({
          where: {
            organisationId_key: {
              organisationId,
              key: definition.key,
            },
          },
          create: {
            organisationId,
            key: definition.key,
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            isSystem: true,
            isAssignable: definition.isAssignable,
          },
          update: {
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            isSystem: true,
            isAssignable: definition.isAssignable,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        const requiredPermissionIds = definition.permissions.map((key) => {
          const permissionId = permissionIdByKey.get(key);

          if (!permissionId) {
            throw new InternalServerErrorException(
              `Missing required permission: ${key}`,
            );
          }

          return permissionId;
        });

        // Keep system-role permissions exactly aligned with the
        // version-controlled role definitions.
        await transaction.rolePermission.deleteMany({
          where: {
            roleId: role.id,
            permissionId: {
              notIn: requiredPermissionIds,
            },
          },
        });

        for (const permissionId of requiredPermissionIds) {
          await transaction.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId,
              },
            },
            create: {
              roleId: role.id,
              permissionId,
            },
            update: {},
          });

          permissionsConnected += 1;
        }
      }

      return {
        organisationId,
        rolesProvisioned: DEFAULT_ROLES.length,
        permissionsConnected,
      };
    });
  }
}