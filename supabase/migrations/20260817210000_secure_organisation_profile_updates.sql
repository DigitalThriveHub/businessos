-- Secure organisation profile updates.
--
-- Organisation updates require:
-- - an authenticated active member;
-- - matching tenant context;
-- - an effective organisation.update permission;
-- - an AAL2 session;
-- - an atomic append-only audit event.

CREATE OR REPLACE FUNCTION private.update_organisation_profile(
  p_organisation_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_existing public.organisations%ROWTYPE;
  v_updated public.organisations%ROWTYPE;

  v_name text;
  v_legal_name text;
  v_slug text;
  v_timezone text;
  v_locale text;
  v_country_code text;

  v_changed boolean;
BEGIN
  v_user_id := private.current_user_id();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication context is required'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(
    pg_catalog.current_setting(
      'app.organisation_id',
      true
    ),
    ''
  ) IS DISTINCT FROM p_organisation_id::text THEN
    RAISE EXCEPTION 'Organisation context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.upper(
    COALESCE(
      NULLIF(
        pg_catalog.current_setting('app.aal', true),
        ''
      ),
      ''
    )
  ) <> 'AAL2' THEN
    RAISE EXCEPTION 'Multi-factor authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'A non-empty organisation update is required'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.pg_column_size(p_patch) > 8192 THEN
    RAISE EXCEPTION 'Organisation update is too large'
      USING ERRCODE = '22001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch)
      AS supplied(key_name)
    WHERE supplied.key_name NOT IN (
      'name',
      'legalName',
      'slug',
      'timezone',
      'locale',
      'countryCode'
    )
  ) THEN
    RAISE EXCEPTION 'Organisation update contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  IF (
    p_patch ? 'name'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'name'
    ) IS DISTINCT FROM 'string'
  ) OR (
    p_patch ? 'slug'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'slug'
    ) IS DISTINCT FROM 'string'
  ) OR (
    p_patch ? 'timezone'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'timezone'
    ) IS DISTINCT FROM 'string'
  ) OR (
    p_patch ? 'locale'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'locale'
    ) IS DISTINCT FROM 'string'
  ) OR (
    p_patch ? 'countryCode'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'countryCode'
    ) IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'Organisation fields contain invalid values'
      USING ERRCODE = '22023';
  END IF;

  IF (
    p_patch ? 'legalName'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'legalName'
    ) NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'Legal name must be a string or null'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organisation_memberships
      AS membership
    JOIN public.role_assignments
      AS assignment
      ON assignment.user_profile_id =
        membership.user_profile_id
      AND assignment.organisation_id =
        membership.organisation_id
      AND assignment.organisation_membership_id =
        membership.id
    JOIN public.roles
      AS role_record
      ON role_record.id = assignment.role_id
      AND role_record.organisation_id =
        membership.organisation_id
    JOIN public.role_permissions
      AS role_permission
      ON role_permission.role_id =
        role_record.id
    JOIN public.permissions
      AS permission_record
      ON permission_record.id =
        role_permission.permission_id
    WHERE membership.organisation_id =
        p_organisation_id
      AND membership.user_profile_id =
        v_user_id
      AND membership.status =
        'ACTIVE'::public.membership_status
      AND membership.deleted_at IS NULL
      AND assignment.revoked_at IS NULL
      AND assignment.deleted_at IS NULL
      AND assignment.valid_from <=
        pg_catalog.now()
      AND (
        assignment.valid_until IS NULL
        OR assignment.valid_until >
          pg_catalog.now()
      )
      AND role_record.deleted_at IS NULL
      AND permission_record.key =
        'organisation.update'
      AND permission_record.is_active = true
      AND permission_record.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Organisation update is not permitted'
      USING ERRCODE = '42501';
  END IF;

  SELECT organisation_record.*
  INTO v_existing
  FROM public.organisations
    AS organisation_record
  WHERE organisation_record.id =
      p_organisation_id
    AND organisation_record.status IN (
      'PROVISIONING'::public.organisation_status,
      'ACTIVE'::public.organisation_status
    )
    AND organisation_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_name :=
    CASE
      WHEN p_patch ? 'name'
        THEN pg_catalog.btrim(
          p_patch ->> 'name'
        )
      ELSE v_existing.name
    END;

  v_legal_name :=
    CASE
      WHEN p_patch ? 'legalName'
        THEN NULLIF(
          pg_catalog.btrim(
            p_patch ->> 'legalName'
          ),
          ''
        )
      ELSE v_existing.legal_name
    END;

  v_slug :=
    CASE
      WHEN p_patch ? 'slug'
        THEN pg_catalog.lower(
          pg_catalog.btrim(
            p_patch ->> 'slug'
          )
        )
      ELSE v_existing.slug
    END;

  v_timezone :=
    CASE
      WHEN p_patch ? 'timezone'
        THEN pg_catalog.btrim(
          p_patch ->> 'timezone'
        )
      ELSE v_existing.timezone
    END;

  v_locale :=
    CASE
      WHEN p_patch ? 'locale'
        THEN pg_catalog.btrim(
          p_patch ->> 'locale'
        )
      ELSE v_existing.locale
    END;

  v_country_code :=
    CASE
      WHEN p_patch ? 'countryCode'
        THEN pg_catalog.upper(
          pg_catalog.btrim(
            p_patch ->> 'countryCode'
          )
        )
      ELSE v_existing.country_code
    END;

  IF v_name IS NULL
    OR pg_catalog.char_length(v_name) < 2
    OR pg_catalog.char_length(v_name) > 200
  THEN
    RAISE EXCEPTION 'Organisation name is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.char_length(
    COALESCE(v_legal_name, '')
  ) > 250 THEN
    RAISE EXCEPTION 'Legal name is too long'
      USING ERRCODE = '22001';
  END IF;

  IF v_name ~ '[[:cntrl:]]'
    OR v_legal_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Organisation names contain invalid characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_slug IS NULL
    OR pg_catalog.char_length(v_slug) < 3
    OR pg_catalog.char_length(v_slug) > 80
    OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  THEN
    RAISE EXCEPTION 'Organisation URL is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organisations
      AS conflicting_organisation
    WHERE conflicting_organisation.slug =
        v_slug
      AND conflicting_organisation.id <>
        p_organisation_id
      AND conflicting_organisation.deleted_at
        IS NULL
  ) THEN
    RAISE EXCEPTION 'Organisation URL is unavailable'
      USING ERRCODE = '23505';
  END IF;

  IF v_timezone IS NULL
    OR v_timezone = ''
    OR pg_catalog.char_length(v_timezone) > 64
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names
        AS timezone_record
      WHERE timezone_record.name =
        v_timezone
    )
  THEN
    RAISE EXCEPTION 'Timezone is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_locale IS NULL
    OR v_locale = ''
    OR pg_catalog.char_length(v_locale) > 16
    OR v_locale !~
      '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  THEN
    RAISE EXCEPTION 'Locale is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_country_code IS NULL
    OR v_country_code !~ '^[A-Z]{2}$'
  THEN
    RAISE EXCEPTION 'Country code is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_changed :=
    v_name IS DISTINCT FROM v_existing.name
    OR v_legal_name IS DISTINCT FROM
      v_existing.legal_name
    OR v_slug IS DISTINCT FROM v_existing.slug
    OR v_timezone IS DISTINCT FROM
      v_existing.timezone
    OR v_locale IS DISTINCT FROM
      v_existing.locale
    OR v_country_code IS DISTINCT FROM
      v_existing.country_code;

  IF v_changed THEN
    UPDATE public.organisations
    SET
      name = v_name,
      legal_name = v_legal_name,
      slug = v_slug,
      timezone = v_timezone,
      locale = v_locale,
      country_code = v_country_code,
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_organisation_id
    RETURNING *
    INTO v_updated;

    INSERT INTO public.audit_events (
      id,
      organisation_id,
      actor_type,
      actor_user_profile_id,
      source,
      action,
      resource_type,
      resource_id,
      outcome,
      previous_value,
      new_value
    )
    VALUES (
      pg_catalog.gen_random_uuid(),
      p_organisation_id,
      'USER'::public.audit_actor_type,
      v_user_id,
      'businessos-api',
      'organisation.profile.update',
      'organisation',
      p_organisation_id::text,
      'SUCCESS'::public.audit_outcome,
      pg_catalog.jsonb_build_object(
        'name', v_existing.name,
        'legalName', v_existing.legal_name,
        'slug', v_existing.slug,
        'timezone', v_existing.timezone,
        'locale', v_existing.locale,
        'countryCode', v_existing.country_code
      ),
      pg_catalog.jsonb_build_object(
        'name', v_updated.name,
        'legalName', v_updated.legal_name,
        'slug', v_updated.slug,
        'timezone', v_updated.timezone,
        'locale', v_updated.locale,
        'countryCode', v_updated.country_code
      )
    );
  ELSE
    v_updated := v_existing;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id,
    'name', v_updated.name,
    'legalName', v_updated.legal_name,
    'slug', v_updated.slug,
    'status', v_updated.status,
    'timezone', v_updated.timezone,
    'locale', v_updated.locale,
    'countryCode', v_updated.country_code,
    'createdAt', v_updated.created_at,
    'updatedAt', v_updated.updated_at
  );
END
$function$;

ALTER FUNCTION private.update_organisation_profile(
  uuid,
  jsonb
)
OWNER TO postgres;

REVOKE ALL
ON FUNCTION private.update_organisation_profile(
  uuid,
  jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION private.update_organisation_profile(
  uuid,
  jsonb
)
TO businessos_app;

COMMENT ON FUNCTION private.update_organisation_profile(
  uuid,
  jsonb
) IS
  'Updates an authorised organisation profile using verified tenant, RBAC and AAL2 context and records the change atomically.';
