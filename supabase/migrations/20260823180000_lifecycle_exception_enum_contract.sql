-- Keep lifecycle exception status expressions enum-safe on PostgreSQL.

BEGIN;

CREATE OR REPLACE FUNCTION private.create_lifecycle_exception(
  p_matter uuid,
  p_category text,
  p_severity text,
  p_title text,
  p_detail text,
  p_owner uuid,
  p_due_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  org uuid := private.current_organisation_id();
  actor uuid := private.current_user_id();
  result uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF actor IS NULL
    OR org IS NULL
    OR NOT private.has_organisation_permission(org, 'engagements.manage')
    OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 lifecycle authority required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_severity NOT IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    OR char_length(btrim(p_category)) NOT BETWEEN 2 AND 80
    OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 240
    OR char_length(btrim(p_detail)) < 10 THEN
    RAISE EXCEPTION 'invalid lifecycle exception'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_matter IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.matters AS matter
    WHERE matter.id = p_matter
      AND matter.organisation_id = org
      AND matter.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'matter unavailable' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_owner IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS membership
    WHERE membership.organisation_id = org
      AND membership.user_profile_id = p_owner
      AND membership.status = 'ACTIVE'::public.membership_status
      AND membership.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'exception owner unavailable'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.lifecycle_exceptions (
    id,
    organisation_id,
    matter_id,
    category,
    severity,
    status,
    title,
    detail,
    owner_user_id,
    due_at,
    created_by_user_id
  ) VALUES (
    result,
    org,
    p_matter,
    upper(btrim(p_category)),
    p_severity,
    CASE
      WHEN p_owner IS NULL THEN 'OPEN'::public.lifecycle_exception_status
      ELSE 'ASSIGNED'::public.lifecycle_exception_status
    END,
    btrim(p_title),
    btrim(p_detail),
    p_owner,
    p_due_at,
    actor
  );

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
    metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(),
    org,
    'USER'::public.audit_actor_type,
    actor,
    'businessos-api',
    'lifecycle.exception.created',
    'lifecycle_exception',
    result::text,
    'SUCCESS'::public.audit_outcome,
    pg_catalog.jsonb_build_object(
      'matterId', p_matter,
      'category', upper(btrim(p_category)),
      'severity', p_severity
    )
  );

  RETURN result;
END;
$function$;

ALTER FUNCTION private.create_lifecycle_exception(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  timestamptz
) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.create_lifecycle_exception(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.create_lifecycle_exception(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  timestamptz
) TO businessos_app;

COMMIT;
