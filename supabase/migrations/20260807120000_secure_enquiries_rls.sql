-- Enquiries tenant isolation and permission-aware Row Level Security.
-- Deny-by-default: access requires an active organisation membership
-- and an active RBAC permission assignment.

CREATE OR REPLACE FUNCTION private.has_organisation_permission(
  p_organisation_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS membership
    INNER JOIN public.role_assignments AS assignment
      ON assignment.user_profile_id = membership.user_profile_id
     AND assignment.organisation_id = membership.organisation_id
     AND assignment.organisation_membership_id = membership.id
    INNER JOIN public.roles AS role_record
      ON role_record.id = assignment.role_id
     AND role_record.organisation_id = membership.organisation_id
    INNER JOIN public.role_permissions AS role_permission
      ON role_permission.role_id = role_record.id
    INNER JOIN public.permissions AS permission
      ON permission.id = role_permission.permission_id
    WHERE membership.organisation_id = p_organisation_id
      AND membership.user_profile_id = private.current_user_id()
      AND membership.status = 'ACTIVE'
      AND membership.deleted_at IS NULL
      AND assignment.revoked_at IS NULL
      AND assignment.valid_from <= pg_catalog.now()
      AND (
        assignment.valid_until IS NULL
        OR assignment.valid_until > pg_catalog.now()
      )
      AND role_record.scope = 'ORGANISATION'
      AND role_record.deleted_at IS NULL
      AND permission.key = p_permission_key
      AND permission.is_active = true
      AND permission.deleted_at IS NULL
  );
$function$;

REVOKE ALL
ON FUNCTION private.has_organisation_permission(uuid, text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION private.has_organisation_permission(uuid, text)
TO businessos_app;

COMMENT ON FUNCTION private.has_organisation_permission(uuid, text) IS
  'Checks whether the authenticated user has an active RBAC permission inside the specified organisation.';


ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiries FORCE ROW LEVEL SECURITY;


CREATE POLICY enquiries_select_policy
ON public.enquiries
FOR SELECT
TO businessos_app
USING (
  deleted_at IS NULL
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


CREATE POLICY enquiries_insert_policy
ON public.enquiries
FOR INSERT
TO businessos_app
WITH CHECK (
  private.has_organisation_permission(
    organisation_id,
    'enquiries.create'
  )
  AND created_by_user_id = private.current_user_id()
  AND updated_by_user_id = private.current_user_id()
  AND deleted_at IS NULL
);


CREATE POLICY enquiries_update_policy
ON public.enquiries
FOR UPDATE
TO businessos_app
USING (
  deleted_at IS NULL
  AND (
    private.has_organisation_permission(
      organisation_id,
      'enquiries.read_all'
    )
    OR (
      private.has_organisation_permission(
        organisation_id,
        'enquiries.update'
      )
      AND (
        assigned_to_user_id = private.current_user_id()
        OR created_by_user_id = private.current_user_id()
      )
    )
  )
)
WITH CHECK (
  private.has_organisation_permission(
    organisation_id,
    'enquiries.update'
  )
  AND updated_by_user_id = private.current_user_id()
);


CREATE POLICY enquiries_delete_policy
ON public.enquiries
FOR DELETE
TO businessos_app
USING (
  private.has_organisation_permission(
    organisation_id,
    'enquiries.delete'
  )
);


REVOKE ALL ON TABLE public.enquiries FROM PUBLIC;
REVOKE ALL ON TABLE public.enquiries FROM anon;
REVOKE ALL ON TABLE public.enquiries FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.enquiries
TO businessos_app;

COMMENT ON TABLE public.enquiries IS
  'Organisation-isolated enquiries protected by forced RLS and RBAC.';