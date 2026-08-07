import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

/**
 * Declares the permissions required to access a controller operation.
 *
 * Permission checks must be enforced by PermissionGuard on the backend.
 * Hiding frontend controls is not an authorisation control.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);