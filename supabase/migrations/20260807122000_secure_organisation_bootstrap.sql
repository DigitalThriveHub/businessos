-- Secure, atomic organisation bootstrap.
-- RLS remains enabled and forced.
-- The runtime role receives EXECUTE only, never direct INSERT on organisations.

CREATE OR REPLACE FUNCTION private.bootstrap_organisation(
  p_name text,
  p_slug text,
  p_legal_name text DEFAULT NULL,
  p_owner_email text DEFAULT NULL,
  p_owner_display_name text DEFAULT NULL,
  p_owner_first_name text DEFAULT NULL,
  p_owner_last_name text DEFAULT NULL,
  p_owner_job_title text DEFAULT NULL,
  p_timezone text DEFAULT 'Europe/London',
  p_locale text DEFAULT 'en-GB',
  p_country_code text DEFAULT 'GB'
)
RETURNS TABLE (
  organisation_id uuid,
  organisation_slug text,
  membership_id uuid,
  owner_role_id uuid,
  owner_role_assignment_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid;
  v_auth_email text;
  v_organisation_id uuid;
  v_membership_id uuid;
  v_owner_role_id uuid;
  v_owner_assignment_id uuid;
  v_role record;
  v_permission_key text;
BEGIN
  v_user_id := private.current_user_id();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Prevent concurrent duplicate bootstrap requests for the same identity.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT lower(btrim(auth_user.email))
  INTO v_auth_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_user_id;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Authenticated identity does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_owner_email IS NULL
     OR lower(btrim(p_owner_email)) <> v_auth_email THEN
    RAISE EXCEPTION 'Owner email must match the authenticated identity'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Organisation name must contain 2 to 200 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_slug IS NULL
     OR char_length(p_slug) NOT BETWEEN 2 AND 80
     OR p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid organisation slug'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_country_code IS NULL OR p_country_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Invalid ISO country code'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS membership
    WHERE membership.user_profile_id = v_user_id
      AND membership.status = 'ACTIVE'
      AND membership.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This identity already belongs to an active organisation'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organisations AS organisation
    WHERE organisation.slug = p_slug
  ) THEN
    RAISE EXCEPTION 'Organisation slug is already in use'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- The profile UUID must always equal auth.users.id.
  INSERT INTO public.user_profiles (
    id,
    email,
    display_name,
    first_name,
    last_name,
    status,
    locale,
    timezone,
    is_platform_user,
    created_at,
    updated_at
  )
  VALUES (
    v_user_id,
    v_auth_email,
    nullif(btrim(p_owner_display_name), ''),
    nullif(btrim(p_owner_first_name), ''),
    nullif(btrim(p_owner_last_name), ''),
    'ACTIVE',
    coalesce(nullif(btrim(p_locale), ''), 'en-GB'),
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/London'),
    false,
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = coalesce(
      EXCLUDED.display_name,
      public.user_profiles.display_name
    ),
    first_name = coalesce(
      EXCLUDED.first_name,
      public.user_profiles.first_name
    ),
    last_name = coalesce(
      EXCLUDED.last_name,
      public.user_profiles.last_name
    ),
    status = 'ACTIVE',
    deleted_at = NULL,
    updated_at = pg_catalog.now();

  INSERT INTO public.organisations (
    id,
    slug,
    name,
    legal_name,
    status,
    timezone,
    locale,
    country_code,
    created_at,
    updated_at
  )
  VALUES (
    pg_catalog.gen_random_uuid(),
    p_slug,
    btrim(p_name),
    nullif(btrim(p_legal_name), ''),
    'ACTIVE',
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/London'),
    coalesce(nullif(btrim(p_locale), ''), 'en-GB'),
    p_country_code,
    pg_catalog.now(),
    pg_catalog.now()
  )
  RETURNING id INTO v_organisation_id;

  INSERT INTO public.organisation_memberships (
    id,
    organisation_id,
    user_profile_id,
    status,
    job_title,
    joined_at,
    created_at,
    updated_at
  )
  VALUES (
    pg_catalog.gen_random_uuid(),
    v_organisation_id,
    v_user_id,
    'ACTIVE',
    nullif(btrim(p_owner_job_title), ''),
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now()
  )
  RETURNING id INTO v_membership_id;

  -- Provision the controlled organisation role catalogue.
  FOR v_role IN
    SELECT *
    FROM (
      VALUES
        (
          'organisation_owner',
          'Organisation Owner',
          'Full organisation-level authority.',
          false,
          ARRAY[
            'enquiries.create',
            'enquiries.read',
            'enquiries.read_all',
            'enquiries.update',
            'enquiries.assign',
            'enquiries.convert',
            'enquiries.close',
            'enquiries.delete'
          ]::text[]
        ),
        (
          'system_administrator',
          'System Administrator',
          'Administers organisation systems and operational access.',
          true,
          ARRAY[
            'enquiries.create',
            'enquiries.read',
            'enquiries.read_all',
            'enquiries.update',
            'enquiries.assign',
            'enquiries.convert',
            'enquiries.close',
            'enquiries.delete'
          ]::text[]
        ),
        (
          'compliance_manager',
          'Compliance Manager',
          'Reviews enquiries for compliance, risk and governance.',
          true,
          ARRAY[
            'enquiries.read',
            'enquiries.read_all',
            'enquiries.update',
            'enquiries.close'
          ]::text[]
        ),
        (
          'solicitor',
          'Solicitor',
          'Manages assigned enquiries and qualified clients.',
          true,
          ARRAY[
            'enquiries.create',
            'enquiries.read',
            'enquiries.update',
            'enquiries.convert',
            'enquiries.close'
          ]::text[]
        ),
        (
          'sales_manager',
          'Sales Manager',
          'Manages the organisation enquiry pipeline.',
          true,
          ARRAY[
            'enquiries.create',
            'enquiries.read',
            'enquiries.read_all',
            'enquiries.update',
            'enquiries.assign',
            'enquiries.convert',
            'enquiries.close'
          ]::text[]
        ),
        (
          'sales_agent',
          'Sales Agent',
          'Manages enquiries within individual authorised scope.',
          true,
          ARRAY[
            'enquiries.create',
            'enquiries.read',
            'enquiries.update',
            'enquiries.convert',
            'enquiries.close'
          ]::text[]
        ),
        (
          'finance',
          'Finance',
          'Read-only organisation enquiry access for finance.',
          true,
          ARRAY['enquiries.read_all']::text[]
        ),
        (
          'read_only',
          'Read Only',
          'Read-only organisation enquiry access.',
          true,
          ARRAY['enquiries.read_all']::text[]
        )
    ) AS role_definition(
      role_key,
      role_name,
      role_description,
      role_is_assignable,
      permission_keys
    )
  LOOP
    INSERT INTO public.roles (
      id,
      organisation_id,
      key,
      name,
      description,
      scope,
      is_system,
      is_assignable,
      created_at,
      updated_at
    )
    VALUES (
      pg_catalog.gen_random_uuid(),
      v_organisation_id,
      v_role.role_key,
      v_role.role_name,
      v_role.role_description,
      'ORGANISATION',
      true,
      -- Owner is temporarily assignable so the existing security trigger
      -- can validate the initial owner assignment.
      CASE
        WHEN v_role.role_key = 'organisation_owner' THEN true
        ELSE v_role.role_is_assignable
      END,
      pg_catalog.now(),
      pg_catalog.now()
    )
    RETURNING id INTO v_owner_role_id;

    FOREACH v_permission_key IN ARRAY v_role.permission_keys
    LOOP
      INSERT INTO public.role_permissions (
        id,
        role_id,
        permission_id,
        created_at
      )
      SELECT
        pg_catalog.gen_random_uuid(),
        v_owner_role_id,
        permission.id,
        pg_catalog.now()
      FROM public.permissions AS permission
      WHERE permission.key = v_permission_key
        AND permission.is_active = true
        AND permission.deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Required permission is missing: %',
          v_permission_key
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END LOOP;

    IF v_role.role_key = 'organisation_owner' THEN
      INSERT INTO public.role_assignments (
        id,
        role_id,
        user_profile_id,
        organisation_id,
        organisation_membership_id,
        scope,
        valid_from,
        reason,
        granted_by_user_profile_id,
        created_at,
        updated_at
      )
      VALUES (
        pg_catalog.gen_random_uuid(),
        v_owner_role_id,
        v_user_id,
        v_organisation_id,
        v_membership_id,
        'ORGANISATION',
        pg_catalog.now(),
        'Initial organisation owner bootstrap',
        v_user_id,
        pg_catalog.now(),
        pg_catalog.now()
      )
      RETURNING id INTO v_owner_assignment_id;

      -- Prevent the owner role from being assigned through normal RBAC flows.
      UPDATE public.roles
      SET
        is_assignable = false,
        updated_at = pg_catalog.now()
      WHERE id = v_owner_role_id;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    v_organisation_id,
    p_slug,
    v_membership_id,
    (
      SELECT role_record.id
      FROM public.roles AS role_record
      WHERE role_record.organisation_id = v_organisation_id
        AND role_record.key = 'organisation_owner'
        AND role_record.deleted_at IS NULL
    ),
    v_owner_assignment_id,
    'ACTIVE'::text;
END;
$function$;

REVOKE ALL
ON FUNCTION private.bootstrap_organisation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION private.bootstrap_organisation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
TO businessos_app;

COMMENT ON FUNCTION private.bootstrap_organisation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Atomically provisions one organisation, its owner membership, controlled system roles and initial owner assignment.';