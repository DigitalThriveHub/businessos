-- Harden enquiry soft deletion while preserving strict tenant isolation.
--
-- Prisma updateMany() performs the soft-delete operation without returning
-- the newly hidden enquiry row.
--
-- Deleted enquiries must not remain visible through normal application
-- SELECT queries, including to users holding enquiries.delete permission.
--
-- This is a forward-only migration. Do not modify previously applied
-- enquiry RLS migrations.

ALTER POLICY enquiries_select_policy
ON public.enquiries
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

ALTER POLICY enquiries_update_policy
ON public.enquiries
TO businessos_app
USING (
  deleted_at IS NULL
  AND (
    private.has_organisation_permission(
      organisation_id,
      'enquiries.delete'
    )
    OR (
      private.has_organisation_permission(
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
  )
)
WITH CHECK (
  updated_by_user_id = private.current_user_id()
  AND (
    (
      deleted_at IS NULL
      AND private.has_organisation_permission(
        organisation_id,
        'enquiries.update'
      )
    )
    OR (
      deleted_at IS NOT NULL
      AND private.has_organisation_permission(
        organisation_id,
        'enquiries.delete'
      )
    )
  )
);

COMMENT ON POLICY enquiries_select_policy
ON public.enquiries IS
  'Allows authorised access to active enquiries only; soft-deleted enquiries remain hidden.';

COMMENT ON POLICY enquiries_update_policy
ON public.enquiries IS
  'Allows authorised tenant-scoped enquiry updates and non-returning soft deletion with actor attribution.';