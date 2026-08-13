-- Permit authorised soft deletion while preserving tenant isolation.
-- Deleted enquiries remain accessible only to users holding
-- the sensitive enquiries.delete permission.

ALTER POLICY enquiries_select_policy
ON public.enquiries
USING (
  (
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
  )
  OR (
    deleted_at IS NOT NULL
    AND private.has_organisation_permission(
      organisation_id,
      'enquiries.delete'
    )
  )
);

ALTER POLICY enquiries_update_policy
ON public.enquiries
USING (
  deleted_at IS NULL
  AND (
    private.has_organisation_permission(
      organisation_id,
      'enquiries.delete'
    )
    OR private.has_organisation_permission(
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