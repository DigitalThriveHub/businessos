-- Keep accepted client-portal-only identities out of organisation bootstrap.
--
-- The original function remains the atomic implementation, but is renamed to
-- an inaccessible core function. The public application entry point applies
-- the account-mode guard before invoking that implementation.

ALTER FUNCTION private.bootstrap_organisation(
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
) RENAME TO bootstrap_organisation_core;

REVOKE ALL ON FUNCTION private.bootstrap_organisation_core(
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
) FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE FUNCTION private.bootstrap_organisation(
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
  v_user_id uuid := private.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile_record
    WHERE profile_record.id = v_user_id
      AND profile_record.status = 'ACTIVE'
      AND profile_record.deleted_at IS NULL
      AND profile_record.metadata ->> 'identityType' = 'CLIENT_PORTAL'
      AND NOT EXISTS (
        SELECT 1
        FROM public.organisation_memberships AS membership_record
        WHERE membership_record.user_profile_id = v_user_id
          AND membership_record.status = 'ACTIVE'
          AND membership_record.deleted_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Client portal identities cannot bootstrap organisations'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    bootstrap_result.organisation_id,
    bootstrap_result.organisation_slug,
    bootstrap_result.membership_id,
    bootstrap_result.owner_role_id,
    bootstrap_result.owner_role_assignment_id,
    bootstrap_result.status
  FROM private.bootstrap_organisation_core(
    p_name,
    p_slug,
    p_legal_name,
    p_owner_email,
    p_owner_display_name,
    p_owner_first_name,
    p_owner_last_name,
    p_owner_job_title,
    p_timezone,
    p_locale,
    p_country_code
  ) AS bootstrap_result;
END
$function$;

REVOKE ALL ON FUNCTION private.bootstrap_organisation(
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
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.bootstrap_organisation(
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
) TO businessos_app;

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
  'Atomically provisions an organisation after rejecting portal-only account identities.';
