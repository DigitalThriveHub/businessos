-- Keep automation evidence consistent when an enquiry, client or matter is
-- soft-deleted. Terminal transitions must remain possible even after the
-- referenced subject or assigned workforce member becomes unavailable.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

CREATE OR REPLACE FUNCTION private.validate_workflow_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT private.automation_subject_exists(
      NEW.organisation_id,
      NEW.subject_type,
      NEW.subject_id
    ) THEN
      RAISE EXCEPTION 'workflow subject is unavailable'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT private.automation_user_is_active(
      NEW.organisation_id,
      NEW.owner_user_id
    ) OR NOT private.automation_team_is_active(
      NEW.organisation_id,
      NEW.owner_team_id
    ) THEN
      RAISE EXCEPTION 'workflow owner must be active in the organisation'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.started_by_actor_type IN ('USER', 'SUPPORT')
       AND private.current_user_id() IS NOT NULL
       AND NEW.started_by_user_profile_id IS DISTINCT FROM
         private.current_user_id() THEN
      RAISE EXCEPTION 'workflow actor must match authenticated actor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.owner_team_id IS DISTINCT FROM OLD.owner_team_id THEN
      IF NOT private.automation_user_is_active(
        NEW.organisation_id,
        NEW.owner_user_id
      ) OR NOT private.automation_team_is_active(
        NEW.organisation_id,
        NEW.owner_team_id
      ) THEN
        RAISE EXCEPTION 'workflow owner must be active in the organisation'
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;

    IF OLD.status IN ('COMPLETED', 'CANCELLED', 'DEAD_LETTER')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal workflow run cannot transition'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'workflow run version must increment exactly once'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_workflow_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT private.automation_user_is_active(
      NEW.organisation_id,
      NEW.owner_user_id
    ) OR NOT private.automation_team_is_active(
      NEW.organisation_id,
      NEW.owner_team_id
    ) THEN
      RAISE EXCEPTION 'workflow action owner must be active in the organisation'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSIF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
        OR NEW.owner_team_id IS DISTINCT FROM OLD.owner_team_id THEN
    IF NOT private.automation_user_is_active(
      NEW.organisation_id,
      NEW.owner_user_id
    ) OR NOT private.automation_team_is_active(
      NEW.organisation_id,
      NEW.owner_team_id
    ) THEN
      RAISE EXCEPTION 'workflow action owner must be active in the organisation'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.action_type = 'HUMAN_TASK'
     AND NEW.status NOT IN ('READY', 'WAITING') THEN
    RAISE EXCEPTION 'human workflow tasks must start READY or WAITING'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal workflow action cannot transition'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'workflow action version must increment exactly once'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_sla_instance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  relation_subject_type public.automation_subject_type;
  relation_subject_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT private.automation_subject_exists(
      NEW.organisation_id,
      NEW.subject_type,
      NEW.subject_id
    ) THEN
      RAISE EXCEPTION 'SLA subject is unavailable'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT private.automation_user_is_active(
      NEW.organisation_id,
      NEW.owner_user_id
    ) OR NOT private.automation_team_is_active(
      NEW.organisation_id,
      NEW.owner_team_id
    ) THEN
      RAISE EXCEPTION 'SLA owner must be active in the organisation'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.workflow_run_id IS NOT NULL THEN
      SELECT run.subject_type, run.subject_id
        INTO relation_subject_type, relation_subject_id
      FROM public.workflow_runs AS run
      WHERE run.id = NEW.workflow_run_id
        AND run.organisation_id = NEW.organisation_id;

      IF relation_subject_type IS DISTINCT FROM NEW.subject_type
         OR relation_subject_id IS DISTINCT FROM NEW.subject_id THEN
        RAISE EXCEPTION 'SLA subject must match its workflow run'
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;

    IF NEW.workflow_action_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_actions AS action
      WHERE action.id = NEW.workflow_action_id
        AND action.organisation_id = NEW.organisation_id
        AND (
          NEW.workflow_run_id IS NULL
          OR action.workflow_run_id = NEW.workflow_run_id
        )
    ) THEN
      RAISE EXCEPTION 'SLA action must belong to its workflow run'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSE
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.owner_team_id IS DISTINCT FROM OLD.owner_team_id THEN
      IF NOT private.automation_user_is_active(
        NEW.organisation_id,
        NEW.owner_user_id
      ) OR NOT private.automation_team_is_active(
        NEW.organisation_id,
        NEW.owner_team_id
      ) THEN
        RAISE EXCEPTION 'SLA owner must be active in the organisation'
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;

    IF OLD.status IN ('SATISFIED', 'CANCELLED')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal SLA cannot transition'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF OLD.status = 'BREACHED' AND NEW.status = 'AT_RISK' THEN
      RAISE EXCEPTION 'breached SLA cannot return to at risk'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'SLA version must increment exactly once'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_approval_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  run_subject_type public.automation_subject_type;
  run_subject_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT private.automation_subject_exists(
      NEW.organisation_id,
      NEW.subject_type,
      NEW.subject_id
    ) THEN
      RAISE EXCEPTION 'approval subject is unavailable'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT private.automation_user_is_active(
      NEW.organisation_id,
      NEW.requested_by_user_profile_id
    ) OR NOT private.automation_user_is_active(
      NEW.organisation_id,
      NEW.approver_user_id
    ) OR NOT private.automation_team_is_active(
      NEW.organisation_id,
      NEW.approver_team_id
    ) THEN
      RAISE EXCEPTION 'approval participants must be active in the organisation'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.workflow_run_id IS NOT NULL THEN
      SELECT run.subject_type, run.subject_id
        INTO run_subject_type, run_subject_id
      FROM public.workflow_runs AS run
      WHERE run.id = NEW.workflow_run_id
        AND run.organisation_id = NEW.organisation_id;

      IF run_subject_type IS DISTINCT FROM NEW.subject_type
         OR run_subject_id IS DISTINCT FROM NEW.subject_id THEN
        RAISE EXCEPTION 'approval subject must match its workflow run'
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;

    IF NEW.workflow_action_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_actions AS action
      JOIN public.workflow_runs AS action_run
        ON action_run.id = action.workflow_run_id
       AND action_run.organisation_id = action.organisation_id
      WHERE action.id = NEW.workflow_action_id
        AND action.organisation_id = NEW.organisation_id
        AND action.workflow_run_id = NEW.workflow_run_id
        AND action_run.subject_type = NEW.subject_type
        AND action_run.subject_id = NEW.subject_id
        AND action.requires_approval
        AND action.status IN ('PENDING', 'WAITING')
    ) THEN
      RAISE EXCEPTION 'approval action is not awaiting approval for this subject'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.requested_by_actor_type IN ('USER', 'SUPPORT')
       AND private.current_user_id() IS NOT NULL
       AND NEW.requested_by_user_profile_id IS DISTINCT FROM
         private.current_user_id() THEN
      RAISE EXCEPTION 'approval requester must match authenticated actor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'new approval requests must start pending'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal approval request cannot transition'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'approval version must increment exactly once'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.validate_workflow_run()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;
REVOKE ALL ON FUNCTION private.validate_workflow_action()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;
REVOKE ALL ON FUNCTION private.validate_sla_instance()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;
REVOKE ALL ON FUNCTION private.validate_approval_request()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE OR REPLACE FUNCTION private.cancel_automation_for_subject(
  p_organisation_id uuid,
  p_subject_type public.automation_subject_type,
  p_subject_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_cancellation_time timestamptz := pg_catalog.clock_timestamp();
  v_cancellation_reason text := pg_catalog.left(
    COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''),
      'The automation subject is no longer available.'),
    1000
  );
BEGIN
  IF p_organisation_id IS NULL
     OR p_subject_type IS NULL
     OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'automation cancellation subject is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH cancelled AS (
    UPDATE public.sla_instances AS instance
    SET status = 'CANCELLED',
        cancelled_at = v_cancellation_time,
        cancellation_reason = v_cancellation_reason,
        updated_at = v_cancellation_time,
        version = instance.version + 1
    WHERE instance.organisation_id = p_organisation_id
      AND instance.subject_type = p_subject_type
      AND instance.subject_id = p_subject_id
      AND instance.status IN ('ACTIVE', 'AT_RISK', 'BREACHED')
    RETURNING instance.id, instance.organisation_id
  )
  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, source, action,
    resource_type, resource_id, outcome, reason, metadata
  )
  SELECT
    pg_catalog.gen_random_uuid(), cancelled.organisation_id,
    'SYSTEM', 'businessos-automation-lifecycle', 'sla.cancelled',
    'sla_instance', cancelled.id::text, 'SUCCESS', v_cancellation_reason,
    jsonb_build_object(
      'subjectType', p_subject_type,
      'subjectId', p_subject_id
    )
  FROM cancelled;

  UPDATE public.approval_requests AS approval
  SET status = 'CANCELLED',
      cancelled_at = v_cancellation_time,
      cancellation_reason = v_cancellation_reason,
      updated_at = v_cancellation_time,
      version = approval.version + 1
  WHERE approval.organisation_id = p_organisation_id
    AND approval.subject_type = p_subject_type
    AND approval.subject_id = p_subject_id
    AND approval.status = 'PENDING';

  UPDATE public.workflow_actions AS action
  SET status = 'CANCELLED',
      last_error_code = 'SUBJECT_UNAVAILABLE',
      last_error_detail = v_cancellation_reason,
      updated_at = v_cancellation_time,
      version = action.version + 1
  WHERE action.organisation_id = p_organisation_id
    AND action.workflow_run_id IN (
      SELECT run.id
      FROM public.workflow_runs AS run
      WHERE run.organisation_id = p_organisation_id
        AND run.subject_type = p_subject_type
        AND run.subject_id = p_subject_id
    )
    AND action.status IN ('PENDING', 'READY', 'RUNNING', 'WAITING', 'FAILED');

  WITH cancelled AS (
    UPDATE public.workflow_runs AS run
    SET status = 'CANCELLED',
        next_action_summary = NULL,
        next_action_at = NULL,
        last_error_code = 'SUBJECT_UNAVAILABLE',
        last_error_detail = v_cancellation_reason,
        failed_at = NULL,
        updated_at = v_cancellation_time,
        version = run.version + 1
    WHERE run.organisation_id = p_organisation_id
      AND run.subject_type = p_subject_type
      AND run.subject_id = p_subject_id
      AND run.status IN ('RUNNING', 'WAITING', 'FAILED')
    RETURNING run.id, run.organisation_id
  )
  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, source, action,
    resource_type, resource_id, outcome, reason, metadata
  )
  SELECT
    pg_catalog.gen_random_uuid(), cancelled.organisation_id,
    'SYSTEM', 'businessos-automation-lifecycle', 'workflow.cancelled',
    'workflow_run', cancelled.id::text, 'SUCCESS', v_cancellation_reason,
    jsonb_build_object(
      'subjectType', p_subject_type,
      'subjectId', p_subject_id
    )
  FROM cancelled;
END
$function$;

CREATE OR REPLACE FUNCTION private.cancel_automation_on_subject_delete()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  subject_type public.automation_subject_type;
  old_deleted_at timestamptz;
  new_deleted_at timestamptz;
  organisation_id uuid;
  subject_id uuid;
BEGIN
  subject_type := CASE TG_TABLE_NAME
    WHEN 'enquiries' THEN 'ENQUIRY'::public.automation_subject_type
    WHEN 'clients' THEN 'CLIENT'::public.automation_subject_type
    WHEN 'matters' THEN 'MATTER'::public.automation_subject_type
    ELSE NULL
  END;

  IF subject_type IS NULL OR TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION 'unsupported automation subject table: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  old_deleted_at := NULLIF(pg_catalog.to_jsonb(OLD) ->> 'deleted_at', '')::timestamptz;
  new_deleted_at := NULLIF(pg_catalog.to_jsonb(NEW) ->> 'deleted_at', '')::timestamptz;

  IF old_deleted_at IS NULL AND new_deleted_at IS NOT NULL THEN
    organisation_id := NULLIF(
      pg_catalog.to_jsonb(NEW) ->> 'organisation_id',
      ''
    )::uuid;
    subject_id := NULLIF(pg_catalog.to_jsonb(NEW) ->> 'id', '')::uuid;

    PERFORM private.cancel_automation_for_subject(
      organisation_id,
      subject_type,
      subject_id,
      'The linked subject was archived or deleted.'
    );
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.cancel_automation_for_subject(
  uuid, public.automation_subject_type, uuid, text
) OWNER TO postgres;
ALTER FUNCTION private.cancel_automation_on_subject_delete()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.cancel_automation_for_subject(
  uuid, public.automation_subject_type, uuid, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_app;
REVOKE ALL ON FUNCTION private.cancel_automation_on_subject_delete()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE TRIGGER enquiries_cancel_automation_on_delete
AFTER UPDATE OF deleted_at ON public.enquiries
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION private.cancel_automation_on_subject_delete();

CREATE TRIGGER clients_cancel_automation_on_delete
AFTER UPDATE OF deleted_at ON public.clients
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION private.cancel_automation_on_subject_delete();

CREATE TRIGGER matters_cancel_automation_on_delete
AFTER UPDATE OF deleted_at ON public.matters
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION private.cancel_automation_on_subject_delete();

DO $cancel_existing_orphans$
DECLARE
  orphan record;
BEGIN
  FOR orphan IN
    SELECT DISTINCT
      candidate.organisation_id,
      candidate.subject_type,
      candidate.subject_id
    FROM (
      SELECT run.organisation_id, run.subject_type, run.subject_id
      FROM public.workflow_runs AS run
      WHERE run.status IN ('RUNNING', 'WAITING', 'FAILED')
      UNION ALL
      SELECT run.organisation_id, run.subject_type, run.subject_id
      FROM public.workflow_actions AS action
      JOIN public.workflow_runs AS run
        ON run.id = action.workflow_run_id
       AND run.organisation_id = action.organisation_id
      WHERE action.status IN (
        'PENDING', 'READY', 'RUNNING', 'WAITING', 'FAILED'
      )
      UNION ALL
      SELECT instance.organisation_id, instance.subject_type, instance.subject_id
      FROM public.sla_instances AS instance
      WHERE instance.status IN ('ACTIVE', 'AT_RISK', 'BREACHED')
      UNION ALL
      SELECT approval.organisation_id, approval.subject_type, approval.subject_id
      FROM public.approval_requests AS approval
      WHERE approval.status = 'PENDING'
    ) AS candidate
    WHERE NOT private.automation_subject_exists(
      candidate.organisation_id,
      candidate.subject_type,
      candidate.subject_id
    )
  LOOP
    PERFORM private.cancel_automation_for_subject(
      orphan.organisation_id,
      orphan.subject_type,
      orphan.subject_id,
      'The linked subject was unavailable during lifecycle reconciliation.'
    );
  END LOOP;
END
$cancel_existing_orphans$;

COMMIT;
