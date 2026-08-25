/// <reference types="jest" />

import { InternalServerErrorException } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { DEFAULT_PERMISSION_KEYS } from './default-permissions';
import { DEFAULT_ROLES } from './default-roles';

describe('RbacService', () => {
  const permissions = DEFAULT_PERMISSION_KEYS.map((key, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    key,
  }));

  const transaction = {
    organisation: {
      findFirst: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
    role: {
      upsert: jest.fn(),
    },
    rolePermission: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  let service: RbacService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new RbacService(prisma as never);

    transaction.organisation.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000100',
    });

    transaction.permission.findMany.mockResolvedValue(permissions);

    transaction.role.upsert.mockImplementation(
      async ({ create }: { create: { key: string } }) => ({
        id: `role-${create.key}`,
      }),
    );

    transaction.rolePermission.deleteMany.mockResolvedValue({
      count: 0,
    });

    transaction.rolePermission.upsert.mockResolvedValue({
      id: 'role-permission-id',
    });
  });

  it('provisions every default role and permission mapping', async () => {
    const result = await service.provisionDefaultRoles(
      '00000000-0000-4000-8000-000000000100',
    );

    expect(transaction.role.upsert).toHaveBeenCalledTimes(DEFAULT_ROLES.length);

    const expectedConnections = DEFAULT_ROLES.reduce(
      (total, role) => total + role.permissions.length,
      0,
    );

    expect(transaction.rolePermission.upsert).toHaveBeenCalledTimes(
      expectedConnections,
    );

    expect(result).toEqual({
      organisationId: '00000000-0000-4000-8000-000000000100',
      rolesProvisioned: DEFAULT_ROLES.length,
      permissionsConnected: expectedConnections,
    });
  });

  it('rejects provisioning for an unavailable organisation', async () => {
    transaction.organisation.findFirst.mockResolvedValue(null);

    await expect(
      service.provisionDefaultRoles('00000000-0000-4000-8000-000000000999'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(transaction.role.upsert).not.toHaveBeenCalled();
  });

  it('rejects an incomplete permission catalogue', async () => {
    transaction.permission.findMany.mockResolvedValue(permissions.slice(0, -1));

    await expect(
      service.provisionDefaultRoles('00000000-0000-4000-8000-000000000100'),
    ).rejects.toThrow('RBAC permission catalogue is incomplete');

    expect(transaction.role.upsert).not.toHaveBeenCalled();
  });

  it('restores and updates existing roles idempotently', async () => {
    await service.provisionDefaultRoles('00000000-0000-4000-8000-000000000100');

    expect(transaction.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          isSystem: true,
          deletedAt: null,
        }),
      }),
    );
  });

  it('removes obsolete permissions from managed system roles', async () => {
    await service.provisionDefaultRoles('00000000-0000-4000-8000-000000000100');

    expect(transaction.rolePermission.deleteMany).toHaveBeenCalledTimes(
      DEFAULT_ROLES.length,
    );

    expect(transaction.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        roleId: expect.any(String),
        permissionId: {
          notIn: expect.any(Array),
        },
      },
    });
  });
});
