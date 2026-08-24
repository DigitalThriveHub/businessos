BEGIN;

CREATE OR REPLACE FUNCTION private.get_operational_readiness_snapshot()
RETURNS TABLE (
  communication_ready bigint,
  scanner_ready bigint,
  scanner_dead_letter bigint,
  workflow_ready bigint,
  integration_failed_24_hours bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT
    (SELECT pg_catalog.count(*)
       FROM public.communication_messages AS message
      WHERE message.status IN ('QUEUED', 'SENDING')
        AND message.next_attempt_at <= pg_catalog.now()),
    (SELECT pg_catalog.count(*)
       FROM public.document_scan_jobs AS job
      WHERE job.status IN ('QUEUED', 'LEASED')
        AND job.next_attempt_at <= pg_catalog.now()),
    (SELECT pg_catalog.count(*)
       FROM public.document_scan_jobs AS job
      WHERE job.status = 'DEAD_LETTER'),
    (SELECT pg_catalog.count(*)
       FROM public.workflow_actions AS action
      WHERE action.status IN ('PENDING', 'READY', 'RUNNING')
        AND COALESCE(action.next_attempt_at, action.created_at) <= pg_catalog.now()),
    (SELECT pg_catalog.count(*)
       FROM public.integration_events AS event
      WHERE event.status = 'FAILED'
        AND event.received_at >= pg_catalog.now() - interval '24 hours');
$function$;

REVOKE ALL ON FUNCTION private.get_operational_readiness_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_operational_readiness_snapshot() TO businessos_app;

COMMIT;
