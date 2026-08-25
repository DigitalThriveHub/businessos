-- Gate M: document intelligence, human review, My Work, management Control
-- Tower and evidence-backed operational value measurement.
--
-- Provider output is advisory. Only an authorised AAL2 human review can change
-- document classification, expiry or request-checklist state.

BEGIN;

CREATE TYPE public.document_intelligence_status AS ENUM (
  'PENDING', 'PROCESSING', 'READY', 'REVIEWED', 'REJECTED', 'ERROR'
);
CREATE TYPE public.document_intelligence_job_status AS ENUM (
  'QUEUED', 'LEASED', 'SUCCEEDED', 'CANCELLED', 'FAILED', 'DEAD_LETTER'
);
CREATE TYPE public.document_intelligence_review_decision AS ENUM (
  'ACCEPTED', 'CORRECTED', 'REJECTED'
);
CREATE TYPE public.document_review_priority AS ENUM (
  'ROUTINE', 'ATTENTION', 'URGENT'
);
CREATE TYPE public.operational_value_category AS ENUM (
  'AUTOMATION', 'AI_ASSISTANCE', 'DOCUMENT_PROCESSING', 'COMMUNICATION',
  'WORKFLOW', 'OPPORTUNITY_RECOVERY', 'OTHER'
);

CREATE TABLE public.document_intelligence_analyses (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_id uuid NOT NULL,
  status public.document_intelligence_status NOT NULL DEFAULT 'PENDING',
  provider varchar(120),
  model varchar(120),
  provider_response_id varchar(240),
  provider_request_id varchar(240),
  detected_category public.document_category,
  category_confidence_bps integer,
  extracted_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_names varchar(240)[] NOT NULL DEFAULT ARRAY[]::varchar(240)[],
  extracted_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  expiry_date date,
  missing_pages integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  missing_information varchar(500)[] NOT NULL DEFAULT ARRAY[]::varchar(500)[],
  inconsistencies varchar(500)[] NOT NULL DEFAULT ARRAY[]::varchar(500)[],
  summary varchar(4000),
  review_priority public.document_review_priority NOT NULL DEFAULT 'ROUTINE',
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_minor bigint,
  started_at timestamptz(6),
  completed_at timestamptz(6),
  failed_at timestamptz(6),
  error_code varchar(120),
  error_detail varchar(1000),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_document_intelligence_analyses PRIMARY KEY (id),
  CONSTRAINT uq_document_intelligence_analyses_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_document_intelligence_analysis_version UNIQUE (version_id),
  CONSTRAINT fk_document_intelligence_analyses_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_analyses_matter FOREIGN KEY (
    matter_id, organisation_id
  ) REFERENCES public.matters(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_analyses_document FOREIGN KEY (
    document_id, organisation_id
  ) REFERENCES public.matter_documents(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_analyses_version FOREIGN KEY (
    version_id, organisation_id
  ) REFERENCES public.matter_document_versions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_document_intelligence_confidence CHECK (
    category_confidence_bps IS NULL OR category_confidence_bps BETWEEN 0 AND 10000
  ),
  CONSTRAINT ck_document_intelligence_json CHECK (
    pg_catalog.jsonb_typeof(extracted_fields) = 'object'
    AND pg_catalog.jsonb_typeof(extracted_dates) = 'array'
  ),
  CONSTRAINT ck_document_intelligence_arrays CHECK (
    cardinality(extracted_names) <= 100
    AND cardinality(missing_pages) <= 500
    AND cardinality(missing_information) <= 100
    AND cardinality(inconsistencies) <= 100
  ),
  CONSTRAINT ck_document_intelligence_tokens CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (total_tokens IS NULL OR total_tokens >= 0)
    AND (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0)
  ),
  CONSTRAINT ck_document_intelligence_version CHECK (version > 0),
  CONSTRAINT ck_document_intelligence_lifecycle CHECK (
    (status = 'PENDING' AND completed_at IS NULL AND failed_at IS NULL)
    OR (status = 'PROCESSING' AND started_at IS NOT NULL
      AND completed_at IS NULL AND failed_at IS NULL)
    OR (status IN ('READY', 'REVIEWED', 'REJECTED') AND completed_at IS NOT NULL
      AND failed_at IS NULL AND error_code IS NULL AND error_detail IS NULL)
    OR (status = 'ERROR' AND failed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX ix_document_intelligence_analyses_org_queue
  ON public.document_intelligence_analyses (
    organisation_id, status, review_priority, created_at DESC
  );
CREATE INDEX ix_document_intelligence_analyses_org_matter
  ON public.document_intelligence_analyses (
    organisation_id, matter_id, created_at DESC
  );

CREATE TABLE public.document_intelligence_reviews (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  document_id uuid NOT NULL,
  decision public.document_intelligence_review_decision NOT NULL,
  confirmed_category public.document_category NOT NULL,
  confirmed_expiry_date date,
  corrections jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes varchar(2000) NOT NULL,
  create_follow_up_task boolean NOT NULL DEFAULT false,
  reviewed_by_user_profile_id uuid NOT NULL,
  reviewed_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_document_intelligence_reviews PRIMARY KEY (id),
  CONSTRAINT uq_document_intelligence_reviews_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_document_intelligence_reviews_analysis UNIQUE (analysis_id),
  CONSTRAINT fk_document_intelligence_reviews_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_reviews_analysis FOREIGN KEY (
    analysis_id, organisation_id
  ) REFERENCES public.document_intelligence_analyses(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_reviews_document FOREIGN KEY (
    document_id, organisation_id
  ) REFERENCES public.matter_documents(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_reviews_reviewer FOREIGN KEY (
    reviewed_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_document_intelligence_reviews_notes CHECK (
    char_length(pg_catalog.btrim(notes)) BETWEEN 3 AND 2000
  ),
  CONSTRAINT ck_document_intelligence_reviews_corrections CHECK (
    pg_catalog.jsonb_typeof(corrections) = 'object'
  )
);
CREATE INDEX ix_document_intelligence_reviews_org_reviewed
  ON public.document_intelligence_reviews (organisation_id, reviewed_at DESC);

CREATE TABLE public.document_intelligence_jobs (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  version_id uuid NOT NULL,
  status public.document_intelligence_job_status NOT NULL DEFAULT 'QUEUED',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  lease_owner varchar(160),
  lease_expires_at timestamptz(6),
  last_error_code varchar(120),
  last_error_detail varchar(1000),
  completed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_document_intelligence_jobs PRIMARY KEY (id),
  CONSTRAINT uq_document_intelligence_jobs_analysis UNIQUE (analysis_id),
  CONSTRAINT uq_document_intelligence_jobs_version UNIQUE (version_id),
  CONSTRAINT fk_document_intelligence_jobs_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_jobs_analysis FOREIGN KEY (
    analysis_id, organisation_id
  ) REFERENCES public.document_intelligence_analyses(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_intelligence_jobs_version FOREIGN KEY (
    version_id, organisation_id
  ) REFERENCES public.matter_document_versions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_document_intelligence_jobs_attempts CHECK (
    attempts >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempts <= max_attempts
  ),
  CONSTRAINT ck_document_intelligence_jobs_lease CHECK (
    (status = 'LEASED' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'LEASED' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT ck_document_intelligence_jobs_completion CHECK (
    (status IN ('SUCCEEDED', 'CANCELLED', 'FAILED', 'DEAD_LETTER')
      AND completed_at IS NOT NULL)
    OR (status IN ('QUEUED', 'LEASED') AND completed_at IS NULL)
  )
);
CREATE INDEX ix_document_intelligence_jobs_claim
  ON public.document_intelligence_jobs (status, next_attempt_at, created_at)
  WHERE status IN ('QUEUED', 'LEASED');
CREATE INDEX ix_document_intelligence_jobs_org_status
  ON public.document_intelligence_jobs (organisation_id, status, updated_at DESC);

CREATE TABLE public.organisation_value_benchmarks (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  event_key varchar(120) NOT NULL,
  label varchar(180) NOT NULL,
  category public.operational_value_category NOT NULL,
  estimated_manual_minutes integer NOT NULL,
  estimated_automated_minutes integer NOT NULL,
  hourly_cost_minor bigint NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_by_user_profile_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_organisation_value_benchmarks PRIMARY KEY (id),
  CONSTRAINT uq_organisation_value_benchmarks_org_key UNIQUE (
    organisation_id, event_key
  ),
  CONSTRAINT fk_organisation_value_benchmarks_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_organisation_value_benchmarks_updater FOREIGN KEY (
    updated_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_organisation_value_benchmarks_key CHECK (
    event_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_organisation_value_benchmarks_minutes CHECK (
    estimated_manual_minutes BETWEEN 0 AND 1440
    AND estimated_automated_minutes BETWEEN 0 AND 1440
    AND estimated_automated_minutes <= estimated_manual_minutes
  ),
  CONSTRAINT ck_organisation_value_benchmarks_cost CHECK (
    hourly_cost_minor BETWEEN 0 AND 10000000
  ),
  CONSTRAINT ck_organisation_value_benchmarks_version CHECK (version > 0)
);
CREATE INDEX ix_organisation_value_benchmarks_org_active
  ON public.organisation_value_benchmarks (organisation_id, is_active, category);

CREATE TABLE public.automation_value_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  event_key varchar(120) NOT NULL,
  category public.operational_value_category NOT NULL,
  source_type varchar(120) NOT NULL,
  source_id uuid NOT NULL,
  estimated_manual_minutes integer NOT NULL,
  estimated_automated_minutes integer NOT NULL,
  estimated_minutes_saved integer NOT NULL,
  hourly_cost_minor bigint NOT NULL,
  estimated_value_minor bigint NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_automation_value_events PRIMARY KEY (id),
  CONSTRAINT uq_automation_value_events_source UNIQUE (
    organisation_id, event_key, source_type, source_id
  ),
  CONSTRAINT fk_automation_value_events_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_automation_value_events_minutes CHECK (
    estimated_manual_minutes >= 0 AND estimated_automated_minutes >= 0
    AND estimated_minutes_saved = greatest(
      0, estimated_manual_minutes - estimated_automated_minutes
    )
  ),
  CONSTRAINT ck_automation_value_events_value CHECK (
    hourly_cost_minor >= 0 AND estimated_value_minor >= 0
  ),
  CONSTRAINT ck_automation_value_events_evidence CHECK (
    pg_catalog.jsonb_typeof(evidence) = 'object'
  )
);
CREATE INDEX ix_automation_value_events_org_occurred
  ON public.automation_value_events (organisation_id, occurred_at DESC);
CREATE INDEX ix_automation_value_events_org_category
  ON public.automation_value_events (organisation_id, category, occurred_at DESC);

CREATE TABLE public.operational_metric_snapshots (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metrics jsonb NOT NULL,
  generated_by varchar(120) NOT NULL,
  generated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_operational_metric_snapshots PRIMARY KEY (id),
  CONSTRAINT uq_operational_metric_snapshots_org_period UNIQUE (
    organisation_id, period_start, period_end
  ),
  CONSTRAINT fk_operational_metric_snapshots_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_operational_metric_snapshots_period CHECK (period_end >= period_start),
  CONSTRAINT ck_operational_metric_snapshots_metrics CHECK (
    pg_catalog.jsonb_typeof(metrics) = 'object'
  )
);
CREATE INDEX ix_operational_metric_snapshots_org_period
  ON public.operational_metric_snapshots (organisation_id, period_end DESC);

ALTER TABLE public.matter_documents
  ADD COLUMN last_intelligence_analysis_id uuid,
  ADD COLUMN expires_at timestamptz(6),
  ADD CONSTRAINT fk_matter_documents_last_intelligence FOREIGN KEY (
    last_intelligence_analysis_id, organisation_id
  ) REFERENCES public.document_intelligence_analyses(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX ix_matter_documents_org_expiry
  ON public.matter_documents (organisation_id, expires_at)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

WITH permission_seed(
  permission_key, permission_name, permission_description,
  resource_name, action_name, data_scope, is_sensitive, requires_mfa
) AS (
  VALUES
    ('my_work.read', 'View personal work queue',
      'View the signed-in employee''s authorised tasks, deadlines and approvals.',
      'my_work', 'read', 'OWN'::public.permission_data_scope, true, false),
    ('document_intelligence.read', 'View document intelligence',
      'View advisory extraction results for documents the employee can access.',
      'document_intelligence', 'read', 'OWN'::public.permission_data_scope, true, false),
    ('document_intelligence.review', 'Review document intelligence',
      'Confirm, correct or reject advisory document extraction with AAL2 evidence.',
      'document_intelligence', 'review', 'OWN'::public.permission_data_scope, true, true),
    ('control_tower.read', 'View management Control Tower',
      'View organisation workload, throughput, risk and operational aggregates.',
      'control_tower', 'read', 'ORGANISATION'::public.permission_data_scope, true, false),
    ('operational_value.read', 'View operational value evidence',
      'View benchmark-backed administrative time and value estimates.',
      'operational_value', 'read', 'ORGANISATION'::public.permission_data_scope, false, false),
    ('operational_value.manage', 'Manage operational value benchmarks',
      'Change organisation benchmark assumptions used by value estimates.',
      'operational_value', 'manage', 'ORGANISATION'::public.permission_data_scope, true, true)
)
INSERT INTO public.permissions (
  id, key, name, description, resource, action, data_scope,
  is_sensitive, requires_mfa, allows_ai_use, is_active,
  metadata, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), permission_key, permission_name,
  permission_description, resource_name, action_name, data_scope,
  is_sensitive, requires_mfa, false, true,
  pg_catalog.jsonb_build_object(
    'classification', CASE WHEN is_sensitive THEN 'operational-confidential' ELSE 'aggregate' END,
    'contains_pii', is_sensitive,
    'ai_default', 'deny',
    'control_family', 'gate-m-operational-intelligence'
  ),
  pg_catalog.now(), pg_catalog.now()
FROM permission_seed
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN ('organisation_owner', 'system_administrator')
  AND role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.key IN (
    'my_work.read', 'document_intelligence.read', 'document_intelligence.review',
    'control_tower.read', 'operational_value.read', 'operational_value.manage'
  )
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('compliance_manager', 'my_work.read'),
    ('compliance_manager', 'document_intelligence.read'),
    ('compliance_manager', 'document_intelligence.review'),
    ('compliance_manager', 'control_tower.read'),
    ('compliance_manager', 'operational_value.read'),
    ('solicitor', 'my_work.read'),
    ('solicitor', 'document_intelligence.read'),
    ('solicitor', 'document_intelligence.review'),
    ('solicitor', 'control_tower.read'),
    ('solicitor', 'operational_value.read'),
    ('sales_manager', 'my_work.read'),
    ('sales_manager', 'control_tower.read'),
    ('sales_manager', 'operational_value.read'),
    ('sales_agent', 'my_work.read'),
    ('finance', 'my_work.read'),
    ('finance', 'control_tower.read'),
    ('finance', 'operational_value.read'),
    ('finance', 'operational_value.manage'),
    ('read_only', 'my_work.read'),
    ('read_only', 'document_intelligence.read'),
    ('case_manager', 'my_work.read'),
    ('case_manager', 'document_intelligence.read'),
    ('case_manager', 'document_intelligence.review'),
    ('case_manager', 'control_tower.read'),
    ('case_manager', 'operational_value.read'),
    ('case_manager', 'operational_value.manage'),
    ('case_worker', 'my_work.read'),
    ('case_worker', 'document_intelligence.read'),
    ('case_worker', 'document_intelligence.review')
)
INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM role_permission_seed
JOIN public.roles AS role_record
  ON role_record.key = role_permission_seed.role_key
 AND role_record.scope = 'ORGANISATION'
 AND role_record.organisation_id IS NOT NULL
 AND role_record.deleted_at IS NULL
JOIN public.permissions AS permission_record
  ON permission_record.key = role_permission_seed.permission_key
 AND permission_record.is_active = true
 AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.seed_gate_m_benchmarks(p_organisation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_organisation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organisations AS organisation
    WHERE organisation.id = p_organisation_id
  ) THEN
    RAISE EXCEPTION 'A valid organisation is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organisation_value_benchmarks (
    organisation_id, event_key, label, category,
    estimated_manual_minutes, estimated_automated_minutes,
    hourly_cost_minor, updated_by_user_profile_id
  )
  VALUES
    (p_organisation_id, 'document.intelligence.completed',
      'Document extraction and initial checks', 'DOCUMENT_PROCESSING',
      20, 3, 3000, NULL),
    (p_organisation_id, 'document.review.completed',
      'Document classification and checklist review', 'AI_ASSISTANCE',
      10, 5, 3000, NULL),
    (p_organisation_id, 'communication.matching.completed',
      'Communication matching and filing', 'COMMUNICATION',
      8, 1, 3000, NULL),
    (p_organisation_id, 'workflow.routing.completed',
      'Work routing and task creation', 'WORKFLOW',
      5, 1, 3000, NULL),
    (p_organisation_id, 'opportunity.recovery.completed',
      'Dormant opportunity review and recovery', 'OPPORTUNITY_RECOVERY',
      30, 10, 3000, NULL)
  ON CONFLICT (organisation_id, event_key) DO NOTHING;
END;
$function$;

ALTER FUNCTION private.seed_gate_m_benchmarks(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.seed_gate_m_benchmarks(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.seed_gate_m_benchmarks_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.seed_gate_m_benchmarks(NEW.id);
  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.seed_gate_m_benchmarks_trigger() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.seed_gate_m_benchmarks_trigger()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE TRIGGER organisations_seed_gate_m_benchmarks
  AFTER INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION private.seed_gate_m_benchmarks_trigger();

SELECT private.seed_gate_m_benchmarks(organisation.id)
FROM public.organisations AS organisation
WHERE organisation.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION private.record_automation_value_event(
  p_organisation_id uuid,
  p_event_key text,
  p_source_type text,
  p_source_id uuid,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_occurred_at timestamptz DEFAULT pg_catalog.now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_benchmark public.organisation_value_benchmarks%ROWTYPE;
  v_event_id uuid;
  v_saved_minutes integer;
BEGIN
  IF p_organisation_id IS NULL OR p_event_key IS NULL
    OR p_source_type IS NULL OR p_source_id IS NULL
    OR char_length(pg_catalog.btrim(p_source_type)) NOT BETWEEN 2 AND 120
    OR p_evidence IS NULL OR pg_catalog.jsonb_typeof(p_evidence) <> 'object'
    OR p_occurred_at IS NULL OR p_occurred_at > pg_catalog.now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Operational value evidence is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_benchmark
  FROM public.organisation_value_benchmarks AS benchmark
  WHERE benchmark.organisation_id = p_organisation_id
    AND benchmark.event_key = pg_catalog.btrim(p_event_key)
    AND benchmark.is_active = true;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_saved_minutes := greatest(
    0,
    v_benchmark.estimated_manual_minutes
      - v_benchmark.estimated_automated_minutes
  );

  INSERT INTO public.automation_value_events (
    organisation_id, event_key, category, source_type, source_id,
    estimated_manual_minutes, estimated_automated_minutes,
    estimated_minutes_saved, hourly_cost_minor, estimated_value_minor,
    evidence, occurred_at
  )
  VALUES (
    p_organisation_id, v_benchmark.event_key, v_benchmark.category,
    pg_catalog.btrim(p_source_type), p_source_id,
    v_benchmark.estimated_manual_minutes,
    v_benchmark.estimated_automated_minutes,
    v_saved_minutes, v_benchmark.hourly_cost_minor,
    (v_saved_minutes::bigint * v_benchmark.hourly_cost_minor + 30) / 60,
    p_evidence, p_occurred_at
  )
  ON CONFLICT (organisation_id, event_key, source_type, source_id) DO NOTHING
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;
ALTER FUNCTION private.record_automation_value_event(
  uuid, text, text, uuid, jsonb, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.record_automation_value_event(
  uuid, text, text, uuid, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.enqueue_document_intelligence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_analysis_id uuid;
BEGIN
  IF NEW.status <> 'AVAILABLE' OR NEW.scan_status <> 'CLEAN' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.document_intelligence_analyses (
    organisation_id, matter_id, document_id, version_id
  )
  VALUES (
    NEW.organisation_id, NEW.matter_id, NEW.document_id, NEW.id
  )
  ON CONFLICT (version_id) DO NOTHING
  RETURNING id INTO v_analysis_id;

  IF v_analysis_id IS NULL THEN
    SELECT analysis.id INTO v_analysis_id
    FROM public.document_intelligence_analyses AS analysis
    WHERE analysis.version_id = NEW.id;
  END IF;

  INSERT INTO public.document_intelligence_jobs (
    organisation_id, analysis_id, version_id
  )
  SELECT NEW.organisation_id, v_analysis_id, NEW.id
  FROM public.document_intelligence_analyses AS analysis
  WHERE analysis.id = v_analysis_id AND analysis.status = 'PENDING'
  ON CONFLICT (version_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.enqueue_document_intelligence() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enqueue_document_intelligence()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE TRIGGER matter_document_versions_enqueue_intelligence
  AFTER INSERT OR UPDATE OF status, scan_status
  ON public.matter_document_versions
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_document_intelligence();

INSERT INTO public.document_intelligence_analyses (
  organisation_id, matter_id, document_id, version_id
)
SELECT
  version_record.organisation_id, version_record.matter_id,
  version_record.document_id, version_record.id
FROM public.matter_document_versions AS version_record
WHERE version_record.status = 'AVAILABLE'
  AND version_record.scan_status = 'CLEAN'
ON CONFLICT (version_id) DO NOTHING;

INSERT INTO public.document_intelligence_jobs (
  organisation_id, analysis_id, version_id
)
SELECT analysis.organisation_id, analysis.id, analysis.version_id
FROM public.document_intelligence_analyses AS analysis
WHERE analysis.status = 'PENDING'
ON CONFLICT (version_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.reject_gate_m_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'Gate M evidence is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;
ALTER FUNCTION private.reject_gate_m_evidence_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_gate_m_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE TRIGGER document_intelligence_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.document_intelligence_reviews
  FOR EACH ROW EXECUTE FUNCTION private.reject_gate_m_evidence_mutation();
CREATE TRIGGER automation_value_events_immutable
  BEFORE UPDATE OR DELETE ON public.automation_value_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_gate_m_evidence_mutation();
CREATE TRIGGER operational_metric_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.operational_metric_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.reject_gate_m_evidence_mutation();

ALTER TABLE public.document_intelligence_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intelligence_analyses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_intelligence_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intelligence_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_intelligence_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_intelligence_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_value_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_value_benchmarks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_value_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_value_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.operational_metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_metric_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY document_intelligence_analyses_select
  ON public.document_intelligence_analyses FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(
      organisation_id, 'document_intelligence.read'
    )
    AND private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY document_intelligence_reviews_select
  ON public.document_intelligence_reviews FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(
      organisation_id, 'document_intelligence.read'
    )
    AND EXISTS (
      SELECT 1 FROM public.document_intelligence_analyses AS analysis
      WHERE analysis.id = document_intelligence_reviews.analysis_id
        AND analysis.organisation_id = document_intelligence_reviews.organisation_id
        AND private.can_read_matter(analysis.organisation_id, analysis.matter_id)
    )
  );
CREATE POLICY organisation_value_benchmarks_select
  ON public.organisation_value_benchmarks FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(
      organisation_id, 'operational_value.read'
    )
  );
CREATE POLICY automation_value_events_select
  ON public.automation_value_events FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(
      organisation_id, 'operational_value.read'
    )
  );
CREATE POLICY operational_metric_snapshots_select
  ON public.operational_metric_snapshots FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(
      organisation_id, 'control_tower.read'
    )
  );

REVOKE ALL ON TABLE public.document_intelligence_analyses,
  public.document_intelligence_reviews, public.document_intelligence_jobs,
  public.organisation_value_benchmarks, public.automation_value_events,
  public.operational_metric_snapshots
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader,
       businessos_runtime, businessos_app;
GRANT SELECT ON TABLE public.document_intelligence_analyses,
  public.document_intelligence_reviews, public.organisation_value_benchmarks,
  public.automation_value_events, public.operational_metric_snapshots
  TO businessos_app;

CREATE OR REPLACE FUNCTION private.claim_document_intelligence_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid,
  organisation_id uuid,
  analysis_id uuid,
  matter_id uuid,
  document_id uuid,
  version_id uuid,
  storage_bucket text,
  storage_path text,
  original_file_name text,
  content_type text,
  expected_size_bytes bigint,
  expected_sha256_hex text,
  document_title text,
  current_category text,
  attempt integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_worker_id IS NULL OR char_length(pg_catalog.btrim(p_worker_id)) NOT BETWEEN 3 AND 160
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'Document-intelligence lease request is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Superseded, quarantined or deleted versions must never reach a provider.
  UPDATE public.document_intelligence_jobs AS job
  SET status = 'CANCELLED',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = 'VERSION_NOT_CURRENT',
      last_error_detail = 'The document version is no longer the current clean version.',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE job.status IN ('QUEUED', 'LEASED')
    AND NOT EXISTS (
      SELECT 1
      FROM public.document_intelligence_analyses AS analysis
      JOIN public.matter_document_versions AS version_record
        ON version_record.id = analysis.version_id
       AND version_record.organisation_id = analysis.organisation_id
      JOIN public.matter_documents AS document_record
        ON document_record.id = analysis.document_id
       AND document_record.organisation_id = analysis.organisation_id
      WHERE analysis.id = job.analysis_id
        AND analysis.organisation_id = job.organisation_id
        AND analysis.status IN ('PENDING', 'PROCESSING')
        AND version_record.status = 'AVAILABLE'
        AND version_record.scan_status = 'CLEAN'
        AND document_record.current_version_id = version_record.id
        AND document_record.deleted_at IS NULL
    );

  UPDATE public.document_intelligence_analyses AS analysis
  SET status = 'ERROR',
      failed_at = pg_catalog.now(),
      error_code = 'VERSION_NOT_CURRENT',
      error_detail = 'The document version is no longer the current clean version.',
      version = analysis.version + 1,
      updated_at = pg_catalog.now()
  FROM public.document_intelligence_jobs AS job
  WHERE job.analysis_id = analysis.id
    AND job.status = 'CANCELLED'
    AND job.last_error_code = 'VERSION_NOT_CURRENT'
    AND analysis.status IN ('PENDING', 'PROCESSING');

  -- A worker crash on its final lease becomes visible dead-letter evidence.
  UPDATE public.document_intelligence_jobs AS job
  SET status = 'DEAD_LETTER',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = 'LEASE_EXPIRED',
      last_error_detail = 'The final document-intelligence worker lease expired.',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE job.status = 'LEASED'
    AND job.lease_expires_at <= pg_catalog.now()
    AND job.attempts >= job.max_attempts;

  UPDATE public.document_intelligence_analyses AS analysis
  SET status = 'ERROR',
      failed_at = pg_catalog.now(),
      error_code = 'LEASE_EXPIRED',
      error_detail = 'The final document-intelligence worker lease expired.',
      version = analysis.version + 1,
      updated_at = pg_catalog.now()
  FROM public.document_intelligence_jobs AS job
  WHERE job.analysis_id = analysis.id
    AND job.status = 'DEAD_LETTER'
    AND job.last_error_code = 'LEASE_EXPIRED'
    AND analysis.status IN ('PENDING', 'PROCESSING');

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.document_intelligence_jobs AS job
    JOIN public.document_intelligence_analyses AS analysis
      ON analysis.id = job.analysis_id
     AND analysis.organisation_id = job.organisation_id
    JOIN public.matter_document_versions AS version_record
      ON version_record.id = analysis.version_id
     AND version_record.organisation_id = analysis.organisation_id
    JOIN public.matter_documents AS document_record
      ON document_record.id = analysis.document_id
     AND document_record.organisation_id = analysis.organisation_id
    WHERE (
        (job.status = 'QUEUED' AND job.next_attempt_at <= pg_catalog.now())
        OR (job.status = 'LEASED' AND job.lease_expires_at <= pg_catalog.now())
      )
      AND job.attempts < job.max_attempts
      AND analysis.status IN ('PENDING', 'PROCESSING')
      AND version_record.status = 'AVAILABLE'
      AND version_record.scan_status = 'CLEAN'
      AND document_record.current_version_id = version_record.id
      AND document_record.deleted_at IS NULL
    ORDER BY job.next_attempt_at, job.created_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.document_intelligence_jobs AS job
    SET status = 'LEASED',
        attempts = job.attempts + 1,
        lease_owner = pg_catalog.btrim(p_worker_id),
        lease_expires_at = pg_catalog.now()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = pg_catalog.now()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*
  ), analysis_updated AS (
    UPDATE public.document_intelligence_analyses AS analysis
    SET status = 'PROCESSING',
        started_at = COALESCE(analysis.started_at, pg_catalog.now()),
        failed_at = NULL,
        error_code = NULL,
        error_detail = NULL,
        version = analysis.version + 1,
        updated_at = pg_catalog.now()
    FROM claimed
    WHERE analysis.id = claimed.analysis_id
    RETURNING analysis.*
  )
  SELECT
    claimed.id,
    claimed.organisation_id,
    analysis_updated.id,
    analysis_updated.matter_id,
    analysis_updated.document_id,
    analysis_updated.version_id,
    version_record.storage_bucket::text,
    version_record.storage_path::text,
    version_record.original_file_name::text,
    version_record.content_type::text,
    version_record.size_bytes,
    version_record.sha256_hex::text,
    document_record.title::text,
    document_record.category::text,
    claimed.attempts,
    claimed.max_attempts
  FROM claimed
  JOIN analysis_updated ON analysis_updated.id = claimed.analysis_id
  JOIN public.matter_document_versions AS version_record
    ON version_record.id = analysis_updated.version_id
   AND version_record.organisation_id = analysis_updated.organisation_id
  JOIN public.matter_documents AS document_record
    ON document_record.id = analysis_updated.document_id
   AND document_record.organisation_id = analysis_updated.organisation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_document_intelligence_job(
  p_job_id uuid,
  p_worker_id text,
  p_provider text,
  p_model text,
  p_provider_response_id text,
  p_provider_request_id text,
  p_detected_category public.document_category,
  p_category_confidence_bps integer,
  p_extracted_fields jsonb,
  p_extracted_names text[],
  p_extracted_dates jsonb,
  p_expiry_date date,
  p_missing_pages integer[],
  p_missing_information text[],
  p_inconsistencies text[],
  p_summary text,
  p_review_priority public.document_review_priority,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_estimated_cost_minor bigint
)
RETURNS TABLE (analysis_id uuid, analysis_status text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_job public.document_intelligence_jobs%ROWTYPE;
  v_analysis public.document_intelligence_analyses%ROWTYPE;
  v_invalid_text boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_extracted_names, ARRAY[]::text[])) AS value
      WHERE value IS NULL OR pg_catalog.btrim(value) = ''
        OR char_length(value) > 240
    )
    OR EXISTS (
      SELECT 1 FROM unnest(
        COALESCE(p_missing_information, ARRAY[]::text[])
        || COALESCE(p_inconsistencies, ARRAY[]::text[])
      ) AS value
      WHERE value IS NULL OR pg_catalog.btrim(value) = ''
        OR char_length(value) > 500
    )
  INTO v_invalid_text;

  IF p_job_id IS NULL OR p_worker_id IS NULL
    OR char_length(pg_catalog.btrim(p_worker_id)) NOT BETWEEN 3 AND 160
    OR p_provider IS NULL OR char_length(pg_catalog.btrim(p_provider)) NOT BETWEEN 1 AND 120
    OR p_model IS NULL OR char_length(pg_catalog.btrim(p_model)) NOT BETWEEN 1 AND 120
    OR p_provider_response_id IS NULL
    OR char_length(pg_catalog.btrim(p_provider_response_id)) NOT BETWEEN 3 AND 240
    OR (
      p_provider_request_id IS NOT NULL
      AND char_length(pg_catalog.btrim(p_provider_request_id)) > 240
    )
    OR p_detected_category IS NULL
    OR p_category_confidence_bps IS NULL
    OR p_category_confidence_bps NOT BETWEEN 0 AND 10000
    OR p_extracted_fields IS NULL OR pg_catalog.jsonb_typeof(p_extracted_fields) <> 'object'
    OR p_extracted_dates IS NULL OR pg_catalog.jsonb_typeof(p_extracted_dates) <> 'array'
    OR p_extracted_names IS NULL OR cardinality(p_extracted_names) > 100
    OR p_missing_pages IS NULL OR cardinality(p_missing_pages) > 500
    OR EXISTS (
      SELECT 1 FROM unnest(p_missing_pages) AS page_number
      WHERE page_number IS NULL OR page_number < 1
    )
    OR p_missing_information IS NULL OR cardinality(p_missing_information) > 100
    OR p_inconsistencies IS NULL OR cardinality(p_inconsistencies) > 100
    OR v_invalid_text
    OR p_summary IS NULL OR char_length(pg_catalog.btrim(p_summary)) NOT BETWEEN 3 AND 4000
    OR p_review_priority IS NULL
    OR p_input_tokens IS NULL OR p_output_tokens IS NULL
    OR p_total_tokens IS NULL OR p_estimated_cost_minor IS NULL
    OR least(p_input_tokens, p_output_tokens, p_total_tokens, p_estimated_cost_minor) < 0
    OR p_total_tokens < p_input_tokens + p_output_tokens THEN
    RAISE EXCEPTION 'Document-intelligence completion is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.document_intelligence_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status <> 'LEASED'
    OR v_job.lease_owner IS DISTINCT FROM pg_catalog.btrim(p_worker_id)
    OR v_job.lease_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Document-intelligence lease is no longer valid'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_analysis
  FROM public.document_intelligence_analyses AS analysis
  WHERE analysis.id = v_job.analysis_id
    AND analysis.organisation_id = v_job.organisation_id
  FOR UPDATE;

  IF NOT FOUND OR v_analysis.status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Document analysis is not processing'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.document_intelligence_analyses
  SET status = 'READY',
      provider = pg_catalog.btrim(p_provider),
      model = pg_catalog.btrim(p_model),
      provider_response_id = pg_catalog.btrim(p_provider_response_id),
      provider_request_id = NULLIF(pg_catalog.btrim(p_provider_request_id), ''),
      detected_category = p_detected_category,
      category_confidence_bps = p_category_confidence_bps,
      extracted_fields = p_extracted_fields,
      extracted_names = p_extracted_names::varchar(240)[],
      extracted_dates = p_extracted_dates,
      expiry_date = p_expiry_date,
      missing_pages = p_missing_pages,
      missing_information = p_missing_information::varchar(500)[],
      inconsistencies = p_inconsistencies::varchar(500)[],
      summary = pg_catalog.btrim(p_summary),
      review_priority = p_review_priority,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      estimated_cost_minor = p_estimated_cost_minor,
      completed_at = pg_catalog.now(),
      failed_at = NULL,
      error_code = NULL,
      error_detail = NULL,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_analysis.id;

  UPDATE public.document_intelligence_jobs
  SET status = 'SUCCEEDED',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      last_error_detail = NULL,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_job.id;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_identifier,
    source, action, resource_type, resource_id, outcome,
    new_value, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_job.organisation_id,
    'AI_AGENT'::public.audit_actor_type,
    left('document-intelligence:' || pg_catalog.btrim(p_provider), 200),
    'businessos-document-intelligence', 'document.intelligence.completed',
    'matter_document', v_analysis.document_id::text,
    'SUCCESS'::public.audit_outcome,
    pg_catalog.jsonb_build_object(
      'analysisId', v_analysis.id,
      'versionId', v_analysis.version_id,
      'status', 'READY',
      'reviewPriority', p_review_priority::text
    ),
    pg_catalog.jsonb_build_object(
      'jobId', v_job.id,
      'model', pg_catalog.btrim(p_model),
      'providerResponseId', pg_catalog.btrim(p_provider_response_id),
      'inputTokens', p_input_tokens,
      'outputTokens', p_output_tokens,
      'estimatedCostMinor', p_estimated_cost_minor,
      'humanConfirmationRequired', true
    )
  );

  PERFORM private.record_automation_value_event(
    v_job.organisation_id,
    'document.intelligence.completed',
    'document_intelligence_analysis',
    v_analysis.id,
    pg_catalog.jsonb_build_object(
      'providerEvidence', true,
      'humanConfirmationRequired', true
    ),
    pg_catalog.now()
  );

  RETURN QUERY SELECT v_analysis.id, 'READY'::text, 'SUCCEEDED'::text;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fail_document_intelligence_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text,
  p_retryable boolean
)
RETURNS TABLE (analysis_status text, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_job public.document_intelligence_jobs%ROWTYPE;
  v_retry boolean;
BEGIN
  IF p_job_id IS NULL OR p_worker_id IS NULL
    OR char_length(pg_catalog.btrim(p_worker_id)) NOT BETWEEN 3 AND 160
    OR p_error_code IS NULL OR pg_catalog.btrim(p_error_code) = '' THEN
    RAISE EXCEPTION 'Document-intelligence failure report is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.document_intelligence_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status <> 'LEASED'
    OR v_job.lease_owner IS DISTINCT FROM pg_catalog.btrim(p_worker_id)
    OR v_job.lease_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Document-intelligence lease is no longer valid'
      USING ERRCODE = '40001';
  END IF;

  v_retry := COALESCE(p_retryable, false) AND v_job.attempts < v_job.max_attempts;

  UPDATE public.document_intelligence_jobs
  SET status = CASE
        WHEN v_retry THEN 'QUEUED'::public.document_intelligence_job_status
        ELSE 'DEAD_LETTER'::public.document_intelligence_job_status
      END,
      next_attempt_at = CASE
        WHEN v_retry THEN pg_catalog.now() + pg_catalog.make_interval(
          secs => least(1800, 30 * power(2, greatest(0, v_job.attempts - 1))::integer)
        )
        ELSE next_attempt_at
      END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = left(pg_catalog.btrim(p_error_code), 120),
      last_error_detail = left(
        COALESCE(NULLIF(pg_catalog.btrim(p_error_detail), ''), 'Provider failure.'),
        1000
      ),
      completed_at = CASE WHEN v_retry THEN NULL ELSE pg_catalog.now() END,
      updated_at = pg_catalog.now()
  WHERE id = v_job.id;

  UPDATE public.document_intelligence_analyses
  SET status = CASE
        WHEN v_retry THEN 'PENDING'::public.document_intelligence_status
        ELSE 'ERROR'::public.document_intelligence_status
      END,
      failed_at = CASE WHEN v_retry THEN NULL ELSE pg_catalog.now() END,
      error_code = CASE
        WHEN v_retry THEN NULL ELSE left(pg_catalog.btrim(p_error_code), 120)
      END,
      error_detail = CASE
        WHEN v_retry THEN NULL
        ELSE left(
          COALESCE(NULLIF(pg_catalog.btrim(p_error_detail), ''), 'Provider failure.'),
          1000
        )
      END,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_job.analysis_id;

  IF NOT v_retry THEN
    INSERT INTO public.audit_events (
      id, organisation_id, actor_type, actor_identifier,
      source, action, resource_type, resource_id, outcome, reason, metadata
    )
    SELECT
      pg_catalog.gen_random_uuid(), analysis.organisation_id,
      'SERVICE'::public.audit_actor_type, 'document-intelligence-worker',
      'businessos-document-intelligence', 'document.intelligence.dead_lettered',
      'matter_document', analysis.document_id::text,
      'FAILURE'::public.audit_outcome,
      'Document intelligence exhausted its retry policy.',
      pg_catalog.jsonb_build_object(
        'analysisId', analysis.id,
        'jobId', v_job.id,
        'errorCode', left(pg_catalog.btrim(p_error_code), 120),
        'attempts', v_job.attempts
      )
    FROM public.document_intelligence_analyses AS analysis
    WHERE analysis.id = v_job.analysis_id;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_retry THEN 'PENDING' ELSE 'ERROR' END::text,
    CASE WHEN v_retry THEN 'QUEUED' ELSE 'DEAD_LETTER' END::text;
END;
$function$;

ALTER FUNCTION private.claim_document_intelligence_job(text, integer)
  OWNER TO postgres;
ALTER FUNCTION private.complete_document_intelligence_job(
  uuid, text, text, text, text, text, public.document_category, integer,
  jsonb, text[], jsonb, date, integer[], text[], text[], text,
  public.document_review_priority, integer, integer, integer, bigint
) OWNER TO postgres;
ALTER FUNCTION private.fail_document_intelligence_job(
  uuid, text, text, text, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.claim_document_intelligence_job(text, integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.complete_document_intelligence_job(
  uuid, text, text, text, text, text, public.document_category, integer,
  jsonb, text[], jsonb, date, integer[], text[], text[], text,
  public.document_review_priority, integer, integer, integer, bigint
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.fail_document_intelligence_job(
  uuid, text, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.claim_document_intelligence_job(text, integer)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.complete_document_intelligence_job(
  uuid, text, text, text, text, text, public.document_category, integer,
  jsonb, text[], jsonb, date, integer[], text[], text[], text,
  public.document_review_priority, integer, integer, integer, bigint
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.fail_document_intelligence_job(
  uuid, text, text, text, boolean
) TO businessos_app;

CREATE OR REPLACE FUNCTION private.review_document_intelligence(
  p_analysis_id uuid,
  p_decision public.document_intelligence_review_decision,
  p_confirmed_category public.document_category,
  p_confirmed_expiry_date date,
  p_corrections jsonb,
  p_notes text,
  p_create_follow_up_task boolean,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_analysis public.document_intelligence_analyses%ROWTYPE;
  v_document public.matter_documents%ROWTYPE;
  v_matter public.matters%ROWTYPE;
  v_review_id uuid;
  v_task_id uuid;
  v_item_status public.document_request_item_status;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(
      v_org, 'document_intelligence.review'
    ) THEN
    RAISE EXCEPTION 'AAL2 document-intelligence review authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_analysis_id IS NULL OR p_decision IS NULL OR p_confirmed_category IS NULL
    OR p_corrections IS NULL OR pg_catalog.jsonb_typeof(p_corrections) <> 'object'
    OR p_notes IS NULL OR char_length(pg_catalog.btrim(p_notes)) NOT BETWEEN 3 AND 2000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Document-intelligence review is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_analysis
  FROM public.document_intelligence_analyses AS analysis
  WHERE analysis.id = p_analysis_id
    AND analysis.organisation_id = v_org
  FOR UPDATE;

  IF NOT FOUND OR NOT private.can_update_matter(v_org, v_analysis.matter_id) THEN
    RAISE EXCEPTION 'Document analysis was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_analysis.version <> p_expected_version THEN
    RAISE EXCEPTION 'Document analysis changed; refresh before reviewing'
      USING ERRCODE = '40001';
  END IF;
  IF v_analysis.status = 'PROCESSING' THEN
    RAISE EXCEPTION 'Document analysis is currently processing'
      USING ERRCODE = 'object_in_use';
  END IF;
  IF v_analysis.status IN ('REVIEWED', 'REJECTED') OR EXISTS (
    SELECT 1 FROM public.document_intelligence_reviews AS review
    WHERE review.analysis_id = v_analysis.id
  ) THEN
    RAISE EXCEPTION 'Document analysis has already been reviewed'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT * INTO v_document
  FROM public.matter_documents AS document_record
  WHERE document_record.id = v_analysis.document_id
    AND document_record.organisation_id = v_org
    AND document_record.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document was not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_matter
  FROM public.matters AS matter
  WHERE matter.id = v_analysis.matter_id
    AND matter.organisation_id = v_org
    AND matter.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Matter was not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(p_create_follow_up_task, false)
    AND NOT private.has_organisation_permission(v_org, 'tasks.create') THEN
    RAISE EXCEPTION 'Task creation permission is required for a follow-up task'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.document_intelligence_reviews (
    organisation_id, analysis_id, document_id, decision,
    confirmed_category, confirmed_expiry_date, corrections, notes,
    create_follow_up_task, reviewed_by_user_profile_id
  ) VALUES (
    v_org, v_analysis.id, v_analysis.document_id, p_decision,
    p_confirmed_category, p_confirmed_expiry_date, p_corrections,
    pg_catalog.btrim(p_notes), COALESCE(p_create_follow_up_task, false), v_user
  )
  RETURNING id INTO v_review_id;

  UPDATE public.document_intelligence_analyses
  SET status = CASE
        WHEN p_decision = 'REJECTED'
          THEN 'REJECTED'::public.document_intelligence_status
        ELSE 'REVIEWED'::public.document_intelligence_status
      END,
      completed_at = COALESCE(completed_at, pg_catalog.now()),
      failed_at = NULL,
      error_code = NULL,
      error_detail = NULL,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_analysis.id;

  UPDATE public.document_intelligence_jobs
  SET status = 'CANCELLED',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = 'HUMAN_REVIEW_COMPLETED',
      last_error_detail = 'The analysis was completed through the human review workflow.',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE analysis_id = v_analysis.id
    AND status = 'QUEUED';

  UPDATE public.matter_documents
  SET category = CASE
        WHEN p_decision = 'REJECTED' THEN category
        ELSE p_confirmed_category
      END,
      expires_at = CASE
        WHEN p_decision = 'REJECTED' THEN expires_at
        ELSE p_confirmed_expiry_date::timestamptz
      END,
      last_intelligence_analysis_id = v_analysis.id,
      updated_by_user_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_document.id AND organisation_id = v_org;

  IF v_document.request_item_id IS NOT NULL THEN
    v_item_status := CASE
      WHEN p_decision = 'REJECTED'
        THEN 'REJECTED'::public.document_request_item_status
      ELSE 'ACCEPTED'::public.document_request_item_status
    END;
    UPDATE public.document_request_items
    SET status = v_item_status,
        status_reason = CASE
          WHEN p_decision = 'REJECTED' THEN left(pg_catalog.btrim(p_notes), 1000)
          ELSE NULL
        END,
        updated_at = pg_catalog.now()
    WHERE id = v_document.request_item_id
      AND organisation_id = v_org;
  END IF;

  IF COALESCE(p_create_follow_up_task, false) THEN
    INSERT INTO public.matter_tasks (
      organisation_id, matter_id, title, description, status, priority,
      assigned_to_user_id, due_at, created_by_user_id, updated_by_user_id
    ) VALUES (
      v_org, v_analysis.matter_id,
      left('Document follow-up: ' || v_document.title, 240),
      left(
        'Created from a controlled document review. ' || pg_catalog.btrim(p_notes),
        10000
      ),
      'OPEN'::public.case_task_status,
      CASE
        WHEN p_decision = 'REJECTED'
          OR p_confirmed_expiry_date < pg_catalog.current_date
          OR cardinality(v_analysis.inconsistencies) > 0
          THEN 'HIGH'::public.case_task_priority
        ELSE 'NORMAL'::public.case_task_priority
      END,
      COALESCE(v_matter.assigned_to_user_id, v_matter.supervisor_user_id, v_user),
      pg_catalog.now() + interval '2 days',
      v_user, v_user
    ) RETURNING id INTO v_task_id;
  END IF;

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id, actor_type
  ) VALUES (
    v_org, v_analysis.matter_id, 'DOCUMENT_INTELLIGENCE_REVIEWED',
    'DOCUMENT', v_analysis.document_id,
    CASE
      WHEN p_decision = 'REJECTED' THEN 'Document intelligence was rejected by a human reviewer.'
      WHEN p_decision = 'CORRECTED' THEN 'Document intelligence was corrected and confirmed by a human reviewer.'
      ELSE 'Document intelligence was confirmed by a human reviewer.'
    END,
    pg_catalog.jsonb_build_object(
      'analysisId', v_analysis.id,
      'reviewId', v_review_id,
      'decision', p_decision::text,
      'followUpTaskId', v_task_id,
      'providerOutputWasAdvisory', true
    ),
    v_user, 'USER'::public.audit_actor_type
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome,
    previous_value, new_value, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER'::public.audit_actor_type, v_user,
    'businessos-api', 'document.intelligence.reviewed',
    'matter_document', v_analysis.document_id::text,
    'SUCCESS'::public.audit_outcome,
    pg_catalog.jsonb_build_object(
      'category', v_document.category::text,
      'expiresAt', v_document.expires_at
    ),
    pg_catalog.jsonb_build_object(
      'analysisId', v_analysis.id,
      'reviewId', v_review_id,
      'decision', p_decision::text,
      'category', p_confirmed_category::text,
      'expiresAt', p_confirmed_expiry_date,
      'followUpTaskId', v_task_id
    ),
    pg_catalog.jsonb_build_object(
      'assuranceLevel', private.current_aal(),
      'providerOutputWasAdvisory', true
    )
  );

  PERFORM private.record_automation_value_event(
    v_org,
    'document.review.completed',
    'document_intelligence_review',
    v_review_id,
    pg_catalog.jsonb_build_object(
      'decision', p_decision::text,
      'analysisAvailable', v_analysis.status = 'READY',
      'benchmarkIsEstimate', true
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'analysisId', v_analysis.id,
    'reviewId', v_review_id,
    'documentId', v_analysis.document_id,
    'status', CASE WHEN p_decision = 'REJECTED' THEN 'REJECTED' ELSE 'REVIEWED' END,
    'decision', p_decision::text,
    'followUpTaskId', v_task_id,
    'reviewedAt', pg_catalog.now(),
    'version', v_analysis.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.update_operational_value_benchmark(
  p_benchmark_id uuid,
  p_estimated_manual_minutes integer,
  p_estimated_automated_minutes integer,
  p_hourly_cost_minor bigint,
  p_is_active boolean,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_benchmark public.organisation_value_benchmarks%ROWTYPE;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'operational_value.manage') THEN
    RAISE EXCEPTION 'AAL2 operational-value management authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_benchmark_id IS NULL
    OR p_estimated_manual_minutes IS NULL
    OR p_estimated_manual_minutes NOT BETWEEN 0 AND 1440
    OR p_estimated_automated_minutes IS NULL
    OR p_estimated_automated_minutes NOT BETWEEN 0 AND p_estimated_manual_minutes
    OR p_hourly_cost_minor IS NULL
    OR p_hourly_cost_minor NOT BETWEEN 0 AND 10000000
    OR p_is_active IS NULL OR p_expected_version IS NULL
    OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Operational-value benchmark is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_benchmark
  FROM public.organisation_value_benchmarks AS benchmark
  WHERE benchmark.id = p_benchmark_id AND benchmark.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operational-value benchmark was not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_benchmark.version <> p_expected_version THEN
    RAISE EXCEPTION 'Operational-value benchmark changed; refresh before saving'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.organisation_value_benchmarks
  SET estimated_manual_minutes = p_estimated_manual_minutes,
      estimated_automated_minutes = p_estimated_automated_minutes,
      hourly_cost_minor = p_hourly_cost_minor,
      is_active = p_is_active,
      updated_by_user_profile_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_benchmark.id;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome,
    previous_value, new_value, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER'::public.audit_actor_type, v_user,
    'businessos-api', 'operational_value.benchmark.updated',
    'organisation_value_benchmark', v_benchmark.id::text,
    'SUCCESS'::public.audit_outcome,
    pg_catalog.jsonb_build_object(
      'manualMinutes', v_benchmark.estimated_manual_minutes,
      'automatedMinutes', v_benchmark.estimated_automated_minutes,
      'hourlyCostMinor', v_benchmark.hourly_cost_minor,
      'isActive', v_benchmark.is_active,
      'version', v_benchmark.version
    ),
    pg_catalog.jsonb_build_object(
      'manualMinutes', p_estimated_manual_minutes,
      'automatedMinutes', p_estimated_automated_minutes,
      'hourlyCostMinor', p_hourly_cost_minor,
      'isActive', p_is_active,
      'version', v_benchmark.version + 1
    ),
    pg_catalog.jsonb_build_object('assuranceLevel', private.current_aal())
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_benchmark.id,
    'eventKey', v_benchmark.event_key,
    'manualMinutes', p_estimated_manual_minutes,
    'automatedMinutes', p_estimated_automated_minutes,
    'hourlyCostMinor', p_hourly_cost_minor::text,
    'isActive', p_is_active,
    'version', v_benchmark.version + 1,
    'updatedAt', pg_catalog.now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.get_operational_intelligence_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_can_read_documents boolean;
  v_can_review_documents boolean;
  v_can_read_control_tower boolean;
  v_can_read_value boolean;
  v_can_manage_value boolean;
  v_result jsonb;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR NOT private.has_organisation_permission(v_org, 'my_work.read') THEN
    RAISE EXCEPTION 'Personal work-queue permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_can_read_documents := private.has_organisation_permission(
    v_org, 'document_intelligence.read'
  );
  v_can_review_documents := private.has_organisation_permission(
    v_org, 'document_intelligence.review'
  ) AND private.current_aal() = 'AAL2';
  v_can_read_control_tower := private.has_organisation_permission(
    v_org, 'control_tower.read'
  );
  v_can_read_value := private.has_organisation_permission(
    v_org, 'operational_value.read'
  );
  v_can_manage_value := private.has_organisation_permission(
    v_org, 'operational_value.manage'
  ) AND private.current_aal() = 'AAL2';

  v_result := pg_catalog.jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'access', pg_catalog.jsonb_build_object(
      'documentIntelligence', v_can_read_documents,
      'documentReview', v_can_review_documents,
      'controlTower', v_can_read_control_tower,
      'operationalValue', v_can_read_value,
      'operationalValueManage', v_can_manage_value,
      'assuranceLevel', private.current_aal()
    ),
    'myWork', pg_catalog.jsonb_build_object(
      'summary', pg_catalog.jsonb_build_object(
        'openTasks', (
          SELECT count(*)::integer FROM public.matter_tasks AS task
          WHERE task.organisation_id = v_org
            AND task.assigned_to_user_id = v_user
            AND task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
            AND task.deleted_at IS NULL
            AND private.can_read_matter(v_org, task.matter_id)
        ),
        'overdueTasks', (
          SELECT count(*)::integer FROM public.matter_tasks AS task
          WHERE task.organisation_id = v_org
            AND task.assigned_to_user_id = v_user
            AND task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
            AND task.due_at < pg_catalog.now()
            AND task.deleted_at IS NULL
            AND private.can_read_matter(v_org, task.matter_id)
        ),
        'deadlinesNextSevenDays', (
          SELECT count(*)::integer FROM public.matter_deadlines AS deadline
          WHERE deadline.organisation_id = v_org
            AND (deadline.owner_user_id = v_user OR deadline.owner_user_id IS NULL)
            AND deadline.status = 'OPEN'
            AND deadline.due_at <= pg_catalog.now() + interval '7 days'
            AND deadline.deleted_at IS NULL
            AND private.can_read_matter(v_org, deadline.matter_id)
        ),
        'pendingApprovals', (
          SELECT count(*)::integer FROM public.approval_requests AS approval
          WHERE approval.organisation_id = v_org
            AND approval.status = 'PENDING'
            AND approval.expires_at > pg_catalog.now()
            AND (approval.approver_user_id IS NULL OR approval.approver_user_id = v_user)
        ),
        'waitingOnCustomer', (
          SELECT count(*)::integer
          FROM public.document_request_items AS item
          JOIN public.document_requests AS request_record
            ON request_record.id = item.request_id
           AND request_record.organisation_id = item.organisation_id
          WHERE item.organisation_id = v_org
            AND item.is_required = true
            AND item.status = 'REQUESTED'
            AND request_record.status IN ('SENT', 'PARTIALLY_RECEIVED')
            AND request_record.deleted_at IS NULL
            AND private.can_read_matter(v_org, request_record.matter_id)
        ),
        'documentReviews', CASE WHEN v_can_read_documents THEN (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org
            AND analysis.status IN ('PENDING', 'READY', 'ERROR')
            AND private.can_read_matter(v_org, analysis.matter_id)
        ) ELSE 0 END
      ),
      'items', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(work_item))
        FROM (
          SELECT * FROM (
            SELECT
              'TASK'::text AS "kind", task.id, task.matter_id AS "matterId",
              matter.matter_number AS "matterNumber", task.title,
              task.due_at AS "dueAt", task.priority::text AS "priority",
              task.status::text AS "status"
            FROM public.matter_tasks AS task
            JOIN public.matters AS matter
              ON matter.id = task.matter_id
             AND matter.organisation_id = task.organisation_id
            WHERE task.organisation_id = v_org
              AND task.assigned_to_user_id = v_user
              AND task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
              AND task.deleted_at IS NULL
              AND private.can_read_matter(v_org, task.matter_id)
            UNION ALL
            SELECT
              'DEADLINE'::text, deadline.id, deadline.matter_id,
              matter.matter_number, deadline.title, deadline.due_at,
              CASE WHEN deadline.is_critical THEN 'URGENT' ELSE 'HIGH' END,
              deadline.status::text
            FROM public.matter_deadlines AS deadline
            JOIN public.matters AS matter
              ON matter.id = deadline.matter_id
             AND matter.organisation_id = deadline.organisation_id
            WHERE deadline.organisation_id = v_org
              AND (deadline.owner_user_id = v_user OR deadline.owner_user_id IS NULL)
              AND deadline.status = 'OPEN'
              AND deadline.deleted_at IS NULL
              AND private.can_read_matter(v_org, deadline.matter_id)
          ) AS combined_work
          ORDER BY "dueAt" ASC NULLS LAST, "priority" DESC, id
          LIMIT 30
        ) AS work_item
      ), '[]'::jsonb)
    ),
    'documents', CASE WHEN v_can_read_documents THEN pg_catalog.jsonb_build_object(
      'summary', pg_catalog.jsonb_build_object(
        'awaitingAnalysis', (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org AND analysis.status = 'PENDING'
            AND private.can_read_matter(v_org, analysis.matter_id)
        ),
        'processing', (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org AND analysis.status = 'PROCESSING'
            AND private.can_read_matter(v_org, analysis.matter_id)
        ),
        'readyForReview', (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org AND analysis.status = 'READY'
            AND private.can_read_matter(v_org, analysis.matter_id)
        ),
        'urgent', (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org
            AND analysis.status IN ('PENDING', 'READY', 'ERROR')
            AND analysis.review_priority = 'URGENT'
            AND private.can_read_matter(v_org, analysis.matter_id)
        ),
        'failed', (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org AND analysis.status = 'ERROR'
            AND private.can_read_matter(v_org, analysis.matter_id)
        ),
        'expiringThirtyDays', (
          SELECT count(*)::integer
          FROM public.matter_documents AS document_record
          WHERE document_record.organisation_id = v_org
            AND document_record.expires_at >= pg_catalog.now()
            AND document_record.expires_at < pg_catalog.now() + interval '30 days'
            AND document_record.deleted_at IS NULL
            AND private.can_read_matter(v_org, document_record.matter_id)
        )
      ),
      'items', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(document_item))
        FROM (
          SELECT
            analysis.id AS "analysisId",
            analysis.document_id AS "documentId",
            analysis.matter_id AS "matterId",
            matter.matter_number AS "matterNumber",
            matter.title AS "matterTitle",
            document_record.title AS "documentTitle",
            document_record.category::text AS "currentCategory",
            analysis.detected_category::text AS "detectedCategory",
            analysis.category_confidence_bps AS "categoryConfidenceBps",
            analysis.status::text AS "status",
            analysis.review_priority::text AS "reviewPriority",
            analysis.summary,
            analysis.expiry_date AS "suggestedExpiryDate",
            analysis.missing_pages AS "missingPages",
            analysis.missing_information AS "missingInformation",
            analysis.inconsistencies,
            analysis.provider,
            analysis.model,
            analysis.version,
            analysis.created_at AS "createdAt",
            analysis.completed_at AS "completedAt",
            analysis.error_code AS "errorCode",
            job.status::text AS "jobStatus",
            (v_can_review_documents AND analysis.status IN ('PENDING', 'READY', 'ERROR'))
              AS "canReview"
          FROM public.document_intelligence_analyses AS analysis
          JOIN public.matter_documents AS document_record
            ON document_record.id = analysis.document_id
           AND document_record.organisation_id = analysis.organisation_id
          JOIN public.matters AS matter
            ON matter.id = analysis.matter_id
           AND matter.organisation_id = analysis.organisation_id
          LEFT JOIN public.document_intelligence_jobs AS job
            ON job.analysis_id = analysis.id
          WHERE analysis.organisation_id = v_org
            AND analysis.status IN ('PENDING', 'PROCESSING', 'READY', 'ERROR')
            AND document_record.deleted_at IS NULL
            AND private.can_read_matter(v_org, analysis.matter_id)
          ORDER BY
            CASE analysis.review_priority
              WHEN 'URGENT' THEN 1 WHEN 'ATTENTION' THEN 2 ELSE 3
            END,
            analysis.created_at,
            analysis.id
          LIMIT 40
        ) AS document_item
      ), '[]'::jsonb)
    ) ELSE pg_catalog.jsonb_build_object(
      'summary', pg_catalog.jsonb_build_object(
        'awaitingAnalysis', 0, 'processing', 0, 'readyForReview', 0,
        'urgent', 0, 'failed', 0, 'expiringThirtyDays', 0
      ),
      'items', '[]'::jsonb
    ) END,
    'controlTower', CASE WHEN v_can_read_control_tower THEN pg_catalog.jsonb_build_object(
      'summary', pg_catalog.jsonb_build_object(
        'newEnquiriesThirtyDays', (
          SELECT count(*)::integer FROM public.enquiries AS enquiry
          WHERE enquiry.organisation_id = v_org
            AND enquiry.created_at >= pg_catalog.now() - interval '30 days'
            AND enquiry.deleted_at IS NULL
        ),
        'conversionsThirtyDays', (
          SELECT count(*)::integer FROM public.enquiry_conversions AS conversion
          WHERE conversion.organisation_id = v_org
            AND conversion.created_at >= pg_catalog.now() - interval '30 days'
        ),
        'openMatters', (
          SELECT count(*)::integer FROM public.matters AS matter
          WHERE matter.organisation_id = v_org
            AND matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
            AND matter.deleted_at IS NULL
        ),
        'completedThirtyDays', (
          SELECT count(*)::integer FROM public.matters AS matter
          WHERE matter.organisation_id = v_org AND matter.status = 'CLOSED'
            AND matter.closed_at >= pg_catalog.now() - interval '30 days'
            AND matter.deleted_at IS NULL
        ),
        'unassignedMatters', (
          SELECT count(*)::integer FROM public.matters AS matter
          WHERE matter.organisation_id = v_org
            AND matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
            AND matter.assigned_to_user_id IS NULL AND matter.deleted_at IS NULL
        ),
        'noNextAction', (
          SELECT count(*)::integer FROM public.matters AS matter
          WHERE matter.organisation_id = v_org
            AND matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
            AND (matter.next_action_at IS NULL OR matter.next_action_at < pg_catalog.now())
            AND matter.deleted_at IS NULL
        ),
        'overdueTasks', (
          SELECT count(*)::integer FROM public.matter_tasks AS task
          WHERE task.organisation_id = v_org
            AND task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
            AND task.due_at < pg_catalog.now() AND task.deleted_at IS NULL
        ),
        'slaAtRisk', (
          SELECT count(*)::integer FROM public.sla_instances AS instance
          WHERE instance.organisation_id = v_org AND instance.status = 'AT_RISK'
        ),
        'slaBreached', (
          SELECT count(*)::integer FROM public.sla_instances AS instance
          WHERE instance.organisation_id = v_org AND instance.status = 'BREACHED'
        ),
        'pendingApprovals', (
          SELECT count(*)::integer FROM public.approval_requests AS approval
          WHERE approval.organisation_id = v_org AND approval.status = 'PENDING'
            AND approval.expires_at > pg_catalog.now()
        ),
        'documentReviewBacklog', CASE WHEN v_can_read_documents THEN (
          SELECT count(*)::integer
          FROM public.document_intelligence_analyses AS analysis
          WHERE analysis.organisation_id = v_org
            AND analysis.status IN ('PENDING', 'READY', 'ERROR')
        ) ELSE 0 END
      ),
      'workload', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(workload_item))
        FROM (
          SELECT
            membership.user_profile_id AS "userId",
            COALESCE(
              NULLIF(profile.display_name, ''),
              NULLIF(pg_catalog.btrim(
                COALESCE(profile.first_name, '') || ' ' || COALESCE(profile.last_name, '')
              ), ''),
              profile.email
            ) AS "displayName",
            membership.job_title AS "jobTitle",
            count(DISTINCT matter.id) FILTER (
              WHERE matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
            )::integer AS "openMatters",
            count(DISTINCT task.id) FILTER (
              WHERE task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
            )::integer AS "openTasks",
            count(DISTINCT task.id) FILTER (
              WHERE task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
                AND task.due_at < pg_catalog.now()
            )::integer AS "overdueTasks"
          FROM public.organisation_memberships AS membership
          JOIN public.user_profiles AS profile
            ON profile.id = membership.user_profile_id
          LEFT JOIN public.matters AS matter
            ON matter.organisation_id = membership.organisation_id
           AND matter.assigned_to_user_id = membership.user_profile_id
           AND matter.deleted_at IS NULL
          LEFT JOIN public.matter_tasks AS task
            ON task.organisation_id = membership.organisation_id
           AND task.assigned_to_user_id = membership.user_profile_id
           AND task.deleted_at IS NULL
          WHERE membership.organisation_id = v_org
            AND membership.status = 'ACTIVE'
            AND membership.deleted_at IS NULL
            AND profile.status = 'ACTIVE'
            AND profile.deleted_at IS NULL
          GROUP BY membership.user_profile_id, profile.display_name,
            profile.first_name, profile.last_name, profile.email,
            membership.job_title
          ORDER BY "overdueTasks" DESC, "openTasks" DESC, "displayName"
          LIMIT 50
        ) AS workload_item
      ), '[]'::jsonb),
      'matterStages', COALESCE((
        SELECT pg_catalog.jsonb_object_agg(stage.status::text, stage.total)
        FROM (
          SELECT matter.status, count(*)::integer AS total
          FROM public.matters AS matter
          WHERE matter.organisation_id = v_org AND matter.deleted_at IS NULL
          GROUP BY matter.status
        ) AS stage
      ), '{}'::jsonb),
      'enquiryStages', COALESCE((
        SELECT pg_catalog.jsonb_object_agg(stage.status::text, stage.total)
        FROM (
          SELECT enquiry.status, count(*)::integer AS total
          FROM public.enquiries AS enquiry
          WHERE enquiry.organisation_id = v_org AND enquiry.deleted_at IS NULL
          GROUP BY enquiry.status
        ) AS stage
      ), '{}'::jsonb)
    ) ELSE NULL END,
    'value', CASE WHEN v_can_read_value THEN pg_catalog.jsonb_build_object(
      'periodDays', 30,
      'estimateBasis', 'ORGANISATION_CONFIGURABLE_BENCHMARKS',
      'disclaimer', 'Time and monetary values are estimates based on organisation-configured benchmark assumptions.',
      'estimatedMinutesSaved', (
        SELECT COALESCE(sum(event.estimated_minutes_saved), 0)::bigint::text
        FROM public.automation_value_events AS event
        WHERE event.organisation_id = v_org
          AND event.occurred_at >= pg_catalog.now() - interval '30 days'
      ),
      'estimatedValueMinor', (
        SELECT COALESCE(sum(event.estimated_value_minor), 0)::bigint::text
        FROM public.automation_value_events AS event
        WHERE event.organisation_id = v_org
          AND event.occurred_at >= pg_catalog.now() - interval '30 days'
      ),
      'eventCount', (
        SELECT count(*)::integer FROM public.automation_value_events AS event
        WHERE event.organisation_id = v_org
          AND event.occurred_at >= pg_catalog.now() - interval '30 days'
      ),
      'benchmarks', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(benchmark_item))
        FROM (
          SELECT
            benchmark.id, benchmark.event_key AS "eventKey",
            benchmark.label, benchmark.category::text AS "category",
            benchmark.estimated_manual_minutes AS "manualMinutes",
            benchmark.estimated_automated_minutes AS "automatedMinutes",
            benchmark.hourly_cost_minor::text AS "hourlyCostMinor",
            benchmark.is_active AS "isActive", benchmark.version,
            benchmark.updated_at AS "updatedAt"
          FROM public.organisation_value_benchmarks AS benchmark
          WHERE benchmark.organisation_id = v_org
          ORDER BY benchmark.category, benchmark.label
        ) AS benchmark_item
      ), '[]'::jsonb),
      'recentEvents', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(value_event))
        FROM (
          SELECT
            event.id, event.event_key AS "eventKey",
            event.category::text AS "category",
            event.source_type AS "sourceType",
            event.estimated_minutes_saved AS "estimatedMinutesSaved",
            event.estimated_value_minor::text AS "estimatedValueMinor",
            event.occurred_at AS "occurredAt"
          FROM public.automation_value_events AS event
          WHERE event.organisation_id = v_org
          ORDER BY event.occurred_at DESC, event.id DESC
          LIMIT 20
        ) AS value_event
      ), '[]'::jsonb)
    ) ELSE NULL END
  );

  RETURN v_result;
END;
$function$;

ALTER FUNCTION private.review_document_intelligence(
  uuid, public.document_intelligence_review_decision,
  public.document_category, date, jsonb, text, boolean, integer
) OWNER TO postgres;
ALTER FUNCTION private.update_operational_value_benchmark(
  uuid, integer, integer, bigint, boolean, integer
) OWNER TO postgres;
ALTER FUNCTION private.get_operational_intelligence_dashboard() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.review_document_intelligence(
  uuid, public.document_intelligence_review_decision,
  public.document_category, date, jsonb, text, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.update_operational_value_benchmark(
  uuid, integer, integer, bigint, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.get_operational_intelligence_dashboard()
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.review_document_intelligence(
  uuid, public.document_intelligence_review_decision,
  public.document_category, date, jsonb, text, boolean, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.update_operational_value_benchmark(
  uuid, integer, integer, bigint, boolean, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.get_operational_intelligence_dashboard()
  TO businessos_app;

COMMIT;
