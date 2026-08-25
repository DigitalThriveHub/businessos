/// <reference types="jest" />

import { DEFAULT_PERMISSION_KEYS } from './default-permissions';
import { DEFAULT_ROLES } from './default-roles';

describe('DEFAULT_ROLES', () => {
  it('uses unique stable role keys', () => {
    const keys = DEFAULT_ROLES.map((role) => role.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only assigns registered permissions', () => {
    const registeredPermissions = new Set<string>(DEFAULT_PERMISSION_KEYS);

    for (const role of DEFAULT_ROLES) {
      for (const permission of role.permissions) {
        expect(registeredPermissions.has(permission)).toBe(true);
      }
    }
  });

  it('gives the organisation owner every default permission', () => {
    const owner = DEFAULT_ROLES.find(
      (role) => role.key === 'organisation_owner',
    );

    expect(owner).toBeDefined();
    expect(new Set(owner?.permissions)).toEqual(
      new Set(DEFAULT_PERMISSION_KEYS),
    );
  });

  it('prevents manual assignment of the owner role', () => {
    const owner = DEFAULT_ROLES.find(
      (role) => role.key === 'organisation_owner',
    );

    expect(owner?.isAssignable).toBe(false);
  });

  it('does not grant soft-delete permission to operational roles', () => {
    const operationalRoleKeys = [
      'compliance_manager',
      'solicitor',
      'sales_manager',
      'sales_agent',
      'finance',
      'read_only',
    ];

    for (const role of DEFAULT_ROLES) {
      if (operationalRoleKeys.includes(role.key)) {
        expect(role.permissions).not.toContain('enquiries.delete');
      }
    }
  });
});
