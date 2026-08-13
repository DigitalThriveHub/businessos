-- Correct enquiry soft deletion under forced PostgreSQL RLS.
--
-- PostgreSQL checks applicable SELECT policies against an UPDATE's new row
-- when the statement reads target-table columns. Consequently, an active-only
-- SELECT policy cannot directly transition an enquiry to deleted_at IS NOT NULL.
--
-- This migration introduces a narrowly privileged, non-login executor role and
-- a parameterised SECURITY DEFINER function. The normal application role never
-- gains visibility of soft-deleted rows.
--
-- Forward-only migration: do not modify previously applied migrations.

-- Create the executor with safe attributes. Hosted Supabase does not permit its
-- postgres role to alter SUPERUSER/BYPASSRLS attributes, so existing attributes
-- are validated instead of issuing ALTER ROLE ... NOSUPERUSER/NOBYPASSRLS.
DO $role$
DECLARE
  role_is_safe boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'businessos_enquiry_soft_deleter'
  ) THEN
    CREATE ROLE businessos_enquiry_soft_deleter
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;

  SELECT
    NOT rolsuper
    AND NOT rolcreatedb
    AND NOT rolcreaterole
    AND NOT rolinherit
    AND NOT rolcanlogin
    AND NOT rolreplication
    AND NOT rolbypassrls
  INTO role_is_safe
  FROM pg_catalog.pg_roles
  WHERE rolname = 'businessos_enquiry_soft_deleter';

  IF role_is_safe IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'businessos_enquiry_soft_deleter has unsafe role attributes';
  END IF;
END
$role$;

-- Allow the migration owner to transfer function ownership to the executor.
GRANT businessos_enquiry_soft_deleter TO postgres;

GRANT USAGE
ON SCHEMA public, private
TO businessos_enquiry_soft_deleter;

-- The executor can identify one enquiry and update only deletion metadata.
GRANT SELECT (
  id,
  organisation_id,
  deleted_at
)
ON public.enquiries
TO businessos_enquiry_soft_deleter;

GRANT UPDATE (
  deleted_at,
  updated_at,
  updated_by_user_id
)
ON public.enquiries
TO businessos_enquiry_soft_deleter;

GRANT EXECUTE
ON FUNCTION private.current_user_id()
TO businessos_enquiry_soft_deleter;

GRANT EXECUTE
ON FUNCTION private.current_organisation_id()
TO businessos_enquiry_soft_deleter;

GRANT EXECUTE
ON FUNCTION private.has_organisation_permission(uuid, text)
TO businessos_enquiry_soft_deleter;

-- These policies apply only while the narrowly scoped executor function runs.
-- The executor may see rows only inside the transaction's selected organisation.
DROP POLICY IF EXISTS enquiries_soft_delete_executor_select
ON public.enquiries;

CREATE POLICY enquiries_soft_delete_executor_select
ON public.enquiries
FOR SELECT
TO businessos_enquiry_soft_deleter
USING (
  organisation_id = private.current_organisation_id()
);

DROP POLICY IF EXISTS enquiries_soft_delete_executor_update
ON public.enquiries;

CREATE POLICY enquiries_soft_delete_executor_update
ON public.enquiries
FOR UPDATE
TO businessos_enquiry_soft_deleter
USING (
  organisation_id = private.current_organisation_id()
  AND deleted_at IS NULL
)
WITH CHECK (
  organisation_id = private.current_organisation_id()
  AND deleted_at IS NOT NULL
  AND updated_by_user_id = private.current_user_id()
);

-- Keep the ordinary application role restricted to the active current tenant.
ALTER POLICY enquiries_select_policy
ON public.enquiries
TO businessos_app
USING (
  organisation_id = private.current_organisation_id()
  AND deleted_at IS NULL
  AND (
    private.has_organisation_permission(
      organisation_id,
      'enquiries.read_all'
    )
    OR (
      private.has_organisation_permission(
        organisation_id,
        'enquiries.read'
      )
      AND (
        assigned_to_user_id = private.current_user_id()
        OR created_by_user_id = private.current_user_id()
      )
    )
  )
);

ALTER POLICY enquiries_insert_policy
ON public.enquiries
TO businessos_app
WITH CHECK (
  organisation_id = private.current_organisation_id()
  AND private.has_organisation_permission(
    organisation_id,
    'enquiries.create'
  )
  AND created_by_user_id = private.current_user_id()
  AND updated_by_user_id = private.current_user_id()
  AND deleted_at IS NULL
);

ALTER POLICY enquiries_update_policy
ON public.enquiries
TO businessos_app
USING (
  organisation_id = private.current_organisation_id()
  AND deleted_at IS NULL
  AND private.has_organisation_permission(
    organisation_id,
    'enquiries.update'
  )
  AND (
    private.has_organisation_permission(
      organisation_id,
      'enquiries.read_all'
    )
    OR assigned_to_user_id = private.current_user_id()
    OR created_by_user_id = private.current_user_id()
  )
)
WITH CHECK (
  organisation_id = private.current_organisation_id()
  AND deleted_at IS NULL
  AND updated_by_user_id = private.current_user_id()
  AND private.has_organisation_permission(
    organisation_id,
    'enquiries.update'
  )
  AND (
    private.has_organisation_permission(
      organisation_id,
      'enquiries.read_all'
    )
    OR assigned_to_user_id = private.current_user_id()
    OR created_by_user_id = private.current_user_id()
  )
);

-- Prevent the application role from changing immutable tenant/deletion fields
-- or physically deleting enquiry evidence.
REVOKE UPDATE, DELETE
ON public.enquiries
FROM businessos_app;

GRANT UPDATE (
  assigned_to_user_id,
  first_name,
  last_name,
  email,
  phone,
  country,
  service_type,
  message,
  source,
  status,
  priority,
  next_follow_up_at,
  last_contacted_at,
  converted_at,
  updated_by_user_id,
  updated_at
)
ON public.enquiries
TO businessos_app;

DROP POLICY IF EXISTS enquiries_delete_policy
ON public.enquiries;

-- Temporarily permit ownership transfer into the protected private schema.
GRANT CREATE
ON SCHEMA private
TO businessos_enquiry_soft_deleter;

CREATE OR REPLACE FUNCTION private.soft_delete_enquiry(
  p_enquiry_id uuid,
  p_organisation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_changed_at timestamptz;
  v_affected_rows integer;
BEGIN
  v_user_id := private.current_user_id();

  IF v_user_id IS NULL
    OR private.current_organisation_id()
      IS DISTINCT FROM p_organisation_id
    OR NOT private.has_organisation_permission(
      p_organisation_id,
      'enquiries.delete'
    )
  THEN
    RAISE EXCEPTION 'Enquiry soft deletion is not permitted'
      USING ERRCODE = '42501';
  END IF;

  v_changed_at := pg_catalog.clock_timestamp();

  UPDATE public.enquiries
  SET
    deleted_at = v_changed_at,
    updated_at = v_changed_at,
    updated_by_user_id = v_user_id
  WHERE id = p_enquiry_id
    AND organisation_id = p_organisation_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;

  RETURN v_affected_rows = 1;
END
$function$;

ALTER FUNCTION private.soft_delete_enquiry(uuid, uuid)
OWNER TO businessos_enquiry_soft_deleter;

REVOKE CREATE
ON SCHEMA private
FROM businessos_enquiry_soft_deleter;

REVOKE ALL
ON FUNCTION private.soft_delete_enquiry(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION private.soft_delete_enquiry(uuid, uuid)
TO businessos_app;

COMMENT ON FUNCTION private.soft_delete_enquiry(uuid, uuid) IS
  'Atomically soft-deletes one active enquiry after validating transaction tenant context and enquiries.delete permission. Returns no enquiry data.';

COMMENT ON POLICY enquiries_select_policy
ON public.enquiries IS
  'Allows authorised reads of active enquiries inside the selected transaction organisation only.';

COMMENT ON POLICY enquiries_update_policy
ON public.enquiries IS
  'Allows authorised updates of active enquiries only; deletion is restricted to private.soft_delete_enquiry().';