-- Secure self-service profile updates.
--
-- Only non-security profile fields may be changed by an authenticated user.
-- Email, account status, platform access, metadata and lifecycle fields remain
-- controlled by dedicated administrative/authentication workflows.
--
-- Every material change is written atomically to the append-only audit log.

-- Remove the broad direct-update path.
REVOKE UPDATE
ON TABLE public.user_profiles
FROM businessos_app;

DROP POLICY IF EXISTS user_profiles_update_self
ON public.user_profiles;

CREATE OR REPLACE FUNCTION private.update_own_profile(
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
  v_existing public.user_profiles%ROWTYPE;
  v_updated public.user_profiles%ROWTYPE;

  v_display_name text;
  v_first_name text;
  v_last_name text;
  v_locale text;
  v_timezone text;

  v_changed boolean;
BEGIN
  v_user_id := private.current_user_id();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_patch IS NULL
    OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'A non-empty profile update object is required'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.pg_column_size(p_patch) > 8192 THEN
    RAISE EXCEPTION 'Profile update is too large'
      USING ERRCODE = '22001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_patch)
      AS supplied(key_name)
    WHERE supplied.key_name NOT IN (
      'displayName',
      'firstName',
      'lastName',
      'locale',
      'timezone'
    )
  ) THEN
    RAISE EXCEPTION 'Profile update contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  IF (
    p_patch ? 'displayName'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'displayName'
    ) NOT IN ('string', 'null')
  ) OR (
    p_patch ? 'firstName'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'firstName'
    ) NOT IN ('string', 'null')
  ) OR (
    p_patch ? 'lastName'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'lastName'
    ) NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'Profile names must be strings or null'
      USING ERRCODE = '22023';
  END IF;

  IF (
    p_patch ? 'locale'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'locale'
    ) IS DISTINCT FROM 'string'
  ) OR (
    p_patch ? 'timezone'
    AND pg_catalog.jsonb_typeof(
      p_patch -> 'timezone'
    ) IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'Locale and timezone must be strings'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.*
  INTO v_existing
  FROM public.user_profiles AS profile
  WHERE profile.id = v_user_id
    AND profile.status::text = 'ACTIVE'
    AND profile.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account profile is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_display_name :=
    CASE
      WHEN p_patch ? 'displayName'
        THEN pg_catalog.nullif(
          pg_catalog.btrim(
            p_patch ->> 'displayName'
          ),
          ''
        )
      ELSE v_existing.display_name
    END;

  v_first_name :=
    CASE
      WHEN p_patch ? 'firstName'
        THEN pg_catalog.nullif(
          pg_catalog.btrim(
            p_patch ->> 'firstName'
          ),
          ''
        )
      ELSE v_existing.first_name
    END;

  v_last_name :=
    CASE
      WHEN p_patch ? 'lastName'
        THEN pg_catalog.nullif(
          pg_catalog.btrim(
            p_patch ->> 'lastName'
          ),
          ''
        )
      ELSE v_existing.last_name
    END;

  v_locale :=
    CASE
      WHEN p_patch ? 'locale'
        THEN pg_catalog.btrim(
          p_patch ->> 'locale'
        )
      ELSE v_existing.locale
    END;

  v_timezone :=
    CASE
      WHEN p_patch ? 'timezone'
        THEN pg_catalog.btrim(
          p_patch ->> 'timezone'
        )
      ELSE v_existing.timezone
    END;

  IF pg_catalog.char_length(
    pg_catalog.coalesce(v_display_name, '')
  ) > 200 THEN
    RAISE EXCEPTION 'Display name is too long'
      USING ERRCODE = '22001';
  END IF;

  IF pg_catalog.char_length(
    pg_catalog.coalesce(v_first_name, '')
  ) > 100 THEN
    RAISE EXCEPTION 'First name is too long'
      USING ERRCODE = '22001';
  END IF;

  IF pg_catalog.char_length(
    pg_catalog.coalesce(v_last_name, '')
  ) > 100 THEN
    RAISE EXCEPTION 'Last name is too long'
      USING ERRCODE = '22001';
  END IF;

  IF v_display_name ~ '[[:cntrl:]]'
    OR v_first_name ~ '[[:cntrl:]]'
    OR v_last_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Profile names contain invalid characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_locale IS NULL
    OR v_locale = ''
    OR pg_catalog.char_length(v_locale) > 16
    OR v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  THEN
    RAISE EXCEPTION 'Locale is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_timezone IS NULL
    OR v_timezone = ''
    OR pg_catalog.char_length(v_timezone) > 64
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS timezone_record
      WHERE timezone_record.name = v_timezone
    )
  THEN
    RAISE EXCEPTION 'Timezone is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_changed :=
    v_display_name IS DISTINCT FROM v_existing.display_name
    OR v_first_name IS DISTINCT FROM v_existing.first_name
    OR v_last_name IS DISTINCT FROM v_existing.last_name
    OR v_locale IS DISTINCT FROM v_existing.locale
    OR v_timezone IS DISTINCT FROM v_existing.timezone;

  IF v_changed THEN
    UPDATE public.user_profiles
    SET
      display_name = v_display_name,
      first_name = v_first_name,
      last_name = v_last_name,
      locale = v_locale,
      timezone = v_timezone,
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_user_id
    RETURNING *
    INTO v_updated;

    INSERT INTO public.audit_events (
      id,
      organisation_id,
      actor_type,
      actor_user_profile_id,
      subject_user_profile_id,
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
      NULL,
      'USER'::public.audit_actor_type,
      v_user_id,
      v_user_id,
      'businessos-api',
      'user_profile.self_update',
      'user_profile',
      v_user_id::text,
      'SUCCESS'::public.audit_outcome,
      pg_catalog.jsonb_build_object(
        'displayName', v_existing.display_name,
        'firstName', v_existing.first_name,
        'lastName', v_existing.last_name,
        'locale', v_existing.locale,
        'timezone', v_existing.timezone
      ),
      pg_catalog.jsonb_build_object(
        'displayName', v_updated.display_name,
        'firstName', v_updated.first_name,
        'lastName', v_updated.last_name,
        'locale', v_updated.locale,
        'timezone', v_updated.timezone
      )
    );
  ELSE
    v_updated := v_existing;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_updated.id,
    'email', v_updated.email,
    'displayName', v_updated.display_name,
    'firstName', v_updated.first_name,
    'lastName', v_updated.last_name,
    'locale', v_updated.locale,
    'timezone', v_updated.timezone,
    'status', v_updated.status,
    'updatedAt', v_updated.updated_at
  );
END
$function$;

ALTER FUNCTION private.update_own_profile(jsonb)
OWNER TO postgres;

REVOKE ALL
ON FUNCTION private.update_own_profile(jsonb)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION private.update_own_profile(jsonb)
TO businessos_app;

COMMENT ON FUNCTION private.update_own_profile(jsonb) IS
  'Atomically updates the authenticated user’s permitted profile fields and records an append-only audit event. Security and lifecycle fields cannot be supplied.';