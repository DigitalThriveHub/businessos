-- Gate J: evidence-backed local pilot readiness, role acceptance and defect control.
BEGIN;

CREATE TYPE public.pilot_acceptance_status AS ENUM ('NOT_TESTED', 'PASS', 'FAIL', 'BLOCKED');
CREATE TYPE public.pilot_feedback_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE public.pilot_feedback_status AS ENUM ('OPEN', 'TRIAGED', 'RESOLVED', 'ACCEPTED_RISK');

CREATE TABLE public.pilot_acceptance_evidence (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  acceptance_key varchar(80) NOT NULL,
  role_name varchar(120) NOT NULL,
  scenario_name varchar(240) NOT NULL,
  status public.pilot_acceptance_status NOT NULL DEFAULT 'NOT_TESTED',
  evidence_note varchar(2000),
  evidence_reference varchar(1000),
  tested_by_user_id uuid REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  tested_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_pilot_acceptance_org_key UNIQUE (organisation_id, acceptance_key),
  CONSTRAINT ck_pilot_acceptance_key CHECK (acceptance_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  CONSTRAINT ck_pilot_acceptance_names CHECK (
    char_length(btrim(role_name)) BETWEEN 2 AND 120
    AND char_length(btrim(scenario_name)) BETWEEN 3 AND 240
  ),
  CONSTRAINT ck_pilot_acceptance_evidence CHECK (
    status = 'NOT_TESTED'
    OR (tested_by_user_id IS NOT NULL AND tested_at IS NOT NULL
      AND evidence_note IS NOT NULL AND char_length(btrim(evidence_note)) >= 10)
  ),
  CONSTRAINT ck_pilot_acceptance_version CHECK (version > 0)
);

CREATE TABLE public.pilot_feedback (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  reporter_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  affected_role varchar(120) NOT NULL,
  severity public.pilot_feedback_severity NOT NULL,
  title varchar(240) NOT NULL,
  detail varchar(4000) NOT NULL,
  reproduction_steps varchar(4000) NOT NULL,
  status public.pilot_feedback_status NOT NULL DEFAULT 'OPEN',
  resolution varchar(4000),
  resolved_by_user_id uuid REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  resolved_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT ck_pilot_feedback_text CHECK (
    char_length(btrim(affected_role)) BETWEEN 2 AND 120
    AND char_length(btrim(title)) BETWEEN 3 AND 240
    AND char_length(btrim(detail)) BETWEEN 10 AND 4000
    AND char_length(btrim(reproduction_steps)) BETWEEN 10 AND 4000
  ),
  CONSTRAINT ck_pilot_feedback_resolution CHECK (
    (status IN ('OPEN', 'TRIAGED') AND resolution IS NULL AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
    OR (status IN ('RESOLVED', 'ACCEPTED_RISK') AND resolution IS NOT NULL
      AND char_length(btrim(resolution)) >= 10 AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)
  ),
  CONSTRAINT ck_pilot_feedback_version CHECK (version > 0)
);

CREATE INDEX ix_pilot_acceptance_org_status ON public.pilot_acceptance_evidence(organisation_id, status);
CREATE INDEX ix_pilot_feedback_org_status_severity ON public.pilot_feedback(organisation_id, status, severity, created_at DESC);

CREATE OR REPLACE FUNCTION private.upsert_pilot_acceptance(
  p_key text, p_role_name text, p_scenario_name text,
  p_status public.pilot_acceptance_status, p_evidence_note text,
  p_evidence_reference text, p_expected_version integer DEFAULT NULL
)
RETURNS public.pilot_acceptance_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_record public.pilot_acceptance_evidence;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'organisation.update')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 pilot-management authority required' USING ERRCODE = '42501';
  END IF;
  IF p_key !~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
     OR char_length(btrim(p_role_name)) NOT BETWEEN 2 AND 120
     OR char_length(btrim(p_scenario_name)) NOT BETWEEN 3 AND 240
     OR btrim(p_role_name) NOT IN ('Client','Sales','Administrator','Caseworker','Solicitor','Finance','Manager','Director')
     OR p_key <> 'role.' || lower(btrim(p_role_name)) THEN
    RAISE EXCEPTION 'invalid pilot acceptance definition' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'NOT_TESTED' AND char_length(btrim(COALESCE(p_evidence_note, ''))) < 10 THEN
    RAISE EXCEPTION 'acceptance evidence note is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pilot_acceptance_evidence(
    organisation_id, acceptance_key, role_name, scenario_name, status,
    evidence_note, evidence_reference, tested_by_user_id, tested_at
  ) VALUES (
    v_org, p_key, btrim(p_role_name), btrim(p_scenario_name), p_status,
    NULLIF(btrim(p_evidence_note), ''), NULLIF(btrim(p_evidence_reference), ''),
    CASE WHEN p_status = 'NOT_TESTED' THEN NULL ELSE v_user END,
    CASE WHEN p_status = 'NOT_TESTED' THEN NULL ELSE pg_catalog.now() END
  )
  ON CONFLICT (organisation_id, acceptance_key) DO UPDATE SET
    role_name = EXCLUDED.role_name,
    scenario_name = EXCLUDED.scenario_name,
    status = EXCLUDED.status,
    evidence_note = EXCLUDED.evidence_note,
    evidence_reference = EXCLUDED.evidence_reference,
    tested_by_user_id = EXCLUDED.tested_by_user_id,
    tested_at = EXCLUDED.tested_at,
    version = pilot_acceptance_evidence.version + 1,
    updated_at = pg_catalog.now()
  WHERE p_expected_version IS NULL OR pilot_acceptance_evidence.version = p_expected_version
  RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'pilot acceptance changed concurrently' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-web',
    'pilot.acceptance.updated', 'pilot_acceptance_evidence', v_record.id::text,
    'SUCCESS', jsonb_build_object('key', p_key, 'status', p_status::text, 'version', v_record.version)
  );
  RETURN v_record;
END
$function$;

CREATE OR REPLACE FUNCTION private.create_pilot_feedback(
  p_affected_role text, p_severity public.pilot_feedback_severity,
  p_title text, p_detail text, p_reproduction_steps text
)
RETURNS public.pilot_feedback
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_record public.pilot_feedback;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'command_centre.read') THEN
    RAISE EXCEPTION 'pilot feedback authority required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.pilot_feedback(
    organisation_id, reporter_user_id, affected_role, severity, title, detail, reproduction_steps
  ) VALUES (
    v_org, v_user, btrim(p_affected_role), p_severity, btrim(p_title),
    btrim(p_detail), btrim(p_reproduction_steps)
  ) RETURNING * INTO v_record;
  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-web',
    'pilot.feedback.created', 'pilot_feedback', v_record.id::text, 'SUCCESS',
    jsonb_build_object('severity', p_severity::text, 'affectedRole', btrim(p_affected_role))
  );
  RETURN v_record;
END
$function$;

CREATE OR REPLACE FUNCTION private.resolve_pilot_feedback(
  p_feedback_id uuid, p_status public.pilot_feedback_status,
  p_resolution text, p_expected_version integer
)
RETURNS public.pilot_feedback
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_record public.pilot_feedback;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'organisation.update')
     OR private.current_aal() <> 'AAL2'
     OR p_status NOT IN ('RESOLVED', 'ACCEPTED_RISK')
     OR char_length(btrim(COALESCE(p_resolution, ''))) < 10 THEN
    RAISE EXCEPTION 'valid AAL2 pilot resolution authority is required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pilot_feedback SET
    status = p_status, resolution = btrim(p_resolution), resolved_by_user_id = v_user,
    resolved_at = pg_catalog.now(), updated_at = pg_catalog.now(), version = version + 1
  WHERE id = p_feedback_id AND organisation_id = v_org AND version = p_expected_version
  RETURNING * INTO v_record;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'pilot feedback is unavailable or changed concurrently' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-web',
    'pilot.feedback.resolved', 'pilot_feedback', v_record.id::text, 'SUCCESS',
    jsonb_build_object('status', p_status::text, 'version', v_record.version)
  );
  RETURN v_record;
END
$function$;

CREATE OR REPLACE FUNCTION private.get_local_pilot_readiness()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_checks jsonb;
  v_manual jsonb;
  v_feedback jsonb;
  v_ready integer;
  v_total integer;
  v_manual_pass integer;
  v_critical integer;
BEGIN
  IF v_org IS NULL OR NOT private.has_organisation_permission(v_org, 'command_centre.read') THEN
    RAISE EXCEPTION 'pilot readiness access denied' USING ERRCODE = '42501';
  END IF;

  WITH checks(key, category, title, ready, detail) AS (VALUES
    ('organisation_profile', 'FOUNDATION', 'Organisation profile is complete',
      EXISTS(SELECT 1 FROM public.organisations o WHERE o.id=v_org AND o.status='ACTIVE' AND o.legal_name IS NOT NULL),
      'Active organisation with a legal name'),
    ('staff_separation', 'PEOPLE', 'At least two active staff identities exist',
      (SELECT count(*) >= 2 FROM public.organisation_memberships m WHERE m.organisation_id=v_org AND m.status='ACTIVE'),
      'Supports separation of operational and approval duties'),
    ('workforce_model', 'PEOPLE', 'Active job profiles and workforce assignments exist',
      (SELECT count(*) >= 2 FROM public.job_profiles j WHERE j.organisation_id=v_org AND j.is_active)
      AND EXISTS(SELECT 1 FROM public.workforce_assignments w WHERE w.organisation_id=v_org AND w.status='ACTIVE'),
      'Role accountability is configured'),
    ('intake', 'CUSTOMER_JOURNEY', 'A public or signed intake channel is active',
      EXISTS(SELECT 1 FROM public.intake_forms f WHERE f.organisation_id=v_org AND f.status='ACTIVE')
      OR EXISTS(SELECT 1 FROM public.integration_connections c WHERE c.organisation_id=v_org AND c.status='ACTIVE' AND c.provider IN ('WORDPRESS','GENERIC')),
      'New enquiries can enter without re-keying'),
    ('finance', 'COMMERCIAL', 'UK finance settings are complete',
      EXISTS(SELECT 1 FROM public.finance_settings f WHERE f.organisation_id=v_org AND f.legal_name IS NOT NULL
        AND f.address_line_1 IS NOT NULL AND f.city IS NOT NULL AND f.postal_code IS NOT NULL AND f.base_currency='GBP'),
      'Invoices and payments have an identified UK seller'),
    ('workflow', 'OPERATIONS', 'A published workflow is active',
      EXISTS(SELECT 1 FROM public.workflow_definitions w WHERE w.organisation_id=v_org AND w.status='ACTIVE'),
      'Work is created and controlled consistently'),
    ('sla', 'OPERATIONS', 'An operational SLA policy is active',
      EXISTS(SELECT 1 FROM public.sla_policies s WHERE s.organisation_id=v_org AND s.is_active AND s.deleted_at IS NULL),
      'Delays can be detected and escalated'),
    ('communications', 'CUSTOMER_JOURNEY', 'An approved communication template is active',
      EXISTS(SELECT 1 FROM public.communication_templates t WHERE t.organisation_id=v_org AND t.status='ACTIVE' AND t.deleted_at IS NULL),
      'Routine customer messages are controlled'),
    ('lifecycle_evidence', 'CUSTOMER_JOURNEY', 'A complete client-to-income journey is evidenced',
      EXISTS(SELECT 1 FROM public.service_engagements e JOIN public.matters m ON m.id=e.matter_id AND m.organisation_id=e.organisation_id
        WHERE e.organisation_id=v_org AND e.status IN ('ACTIVE','COMPLETED'))
      AND EXISTS(SELECT 1 FROM public.finance_documents d WHERE d.organisation_id=v_org AND d.status IN ('PARTIALLY_PAID','PAID')),
      'Engagement, controlled work and collected income are connected'),
    ('matter_control', 'DATA_QUALITY', 'Active matters have responsible staff',
      NOT EXISTS(SELECT 1 FROM public.matters m WHERE m.organisation_id=v_org
        AND m.status NOT IN ('CLOSED','CANCELLED','ARCHIVED')
        AND (m.assigned_to_user_id IS NULL OR m.supervisor_user_id IS NULL)),
      'No active matter is ownerless or unsupervised'),
    ('queue_health', 'RISK', 'No critical failed operational queues exist',
      NOT EXISTS(SELECT 1 FROM public.document_scan_jobs j WHERE j.organisation_id=v_org AND j.status='DEAD_LETTER')
      AND NOT EXISTS(SELECT 1 FROM public.workflow_runs r WHERE r.organisation_id=v_org AND r.status='DEAD_LETTER'),
      'Scanner and automation failures are cleared'),
    ('aal2', 'SECURITY', 'Pilot administrator is using MFA assurance',
      private.current_aal()='AAL2', 'Sensitive pilot decisions require AAL2')
  )
  SELECT jsonb_agg(jsonb_build_object('key',key,'category',category,'title',title,'ready',ready,'detail',detail) ORDER BY category,key),
         count(*) FILTER (WHERE ready), count(*)
  INTO v_checks, v_ready, v_total FROM checks;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id,'key',e.acceptance_key,'roleName',e.role_name,'scenarioName',e.scenario_name,
      'status',e.status,'evidenceNote',e.evidence_note,'evidenceReference',e.evidence_reference,
      'testedAt',e.tested_at,'version',e.version) ORDER BY e.role_name,e.acceptance_key),'[]'::jsonb),
    count(DISTINCT e.role_name) FILTER (WHERE e.status='PASS')
  INTO v_manual, v_manual_pass
  FROM public.pilot_acceptance_evidence e WHERE e.organisation_id=v_org;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',f.id,'affectedRole',f.affected_role,'severity',f.severity,'title',f.title,
      'detail',f.detail,'reproductionSteps',f.reproduction_steps,'status',f.status,
      'resolution',f.resolution,'createdAt',f.created_at,'version',f.version)
      ORDER BY f.created_at DESC),'[]'::jsonb),
    count(*) FILTER (WHERE f.status IN ('OPEN','TRIAGED') AND f.severity IN ('HIGH','CRITICAL'))
  INTO v_feedback, v_critical FROM public.pilot_feedback f WHERE f.organisation_id=v_org;

  RETURN jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'summary', jsonb_build_object(
      'systemChecksReady', v_ready, 'systemChecksTotal', v_total,
      'roleAcceptancesPassed', v_manual_pass, 'roleAcceptancesRequired', 8,
      'openHighCriticalDefects', v_critical,
      'readyForPilot', v_ready=v_total AND v_manual_pass>=8 AND v_critical=0),
    'systemChecks', v_checks, 'roleAcceptances', v_manual, 'feedback', v_feedback,
    'requiredRoles', jsonb_build_array('Client','Sales','Administrator','Caseworker','Solicitor','Finance','Manager','Director')
  );
END
$function$;

ALTER TABLE public.pilot_acceptance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_acceptance_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY pilot_acceptance_read ON public.pilot_acceptance_evidence FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'command_centre.read'));
CREATE POLICY pilot_feedback_read ON public.pilot_feedback FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'command_centre.read'));

REVOKE ALL ON TABLE public.pilot_acceptance_evidence, public.pilot_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pilot_acceptance_evidence, public.pilot_feedback TO businessos_app;
REVOKE ALL ON FUNCTION private.upsert_pilot_acceptance(text,text,text,public.pilot_acceptance_status,text,text,integer),
  private.create_pilot_feedback(text,public.pilot_feedback_severity,text,text,text),
  private.resolve_pilot_feedback(uuid,public.pilot_feedback_status,text,integer),
  private.get_local_pilot_readiness() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.upsert_pilot_acceptance(text,text,text,public.pilot_acceptance_status,text,text,integer),
  private.create_pilot_feedback(text,public.pilot_feedback_severity,text,text,text),
  private.resolve_pilot_feedback(uuid,public.pilot_feedback_status,text,integer),
  private.get_local_pilot_readiness() TO businessos_app;

COMMIT;
