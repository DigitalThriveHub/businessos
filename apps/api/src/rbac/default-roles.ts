import { RoleScope } from '../generated/prisma/enums';
import type { DefaultPermissionKey } from './default-permissions';

export interface DefaultRoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly scope: RoleScope;
  readonly isAssignable: boolean;
  readonly permissions: readonly DefaultPermissionKey[];
}

export const DEFAULT_ROLES = [
  {
    key: 'organisation_owner',
    name: 'Organisation Owner',
    description:
      'Full organisation-level authority, including sensitive administrative operations.',
    scope: RoleScope.ORGANISATION,
    isAssignable: false,
    permissions: [
      'enquiries.create',
      'enquiries.read',
      'enquiries.read_all',
      'enquiries.update',
      'enquiries.assign',
      'enquiries.convert',
      'enquiries.close',
      'enquiries.delete',
    ],
  },
  {
    key: 'system_administrator',
    name: 'System Administrator',
    description:
      'Administers organisation systems, users, access and operational configuration.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: [
      'enquiries.create',
      'enquiries.read',
      'enquiries.read_all',
      'enquiries.update',
      'enquiries.assign',
      'enquiries.convert',
      'enquiries.close',
      'enquiries.delete',
    ],
  },
  {
    key: 'compliance_manager',
    name: 'Compliance Manager',
    description:
      'Reviews organisation enquiries for compliance, risk and governance purposes.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: [
      'enquiries.read',
      'enquiries.read_all',
      'enquiries.update',
      'enquiries.close',
    ],
  },
  {
    key: 'solicitor',
    name: 'Solicitor',
    description:
      'Manages assigned enquiries and progresses qualified clients.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: [
      'enquiries.create',
      'enquiries.read',
      'enquiries.update',
      'enquiries.convert',
      'enquiries.close',
    ],
  },
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    description:
      'Manages the organisation enquiry pipeline and team assignments.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: [
      'enquiries.create',
      'enquiries.read',
      'enquiries.read_all',
      'enquiries.update',
      'enquiries.assign',
      'enquiries.convert',
      'enquiries.close',
    ],
  },
  {
    key: 'sales_agent',
    name: 'Sales Agent',
    description:
      'Creates and manages enquiries within the authorised individual scope.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: [
      'enquiries.create',
      'enquiries.read',
      'enquiries.update',
      'enquiries.convert',
      'enquiries.close',
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    description:
      'Receives read-only organisation enquiry access for authorised financial work.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: ['enquiries.read_all'],
  },
  {
    key: 'read_only',
    name: 'Read Only',
    description:
      'Provides read-only access to organisation enquiries.',
    scope: RoleScope.ORGANISATION,
    isAssignable: true,
    permissions: ['enquiries.read_all'],
  },
] as const satisfies readonly DefaultRoleDefinition[];