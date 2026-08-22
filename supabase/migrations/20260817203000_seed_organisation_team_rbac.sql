-- Canonical organisation, staff and invitation permissions.
--
-- This migration:
-- 1. Adds or repairs the required permissions.
-- 2. Grants complete administration to organisation owners and system admins.
-- 3. Grants limited read access to appropriate operational roles.
-- 4. Backfills every existing organisation without duplicating assignments.

BEGIN;

WITH permission_seed (
  permission_key,
  permission_name,
  permission_description,
  resource_name,
  action_name,
  is_sensitive,
  requires_mfa,
  permission_metadata
) AS (
  VALUES
    (
      'organisation.read',
      'View organisation',
      'View the current organisation profile and operational settings.',
      'organisation',
      'read',
      false,
      false,
      '{"classification":"business-confidential"}'::jsonb
    ),
    (
      'organisation.update',
      'Update organisation',
      'Update authorised organisation profile and operational settings.',
      'organisation',
      'update',
      true,
      true,
      '{"classification":"business-confidential","high_risk":true}'::jsonb
    ),
    (
      'members.read',
      'View organisation members',
      'View authorised staff memberships and their assigned roles.',
      'members',
      'read',
      true,
      false,
      '{"classification":"personal-confidential"}'::jsonb
    ),
    (
      'members.update',
      'Update organisation members',
      'Update permitted organisation membership details.',
      'members',
      'update',
      true,
      true,
      '{"classification":"personal-confidential","high_risk":true}'::jsonb
    ),
    (
      'members.suspend',
      'Suspend organisation members',
      'Suspend or reactivate authorised organisation memberships.',
      'members',
      'suspend',
      true,
      true,
      '{"classification":"personal-confidential","high_risk":true}'::jsonb
    ),
    (
      'members.roles.manage',
      'Manage member roles',
      'Grant or revoke assignable organisation roles.',
      'members',
      'roles.manage',
      true,
      true,
      '{"classification":"security-sensitive","high_risk":true}'::jsonb
    ),
    (
      'invitations.read',
      'View staff invitations',
      'View staff invitations belonging to the authorised organisation.',
      'invitations',
      'read',
      true,
      false,
      '{"classification":"personal-confidential"}'::jsonb
    ),
    (
      'invitations.create',
      'Create staff invitations',
      'Invite an authorised user into the current organisation.',
      'invitations',
      'create',
      true,
      true,
      '{"classification":"security-sensitive","high_risk":true}'::jsonb
    ),
    (
      'invitations.revoke',
      'Revoke staff invitations',
      'Revoke pending invitations belonging to the current organisation.',
      'invitations',
      'revoke',
      true,
      true,
      '{"classification":"security-sensitive","high_risk":true}'::jsonb
    )
)
INSERT INTO public.permissions (
  id,
  key,
  name,
  description,
  resource,
  action,
  data_scope,
  is_sensitive,
  requires_mfa,
  allows_ai_use,
  is_active,
  metadata,
  created_at,
  updated_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  permission_seed.permission_key,
  permission_seed.permission_name,
  permission_seed.permission_description,
  permission_seed.resource_name,
  permission_seed.action_name,
  'ORGANISATION'::public.permission_data_scope,
  permission_seed.is_sensitive,
  permission_seed.requires_mfa,
  false,
  true,
  permission_seed.permission_metadata,
  pg_catalog.now(),
  pg_catalog.now()
FROM permission_seed
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  data_scope = EXCLUDED.data_scope,
  is_sensitive = EXCLUDED.is_sensitive,
  requires_mfa = EXCLUDED.requires_mfa,
  allows_ai_use = EXCLUDED.allows_ai_use,
  is_active = true,
  metadata = EXCLUDED.metadata,
  deleted_at = NULL,
  updated_at = pg_catalog.now();

-- Owners and system administrators receive every new permission.
INSERT INTO public.role_permissions (
  id,
  role_id,
  permission_id,
  created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  role_record.id,
  permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN (
    'organisation_owner',
    'system_administrator'
  )
  AND role_record.scope =
    'ORGANISATION'::public.role_scope
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.key IN (
    'organisation.read',
    'organisation.update',
    'members.read',
    'members.update',
    'members.suspend',
    'members.roles.manage',
    'invitations.read',
    'invitations.create',
    'invitations.revoke'
  )
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Restricted operational read permissions.
WITH role_permission_seed (
  role_key,
  permission_key
) AS (
  VALUES
    ('compliance_manager', 'organisation.read'),
    ('compliance_manager', 'members.read'),
    ('solicitor', 'organisation.read'),
    ('sales_manager', 'organisation.read'),
    ('sales_manager', 'members.read'),
    ('sales_agent', 'organisation.read'),
    ('finance', 'organisation.read'),
    ('read_only', 'organisation.read')
)
INSERT INTO public.role_permissions (
  id,
  role_id,
  permission_id,
  created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  role_record.id,
  permission_record.id,
  pg_catalog.now()
FROM role_permission_seed
JOIN public.roles AS role_record
  ON role_record.key =
    role_permission_seed.role_key
JOIN public.permissions AS permission_record
  ON permission_record.key =
    role_permission_seed.permission_key
WHERE role_record.scope =
    'ORGANISATION'::public.role_scope
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;