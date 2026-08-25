import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  AssignmentScope,
  AuditActorType,
  AuditOutcome,
} from '../generated/prisma/enums';
import { DEFAULT_PERMISSION_KEYS } from './default-permissions';
import { DEFAULT_ROLES } from './default-roles';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const APPLY = process.argv.includes('--apply');

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function requiredUuidEnvironmentValue(name: string): string {
  const value = requiredEnvironmentValue(name);

  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }

  return value;
}

function migrationConnectionString(): string {
  const connectionString = requiredEnvironmentValue('MIGRATION_DATABASE_URL');
  const parsed = new URL(connectionString);

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('MIGRATION_DATABASE_URL must be a PostgreSQL URL');
  }

  const username = decodeURIComponent(parsed.username).toLowerCase();

  if (
    username.includes('businessos_app') ||
    username.includes('businessos_runtime')
  ) {
    throw new Error(
      'Refusing to run with the RLS-constrained runtime database role',
    );
  }

  return connectionString;
}

interface RepairState {
  membershipId: string;
  permissionCount: number;
  activeDefaultRoleCount: number;
  effectiveOwnerAssignmentId?: string;
}

async function inspectRepairState(
  transaction: Prisma.TransactionClient,
  organisationId: string,
  userProfileId: string,
): Promise<RepairState> {
  const now = new Date();

  const organisation = await transaction.organisation.findFirst({
    where: {
      id: organisationId,
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!organisation) {
    throw new Error('The target organisation is not active');
  }

  const membership = await transaction.organisationMembership.findFirst({
    where: {
      organisationId,
      userProfileId,
      status: 'ACTIVE',
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!membership) {
    throw new Error(
      'The target user does not have an active membership in the organisation',
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
      key: true,
    },
  });

  const availablePermissionKeys = new Set(
    permissions.map((permission) => permission.key),
  );
  const missingPermissionKeys = DEFAULT_PERMISSION_KEYS.filter(
    (key) => !availablePermissionKeys.has(key),
  );

  if (missingPermissionKeys.length > 0) {
    throw new Error(
      `RBAC permission catalogue is incomplete: ${missingPermissionKeys.join(', ')}`,
    );
  }

  const activeDefaultRoleCount = await transaction.role.count({
    where: {
      organisationId,
      key: {
        in: DEFAULT_ROLES.map((role) => role.key),
      },
      deletedAt: null,
    },
  });

  const effectiveOwnerAssignments = await transaction.roleAssignment.findMany({
    where: {
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
      role: {
        organisationId,
        key: 'organisation_owner',
      },
      organisationMembership: {
        is: {
          organisationId,
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
    },
    select: {
      id: true,
      userProfileId: true,
      organisationMembershipId: true,
    },
  });

  const conflictingOwner = effectiveOwnerAssignments.find(
    (assignment) => assignment.userProfileId !== userProfileId,
  );

  if (conflictingOwner) {
    throw new Error(
      'The organisation already has a different effective owner; no changes were made',
    );
  }

  const matchingOwnerAssignments = effectiveOwnerAssignments.filter(
    (assignment) =>
      assignment.userProfileId === userProfileId &&
      assignment.organisationMembershipId === membership.id,
  );

  if (matchingOwnerAssignments.length > 1) {
    throw new Error(
      'Multiple effective owner assignments exist for the target user; repair the data conflict first',
    );
  }

  return {
    membershipId: membership.id,
    permissionCount: permissions.length,
    activeDefaultRoleCount,
    effectiveOwnerAssignmentId: matchingOwnerAssignments[0]?.id,
  };
}

async function provisionDefaultRoles(
  transaction: Prisma.TransactionClient,
  organisationId: string,
): Promise<{
  ownerRoleId: string;
  permissionsConnected: number;
}> {
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

  const permissionIdByKey = new Map(
    permissions.map((permission) => [permission.key, permission.id]),
  );

  let ownerRoleId: string | undefined;
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

    if (definition.key === 'organisation_owner') {
      ownerRoleId = role.id;
    }

    const requiredPermissionIds = definition.permissions.map((key) => {
      const permissionId = permissionIdByKey.get(key);

      if (!permissionId) {
        throw new Error(`Missing required permission: ${key}`);
      }

      return permissionId;
    });

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

  if (!ownerRoleId) {
    throw new Error('The organisation owner role was not provisioned');
  }

  return {
    ownerRoleId,
    permissionsConnected,
  };
}

async function main(): Promise<void> {
  const organisationId = requiredUuidEnvironmentValue('RBAC_ORGANISATION_ID');
  const userProfileId = requiredUuidEnvironmentValue('RBAC_USER_ID');
  const adapter = new PrismaPg({
    connectionString: migrationConnectionString(),
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ssl: {
      ca: readFileSync(
        resolve(process.cwd(), 'certs', 'supabase-ca.crt'),
        'utf8',
      ),
      rejectUnauthorized: true,
    },
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const result = await prisma.$transaction(
      async (transaction) => {
        if (APPLY) {
          const [lock] = await transaction.$queryRaw<
            Array<{ acquired: boolean }>
          >`
                SELECT pg_catalog.pg_try_advisory_xact_lock(
                pg_catalog.hashtextextended(${organisationId}, 0)
                ) AS "acquired"
            `;

          if (!lock?.acquired) {
            throw new Error(
              'Another RBAC repair is already running for this organisation',
            );
          }
        }

        const state = await inspectRepairState(
          transaction,
          organisationId,
          userProfileId,
        );

        if (!APPLY) {
          return {
            mode: 'DRY_RUN',
            organisationId,
            userProfileId,
            membershipId: state.membershipId,
            permissionCatalogue: `${state.permissionCount}/${DEFAULT_PERMISSION_KEYS.length}`,
            activeDefaultRoles: `${state.activeDefaultRoleCount}/${DEFAULT_ROLES.length}`,
            ownerAssignment: state.effectiveOwnerAssignmentId
              ? 'already-effective'
              : 'will-create',
            nextStep: 'Run the same command with --apply',
          };
        }

        const provisioned = await provisionDefaultRoles(
          transaction,
          organisationId,
        );

        let ownerAssignment: { id: string };
        let assignmentCreated = false;

        if (state.effectiveOwnerAssignmentId) {
          ownerAssignment = await transaction.roleAssignment.findUniqueOrThrow({
            where: {
              id: state.effectiveOwnerAssignmentId,
            },
            select: {
              id: true,
            },
          });
        } else {
          // Match the approved secure organisation bootstrap process.
          await transaction.role.update({
            where: {
              id: provisioned.ownerRoleId,
            },
            data: {
              isAssignable: true,
            },
          });

          ownerAssignment = await transaction.roleAssignment.create({
            data: {
              roleId: provisioned.ownerRoleId,
              userProfileId,
              organisationId,
              organisationMembershipId: state.membershipId,
              scope: AssignmentScope.ORGANISATION,
              validFrom: new Date(),
              reason:
                'Controlled repair of legacy organisation owner RBAC bootstrap',
              grantedByUserProfileId: userProfileId,
            },
            select: {
              id: true,
            },
          });

          await transaction.role.update({
            where: {
              id: provisioned.ownerRoleId,
            },
            data: {
              isAssignable: false,
            },
          });

          assignmentCreated = true;
        }

        await transaction.auditEvent.create({
          data: {
            organisationId,
            actorType: AuditActorType.SYSTEM,
            actorIdentifier: 'controlled-rbac-repair',
            subjectUserProfileId: userProfileId,
            source: 'rbac-repair-cli',
            action: 'rbac.organisation_owner.repair',
            resourceType: 'RoleAssignment',
            resourceId: ownerAssignment.id,
            outcome: AuditOutcome.SUCCESS,
            reason:
              'Controlled repair of a legacy organisation created before secure RBAC bootstrap',
            newValue: {
              roleKey: 'organisation_owner',
              organisationId,
              userProfileId,
              membershipId: state.membershipId,
              assignmentCreated,
            },
            metadata: {
              rolesProvisioned: DEFAULT_ROLES.length,
              permissionsConnected: provisioned.permissionsConnected,
            },
          },
        });

        return {
          mode: 'APPLY',
          status: assignmentCreated ? 'repaired' : 'already-configured',
          organisationId,
          userProfileId,
          membershipId: state.membershipId,
          ownerRoleAssignmentId: ownerAssignment.id,
          rolesProvisioned: DEFAULT_ROLES.length,
          permissionsConnected: provisioned.permissionsConnected,
        };
      },
      {
        maxWait: 5_000,
        timeout: 60_000,
      },
    );

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';

  console.error(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        status: 'failed',
        message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
