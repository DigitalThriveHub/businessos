-- Gate G correction: enforce the operational journey instead of exposing only a queue.
BEGIN;

CREATE OR REPLACE FUNCTION private.get_matter_lifecycle_readiness(p_matter uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  org uuid := private.current_organisation_id();
  matter_record record;
  compliance_record record;
  engagement_record record;
  paid bigint := 0;
  open_tasks integer := 0;
  open_exceptions integer := 0;
  submission_approved boolean := false;
  completion_approved boolean := false;
BEGIN
  IF org IS NULL OR NOT private.has_organisation_permission(org, 'engagements.read') THEN
    RAISE EXCEPTION 'lifecycle read denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO matter_record FROM public.matters
  WHERE id = p_matter AND organisation_id = org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'matter unavailable' USING ERRCODE = 'no_data_found'; END IF;

  SELECT * INTO compliance_record FROM public.matter_compliance
  WHERE matter_id = p_matter AND organisation_id = org;
  SELECT * INTO engagement_record FROM public.service_engagements
  WHERE matter_id = p_matter AND organisation_id = org;
  paid := private.matter_cleared_payment(p_matter);
  SELECT count(*) INTO open_tasks FROM public.matter_tasks
  WHERE matter_id = p_matter AND organisation_id = org
    AND status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED');
  SELECT count(*) INTO open_exceptions FROM public.lifecycle_exceptions
  WHERE matter_id = p_matter AND organisation_id = org
    AND status IN ('OPEN', 'ASSIGNED');
  SELECT EXISTS (
    SELECT 1 FROM public.approval_requests
    WHERE organisation_id = org AND subject_type = 'MATTER' AND subject_id = p_matter
      AND action_key = 'matter.submit' AND status = 'APPROVED'
  ) INTO submission_approved;
  SELECT EXISTS (
    SELECT 1 FROM public.approval_requests
    WHERE organisation_id = org AND subject_type = 'MATTER' AND subject_id = p_matter
      AND action_key = 'matter.complete' AND status = 'APPROVED'
  ) INTO completion_approved;

  RETURN jsonb_build_object(
    'matterId', p_matter,
    'matterStatus', matter_record.status,
    'ownerAssigned', matter_record.assigned_to_user_id IS NOT NULL,
    'supervisorAssigned', matter_record.supervisor_user_id IS NOT NULL,
    'conflictCleared', compliance_record.conflict_status IN ('CLEARED', 'WAIVED'),
    'amlCleared', compliance_record.aml_status IN ('VERIFIED', 'NOT_REQUIRED'),
    'clientCareAccepted', compliance_record.client_care_status = 'ACCEPTED',
    'engagementAccepted', engagement_record.status IN ('ACCEPTED', 'PAYMENT_PENDING', 'ACTIVE', 'COMPLETED'),
    'paidMinor', paid::text,
    'initialPaymentMinor', COALESCE(engagement_record.initial_payment_minor, 0)::text,
    'submissionClearanceMinor', COALESCE(engagement_record.submission_clearance_minor, 0)::text,
    'completionClearanceMinor', COALESCE(engagement_record.professional_fee_minor, 0)::text,
    'legalWorkCleared', engagement_record.id IS NOT NULL AND
      (paid >= engagement_record.initial_payment_minor OR private.has_lifecycle_override(engagement_record.id, 'LEGAL_WORK')),
    'submissionPaymentCleared', engagement_record.id IS NOT NULL AND
      (paid >= engagement_record.submission_clearance_minor OR private.has_lifecycle_override(engagement_record.id, 'SUBMISSION')),
    'submissionApproved', submission_approved,
    'completionPaymentCleared', engagement_record.id IS NOT NULL AND
      (paid >= engagement_record.professional_fee_minor OR private.has_lifecycle_override(engagement_record.id, 'CLOSURE')),
    'completionApproved', completion_approved,
    'openTasks', open_tasks,
    'openExceptions', open_exceptions,
    'outcomeRecorded', NULLIF(btrim(COALESCE(matter_record.outcome, '')), '') IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_matter_payment_gates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  readiness jsonb;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('ACTIVE', 'SUBMITTED', 'CLOSED') THEN RETURN NEW; END IF;

  readiness := private.get_matter_lifecycle_readiness(NEW.id);
  IF NEW.status = 'ACTIVE' AND NOT (
    (readiness->>'ownerAssigned')::boolean AND
    (readiness->>'supervisorAssigned')::boolean AND
    (readiness->>'conflictCleared')::boolean AND
    (readiness->>'amlCleared')::boolean AND
    (readiness->>'clientCareAccepted')::boolean AND
    (readiness->>'engagementAccepted')::boolean AND
    (readiness->>'legalWorkCleared')::boolean
  ) THEN
    RAISE EXCEPTION 'matter is not cleared for legal work' USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = readiness::text;
  END IF;

  IF NEW.status = 'SUBMITTED' AND NOT (
    (readiness->>'submissionPaymentCleared')::boolean AND
    (readiness->>'submissionApproved')::boolean AND
    (readiness->>'openExceptions')::integer = 0
  ) THEN
    RAISE EXCEPTION 'matter is not cleared for submission' USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = readiness::text;
  END IF;

  IF NEW.status = 'CLOSED' AND NOT (
    (readiness->>'completionPaymentCleared')::boolean AND
    (readiness->>'completionApproved')::boolean AND
    NULLIF(btrim(COALESCE(NEW.outcome, '')), '') IS NOT NULL AND
    (readiness->>'openTasks')::integer = 0 AND
    (readiness->>'openExceptions')::integer = 0
  ) THEN
    RAISE EXCEPTION 'matter is not cleared for completion' USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = readiness::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.create_lifecycle_exception(
  p_matter uuid, p_category text, p_severity text, p_title text,
  p_detail text, p_owner uuid, p_due_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  org uuid := private.current_organisation_id();
  actor uuid := private.current_user_id();
  result uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT private.has_organisation_permission(org, 'engagements.manage')
    OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 lifecycle authority required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_severity NOT IN ('LOW','MEDIUM','HIGH','CRITICAL')
    OR char_length(btrim(p_category)) NOT BETWEEN 2 AND 80
    OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 240
    OR char_length(btrim(p_detail)) < 10 THEN
    RAISE EXCEPTION 'invalid lifecycle exception' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_matter IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.matters WHERE id = p_matter AND organisation_id = org AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'matter unavailable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_owner IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organisation_memberships
    WHERE organisation_id = org AND user_profile_id = p_owner AND status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'exception owner unavailable' USING ERRCODE = 'invalid_parameter_value'; END IF;

  INSERT INTO public.lifecycle_exceptions(
    id, organisation_id, matter_id, category, severity, status, title, detail,
    owner_user_id, due_at, created_by_user_id
  ) VALUES (
    result, org, p_matter, upper(btrim(p_category)), p_severity,
    CASE WHEN p_owner IS NULL THEN 'OPEN' ELSE 'ASSIGNED' END,
    btrim(p_title), btrim(p_detail), p_owner, p_due_at, actor
  );
  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), org, 'USER', actor, 'businessos-api',
    'lifecycle.exception.created', 'lifecycle_exception', result::text, 'SUCCESS',
    jsonb_build_object('matterId', p_matter, 'category', upper(btrim(p_category)), 'severity', p_severity)
  );
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.resolve_lifecycle_exception(
  p_exception uuid, p_resolution text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE org uuid := private.current_organisation_id(); actor uuid := private.current_user_id();
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT private.has_organisation_permission(org, 'engagements.manage')
    OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 lifecycle authority required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(btrim(p_resolution)) < 20 THEN
    RAISE EXCEPTION 'resolution evidence is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.lifecycle_exceptions SET status = 'RESOLVED', resolution = btrim(p_resolution),
    resolved_at = pg_catalog.now(), resolved_by_user_id = actor, updated_at = pg_catalog.now()
  WHERE id = p_exception AND organisation_id = org AND status IN ('OPEN','ASSIGNED');
  IF NOT FOUND THEN RAISE EXCEPTION 'exception unavailable' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), org, 'USER', actor, 'businessos-api',
    'lifecycle.exception.resolved', 'lifecycle_exception', p_exception::text,
    'SUCCESS', jsonb_build_object('resolution', btrim(p_resolution))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.get_service_lifecycle_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE org uuid := private.current_organisation_id();
BEGIN
  IF org IS NULL OR NOT private.has_organisation_permission(org, 'engagements.read') THEN
    RAISE EXCEPTION 'lifecycle read denied' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'paymentPending', (SELECT count(*) FROM public.service_engagements WHERE organisation_id = org AND status = 'PAYMENT_PENDING'),
      'activeEngagements', (SELECT count(*) FROM public.service_engagements WHERE organisation_id = org AND status = 'ACTIVE'),
      'overdueInstalments', (SELECT count(*) FROM public.engagement_instalments i
        JOIN public.service_engagements e ON e.id = i.engagement_id
        WHERE i.organisation_id = org AND i.due_at < pg_catalog.now()
          AND private.matter_cleared_payment(e.matter_id) < (
            SELECT COALESCE(sum(i2.amount_minor), 0) FROM public.engagement_instalments i2
            WHERE i2.engagement_id = e.id AND i2.sequence <= i.sequence)),
      'submissionBlocked', (SELECT count(*) FROM public.service_engagements e
        JOIN public.matters m ON m.id = e.matter_id
        WHERE e.organisation_id = org AND m.status NOT IN ('SUBMITTED','DECISION_RECEIVED','CLOSED','ARCHIVED')
          AND NOT ((private.get_matter_lifecycle_readiness(e.matter_id)->>'submissionPaymentCleared')::boolean
            AND (private.get_matter_lifecycle_readiness(e.matter_id)->>'submissionApproved')::boolean
            AND (private.get_matter_lifecycle_readiness(e.matter_id)->>'openExceptions')::integer = 0)),
      'openExceptions', (SELECT count(*) FROM public.lifecycle_exceptions WHERE organisation_id = org AND status IN ('OPEN','ASSIGNED')),
      'professionalFeesMinor', (SELECT COALESCE(sum(professional_fee_minor),0)::text FROM public.service_engagements WHERE organisation_id = org AND status NOT IN ('DRAFT','CANCELLED')),
      'cashCollectedMinor', (SELECT COALESCE(sum(private.matter_cleared_payment(matter_id)),0)::text FROM public.service_engagements WHERE organisation_id = org),
      'governmentFeesMinor', (SELECT COALESCE(sum(government_fee_minor),0)::text FROM public.service_engagements WHERE organisation_id = org AND status NOT IN ('DRAFT','CANCELLED')),
      'outstandingProfessionalFeesMinor', (SELECT COALESCE(sum(GREATEST(professional_fee_minor - private.matter_cleared_payment(matter_id),0)),0)::text FROM public.service_engagements WHERE organisation_id = org AND status NOT IN ('DRAFT','CANCELLED'))
    ),
    'workQueue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'engagementId', e.id, 'matterId', e.matter_id, 'matterNumber', m.matter_number,
        'title', m.title, 'status', e.status, 'matterStatus', m.status,
        'paidMinor', private.matter_cleared_payment(e.matter_id)::text,
        'requiredBeforeWorkMinor', e.initial_payment_minor::text,
        'requiredBeforeSubmissionMinor', e.submission_clearance_minor::text,
        'professionalFeeMinor', e.professional_fee_minor::text,
        'nextInstalmentAt', (SELECT min(i.due_at) FROM public.engagement_instalments i WHERE i.engagement_id = e.id),
        'readiness', private.get_matter_lifecycle_readiness(e.matter_id)
      ) ORDER BY m.priority DESC, e.created_at)
      FROM public.service_engagements e JOIN public.matters m ON m.id = e.matter_id
      WHERE e.organisation_id = org AND e.status NOT IN ('COMPLETED','CANCELLED')
    ), '[]'::jsonb),
    'exceptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'matterId', x.matter_id, 'category', x.category,
        'severity', x.severity, 'status', x.status, 'title', x.title,
        'ownerUserId', x.owner_user_id, 'dueAt', x.due_at, 'createdAt', x.created_at
      ) ORDER BY CASE x.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, x.due_at)
      FROM public.lifecycle_exceptions x
      WHERE x.organisation_id = org AND x.status IN ('OPEN','ASSIGNED')
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.get_matter_lifecycle_readiness(uuid),
  private.create_lifecycle_exception(uuid,text,text,text,text,uuid,timestamptz),
  private.resolve_lifecycle_exception(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_matter_lifecycle_readiness(uuid),
  private.create_lifecycle_exception(uuid,text,text,text,text,uuid,timestamptz),
  private.resolve_lifecycle_exception(uuid,text) TO businessos_app;

COMMIT;
