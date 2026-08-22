-- Permit only the BusinessOS application database role to execute the
-- tenant-aware automation subject visibility helper used by RLS policies.

REVOKE ALL ON FUNCTION private.can_read_automation_subject(
  uuid,
  public.automation_subject_type,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.can_read_automation_subject(
  uuid,
  public.automation_subject_type,
  uuid
) TO businessos_app;
