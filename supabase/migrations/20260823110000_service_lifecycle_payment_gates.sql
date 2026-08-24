-- Gate G: end-to-end engagement, instalment, payment-gate and exception control.
BEGIN;

CREATE TYPE public.engagement_status AS ENUM ('DRAFT','SENT','ACCEPTED','PAYMENT_PENDING','ACTIVE','ON_HOLD','COMPLETED','CANCELLED');
CREATE TYPE public.lifecycle_gate AS ENUM ('LEGAL_WORK','SUBMISSION','CLOSURE');
CREATE TYPE public.lifecycle_exception_status AS ENUM ('OPEN','ASSIGNED','RESOLVED','CANCELLED');

CREATE TABLE public.service_engagements (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  matter_id uuid NOT NULL,
  client_id uuid NOT NULL,
  status public.engagement_status NOT NULL DEFAULT 'DRAFT',
  currency_code char(3) NOT NULL DEFAULT 'GBP',
  professional_fee_minor bigint NOT NULL CHECK (professional_fee_minor >= 0),
  government_fee_minor bigint NOT NULL DEFAULT 0 CHECK (government_fee_minor >= 0),
  initial_payment_minor bigint NOT NULL CHECK (initial_payment_minor >= 0),
  submission_clearance_minor bigint NOT NULL CHECK (submission_clearance_minor >= 0),
  engagement_terms_version varchar(80) NOT NULL,
  accepted_at timestamptz(6), accepted_by_client_user_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  updated_by_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fk_service_engagement_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters(id, organisation_id),
  CONSTRAINT fk_service_engagement_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients(id, organisation_id),
  CONSTRAINT uq_service_engagement_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_service_engagement_matter UNIQUE (matter_id, organisation_id),
  CONSTRAINT ck_service_engagement_thresholds CHECK (
    initial_payment_minor <= professional_fee_minor
    AND submission_clearance_minor BETWEEN initial_payment_minor AND professional_fee_minor
  )
);

CREATE TABLE public.engagement_instalments (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  engagement_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  due_at timestamptz(6) NOT NULL,
  description varchar(240) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fk_engagement_instalment FOREIGN KEY (engagement_id, organisation_id)
    REFERENCES public.service_engagements(id, organisation_id),
  CONSTRAINT uq_engagement_instalment_sequence UNIQUE (engagement_id, sequence)
);

CREATE TABLE public.lifecycle_gate_overrides (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  engagement_id uuid NOT NULL,
  gate public.lifecycle_gate NOT NULL,
  reason varchar(1000) NOT NULL CHECK (char_length(btrim(reason)) >= 20),
  approved_by_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fk_lifecycle_override_engagement FOREIGN KEY (engagement_id, organisation_id)
    REFERENCES public.service_engagements(id, organisation_id)
);

CREATE TABLE public.lifecycle_exceptions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  matter_id uuid,
  category varchar(80) NOT NULL,
  severity varchar(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status public.lifecycle_exception_status NOT NULL DEFAULT 'OPEN',
  title varchar(240) NOT NULL,
  detail text NOT NULL,
  owner_user_id uuid REFERENCES public.user_profiles(id),
  due_at timestamptz(6), resolution text,
  resolved_at timestamptz(6), resolved_by_user_id uuid REFERENCES public.user_profiles(id),
  created_by_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fk_lifecycle_exception_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters(id, organisation_id)
);

CREATE INDEX ix_engagements_org_status ON public.service_engagements(organisation_id,status);
CREATE INDEX ix_instalments_org_due ON public.engagement_instalments(organisation_id,due_at);
CREATE INDEX ix_overrides_engagement_gate ON public.lifecycle_gate_overrides(engagement_id,gate,expires_at);
CREATE INDEX ix_exceptions_org_status_due ON public.lifecycle_exceptions(organisation_id,status,due_at);

CREATE OR REPLACE FUNCTION private.matter_cleared_payment(p_matter uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
  SELECT COALESCE(SUM(document.allocated_minor),0)::bigint
  FROM public.finance_documents document
  WHERE document.matter_id=p_matter AND document.document_type='INVOICE'
    AND document.status NOT IN ('DRAFT','VOID')
$f$;

CREATE OR REPLACE FUNCTION private.has_lifecycle_override(p_engagement uuid,p_gate public.lifecycle_gate)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
  SELECT EXISTS(SELECT 1 FROM public.lifecycle_gate_overrides override_record
    WHERE override_record.engagement_id=p_engagement AND override_record.gate=p_gate
      AND override_record.revoked_at IS NULL AND override_record.expires_at>pg_catalog.now())
$f$;

CREATE OR REPLACE FUNCTION private.enforce_matter_payment_gates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE engagement record; paid bigint;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO engagement FROM public.service_engagements e
    WHERE e.matter_id=NEW.id AND e.organisation_id=NEW.organisation_id;
  IF NOT FOUND AND NEW.status IN ('ACTIVE','SUBMITTED') THEN
    RAISE EXCEPTION 'an accepted service engagement is required' USING ERRCODE='object_not_in_prerequisite_state';
  END IF;
  IF NOT FOUND THEN RETURN NEW; END IF;
  paid := private.matter_cleared_payment(NEW.id);
  IF NEW.status='ACTIVE' AND (engagement.status NOT IN ('ACCEPTED','PAYMENT_PENDING','ACTIVE')
      OR paid<engagement.initial_payment_minor)
      AND NOT private.has_lifecycle_override(engagement.id,'LEGAL_WORK') THEN
    RAISE EXCEPTION 'initial payment clearance is required before legal work' USING ERRCODE='object_not_in_prerequisite_state';
  END IF;
  IF NEW.status='SUBMITTED' AND paid<engagement.submission_clearance_minor
      AND NOT private.has_lifecycle_override(engagement.id,'SUBMISSION') THEN
    RAISE EXCEPTION 'payment clearance is required before submission' USING ERRCODE='object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END $f$;

CREATE TRIGGER matters_payment_gate BEFORE UPDATE OF status ON public.matters
FOR EACH ROW EXECUTE FUNCTION private.enforce_matter_payment_gates();

CREATE OR REPLACE FUNCTION private.create_service_engagement(
 p_matter uuid,p_professional bigint,p_government bigint,p_initial bigint,
 p_submission bigint,p_terms text,p_instalments jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE org uuid:=private.current_organisation_id(); actor uuid:=private.current_user_id();
 engagement_id uuid:=pg_catalog.gen_random_uuid(); client_id uuid; item jsonb; total bigint:=0;
BEGIN
 IF actor IS NULL OR org IS NULL OR NOT private.has_organisation_permission(org,'engagements.manage')
    OR private.current_aal()<>'AAL2' THEN RAISE EXCEPTION 'AAL2 engagement authority required' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT party.client_id INTO client_id FROM public.matter_parties party
  WHERE party.matter_id=p_matter AND party.organisation_id=org
    AND (party.role='PRIMARY_CLIENT' OR party.is_primary) AND party.deleted_at IS NULL LIMIT 1;
 IF client_id IS NULL THEN RAISE EXCEPTION 'primary client is required' USING ERRCODE='no_data_found'; END IF;
 IF p_professional<0 OR p_government<0 OR p_initial<0 OR p_submission<p_initial OR p_submission>p_professional
    OR char_length(btrim(p_terms)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid engagement terms' USING ERRCODE='invalid_parameter_value'; END IF;
 INSERT INTO public.service_engagements(id,organisation_id,matter_id,client_id,professional_fee_minor,government_fee_minor,
  initial_payment_minor,submission_clearance_minor,engagement_terms_version,created_by_user_id,updated_by_user_id)
 VALUES(engagement_id,org,p_matter,client_id,p_professional,p_government,p_initial,p_submission,btrim(p_terms),actor,actor);
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_instalments,'[]'::jsonb)) LOOP
  INSERT INTO public.engagement_instalments(organisation_id,engagement_id,sequence,amount_minor,due_at,description)
  VALUES(org,engagement_id,(item->>'sequence')::integer,(item->>'amountMinor')::bigint,(item->>'dueAt')::timestamptz,btrim(item->>'description'));
  total:=total+(item->>'amountMinor')::bigint;
 END LOOP;
 IF jsonb_array_length(COALESCE(p_instalments,'[]'::jsonb))>0 AND total<>p_professional THEN
  RAISE EXCEPTION 'instalments must equal professional fee' USING ERRCODE='check_violation'; END IF;
 INSERT INTO public.audit_events(id,organisation_id,actor_type,actor_user_profile_id,source,action,resource_type,resource_id,outcome,metadata)
 VALUES(pg_catalog.gen_random_uuid(),org,'USER',actor,'businessos-api','engagement.created','service_engagement',engagement_id::text,'SUCCESS',
  jsonb_build_object('matterId',p_matter,'professionalFeeMinor',p_professional,'governmentFeeMinor',p_government));
 RETURN engagement_id;
END $f$;

CREATE OR REPLACE FUNCTION private.accept_service_engagement(p_engagement uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE org uuid:=private.current_organisation_id(); actor uuid:=private.current_user_id();
BEGIN
 IF actor IS NULL OR org IS NULL OR NOT private.has_organisation_permission(org,'engagements.manage') THEN
  RAISE EXCEPTION 'engagement authority required' USING ERRCODE='insufficient_privilege'; END IF;
 UPDATE public.service_engagements SET status='PAYMENT_PENDING',accepted_at=pg_catalog.now(),updated_by_user_id=actor,
  version=version+1,updated_at=pg_catalog.now() WHERE id=p_engagement AND organisation_id=org AND status IN ('DRAFT','SENT');
 IF NOT FOUND THEN RAISE EXCEPTION 'engagement unavailable' USING ERRCODE='serialization_failure'; END IF;
END $f$;

CREATE OR REPLACE FUNCTION private.approve_lifecycle_override(p_engagement uuid,p_gate public.lifecycle_gate,p_reason text,p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE org uuid:=private.current_organisation_id(); actor uuid:=private.current_user_id(); result uuid:=pg_catalog.gen_random_uuid();
BEGIN
 IF actor IS NULL OR org IS NULL OR NOT private.has_organisation_permission(org,'engagements.override') OR private.current_aal()<>'AAL2'
  THEN RAISE EXCEPTION 'AAL2 override authority required' USING ERRCODE='insufficient_privilege'; END IF;
 IF char_length(btrim(p_reason))<20 OR p_expires<=pg_catalog.now() OR p_expires>pg_catalog.now()+interval '30 days'
  THEN RAISE EXCEPTION 'invalid override evidence' USING ERRCODE='invalid_parameter_value'; END IF;
 INSERT INTO public.lifecycle_gate_overrides(id,organisation_id,engagement_id,gate,reason,approved_by_user_id,expires_at)
 SELECT result,org,id,p_gate,btrim(p_reason),actor,p_expires FROM public.service_engagements WHERE id=p_engagement AND organisation_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION 'engagement unavailable' USING ERRCODE='no_data_found'; END IF;
 INSERT INTO public.audit_events(id,organisation_id,actor_type,actor_user_profile_id,source,action,resource_type,resource_id,outcome,metadata)
 VALUES(pg_catalog.gen_random_uuid(),org,'USER',actor,'businessos-api','engagement.payment_gate.overridden','lifecycle_gate_override',result::text,'SUCCESS',
  jsonb_build_object('engagementId',p_engagement,'gate',p_gate,'expiresAt',p_expires));
 RETURN result;
END $f$;

CREATE OR REPLACE FUNCTION private.get_service_lifecycle_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE org uuid:=private.current_organisation_id();
BEGIN
 IF org IS NULL OR NOT private.has_organisation_permission(org,'engagements.read') THEN RAISE EXCEPTION 'lifecycle read denied' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN jsonb_build_object(
  'summary',jsonb_build_object(
   'paymentPending',(SELECT count(*) FROM public.service_engagements e WHERE e.organisation_id=org AND e.status='PAYMENT_PENDING'),
   'activeEngagements',(SELECT count(*) FROM public.service_engagements e WHERE e.organisation_id=org AND e.status='ACTIVE'),
   'overdueInstalments',(SELECT count(*) FROM public.engagement_instalments i JOIN public.service_engagements e ON e.id=i.engagement_id WHERE i.organisation_id=org AND i.due_at<pg_catalog.now() AND private.matter_cleared_payment(e.matter_id)<(SELECT COALESCE(sum(i2.amount_minor),0) FROM public.engagement_instalments i2 WHERE i2.engagement_id=e.id AND i2.sequence<=i.sequence)),
   'submissionBlocked',(SELECT count(*) FROM public.service_engagements e JOIN public.matters m ON m.id=e.matter_id WHERE e.organisation_id=org AND m.status<>'SUBMITTED' AND private.matter_cleared_payment(e.matter_id)<e.submission_clearance_minor),
   'openExceptions',(SELECT count(*) FROM public.lifecycle_exceptions x WHERE x.organisation_id=org AND x.status IN ('OPEN','ASSIGNED')),
   'professionalFeesMinor',(SELECT COALESCE(sum(e.professional_fee_minor),0)::text FROM public.service_engagements e WHERE e.organisation_id=org AND e.status NOT IN ('DRAFT','CANCELLED')),
   'cashCollectedMinor',(SELECT COALESCE(sum(private.matter_cleared_payment(e.matter_id)),0)::text FROM public.service_engagements e WHERE e.organisation_id=org),
   'governmentFeesMinor',(SELECT COALESCE(sum(e.government_fee_minor),0)::text FROM public.service_engagements e WHERE e.organisation_id=org AND e.status NOT IN ('DRAFT','CANCELLED'))
  ),
  'workQueue',COALESCE((SELECT jsonb_agg(jsonb_build_object('engagementId',e.id,'matterId',e.matter_id,'matterNumber',m.matter_number,'title',m.title,'status',e.status,'paidMinor',private.matter_cleared_payment(e.matter_id)::text,'requiredBeforeWorkMinor',e.initial_payment_minor::text,'requiredBeforeSubmissionMinor',e.submission_clearance_minor::text,'professionalFeeMinor',e.professional_fee_minor::text,'nextInstalmentAt',(SELECT min(i.due_at) FROM public.engagement_instalments i WHERE i.engagement_id=e.id)) ORDER BY m.priority DESC,e.created_at)
   FROM public.service_engagements e JOIN public.matters m ON m.id=e.matter_id WHERE e.organisation_id=org AND e.status NOT IN ('COMPLETED','CANCELLED')),'[]'::jsonb)
 );
END $f$;

INSERT INTO public.permissions(id,key,name,description,resource,action,data_scope,is_sensitive,requires_mfa,allows_ai_use,is_active,metadata,created_at,updated_at) VALUES
 (pg_catalog.gen_random_uuid(),'engagements.read','Read service lifecycle','View engagements, gates, instalments and exceptions','service_engagement','read','ORGANISATION',false,false,false,true,jsonb_build_object('control_family','gate-g-lifecycle'),pg_catalog.now(),pg_catalog.now()),
 (pg_catalog.gen_random_uuid(),'engagements.manage','Manage service lifecycle','Create and accept engagements and instalments','service_engagement','manage','ORGANISATION',true,true,false,true,jsonb_build_object('control_family','gate-g-lifecycle'),pg_catalog.now(),pg_catalog.now()),
 (pg_catalog.gen_random_uuid(),'engagements.override','Override payment gates','Authorise time-limited evidenced payment-gate exceptions','service_engagement','override','ORGANISATION',true,true,false,true,jsonb_build_object('control_family','gate-g-lifecycle'),pg_catalog.now(),pg_catalog.now())
ON CONFLICT(key) DO NOTHING;

INSERT INTO public.role_permissions(id,role_id,permission_id,created_at)
SELECT pg_catalog.gen_random_uuid(),r.id,p.id,pg_catalog.now() FROM public.roles r JOIN public.permissions p ON p.key IN ('engagements.read','engagements.manage','engagements.override')
WHERE r.key IN ('organisation_owner','system_administrator') AND r.organisation_id IS NOT NULL ON CONFLICT(role_id,permission_id) DO NOTHING;
INSERT INTO public.role_permissions(id,role_id,permission_id,created_at)
SELECT pg_catalog.gen_random_uuid(),r.id,p.id,pg_catalog.now() FROM public.roles r JOIN public.permissions p ON p.key IN ('engagements.read','engagements.manage')
WHERE r.key IN ('sales_manager','finance','solicitor','compliance_manager','case_manager') AND r.organisation_id IS NOT NULL ON CONFLICT(role_id,permission_id) DO NOTHING;
INSERT INTO public.role_permissions(id,role_id,permission_id,created_at)
SELECT pg_catalog.gen_random_uuid(),r.id,p.id,pg_catalog.now() FROM public.roles r JOIN public.permissions p ON p.key='engagements.read'
WHERE r.key IN ('sales_agent','case_worker') AND r.organisation_id IS NOT NULL ON CONFLICT(role_id,permission_id) DO NOTHING;

REVOKE ALL ON public.service_engagements,public.engagement_instalments,public.lifecycle_gate_overrides,public.lifecycle_exceptions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.service_engagements,public.engagement_instalments,public.lifecycle_gate_overrides,public.lifecycle_exceptions TO businessos_app;
ALTER TABLE public.service_engagements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.service_engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_instalments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.engagement_instalments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_gate_overrides ENABLE ROW LEVEL SECURITY; ALTER TABLE public.lifecycle_gate_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_exceptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.lifecycle_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY engagement_read ON public.service_engagements FOR SELECT TO businessos_app USING(private.has_organisation_permission(organisation_id,'engagements.read'));
CREATE POLICY instalment_read ON public.engagement_instalments FOR SELECT TO businessos_app USING(private.has_organisation_permission(organisation_id,'engagements.read'));
CREATE POLICY override_read ON public.lifecycle_gate_overrides FOR SELECT TO businessos_app USING(private.has_organisation_permission(organisation_id,'engagements.read'));
CREATE POLICY exception_read ON public.lifecycle_exceptions FOR SELECT TO businessos_app USING(private.has_organisation_permission(organisation_id,'engagements.read'));

REVOKE ALL ON FUNCTION private.create_service_engagement(uuid,bigint,bigint,bigint,bigint,text,jsonb),private.accept_service_engagement(uuid),private.approve_lifecycle_override(uuid,public.lifecycle_gate,text,timestamptz),private.get_service_lifecycle_dashboard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.create_service_engagement(uuid,bigint,bigint,bigint,bigint,text,jsonb),private.accept_service_engagement(uuid),private.approve_lifecycle_override(uuid,public.lifecycle_gate,text,timestamptz),private.get_service_lifecycle_dashboard() TO businessos_app;

COMMIT;
