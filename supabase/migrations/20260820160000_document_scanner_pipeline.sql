BEGIN;

DO $block$
BEGIN
  CREATE TYPE public.document_scan_job_status AS ENUM (
    'QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$block$;

ALTER TABLE public.matter_document_versions
  ADD COLUMN scan_observed_sha256_hex char(64),
  ADD COLUMN scan_engine_version varchar(240),
  ADD COLUMN scan_signature varchar(240),
  ADD CONSTRAINT ck_matter_document_versions_observed_hash
    CHECK (
      scan_observed_sha256_hex IS NULL
      OR scan_observed_sha256_hex ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE public.matter_timeline_events
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD COLUMN actor_type public.audit_actor_type NOT NULL DEFAULT 'USER',
  ADD COLUMN actor_identifier varchar(200),
  ADD CONSTRAINT ck_matter_timeline_actor_identity CHECK (
    (
      actor_type = 'USER'
      AND actor_user_id IS NOT NULL
      AND actor_identifier IS NULL
    )
    OR (
      actor_type IN ('SERVICE', 'SYSTEM', 'AI_AGENT')
      AND actor_user_id IS NULL
      AND actor_identifier IS NOT NULL
      AND btrim(actor_identifier) <> ''
    )
  );

-- Terminal scan verdicts are service-owned. Remove the former human/BFF path
-- that could release a file without the scanner having streamed its bytes.
DROP FUNCTION IF EXISTS private.record_matter_document_scan_result(
  uuid, uuid, public.document_scan_status, text, text, text
);

DROP POLICY IF EXISTS matter_document_versions_update
  ON public.matter_document_versions;
REVOKE UPDATE ON public.matter_document_versions FROM businessos_app;

DROP POLICY IF EXISTS matter_documents_update ON public.matter_documents;
CREATE POLICY matter_documents_update ON public.matter_documents
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.can_update_matter(organisation_id, matter_id)
    AND (
      private.has_organisation_permission(
        organisation_id,
        'documents.classification.manage'
      )
      OR private.has_organisation_permission(
        organisation_id,
        'documents.archive'
      )
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND private.can_update_matter(organisation_id, matter_id)
    AND updated_by_user_id = private.current_user_id()
  );

DELETE FROM public.role_permissions AS role_permission
USING public.permissions AS permission
WHERE role_permission.permission_id = permission.id
  AND permission.key = 'documents.scan.manage';

UPDATE public.permissions
SET is_active = false,
    description = 'Retired: terminal malware scan results are service-owned.',
    metadata = COALESCE(metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'retiredAt', '2026-08-20T16:00:00Z',
        'replacement', 'businessos-document-scanner'
      ),
    updated_at = pg_catalog.now()
WHERE key = 'documents.scan.manage';

CREATE TABLE public.document_scan_jobs (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_id uuid NOT NULL,
  status public.document_scan_job_status NOT NULL DEFAULT 'QUEUED',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  lease_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  lease_owner varchar(160),
  lease_expires_at timestamptz(6),
  last_error_code varchar(120),
  last_error_detail varchar(1000),
  completed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_document_scan_jobs PRIMARY KEY (id),
  CONSTRAINT uq_document_scan_jobs_version UNIQUE (version_id),
  CONSTRAINT fk_document_scan_jobs_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_scan_jobs_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters(id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_scan_jobs_document FOREIGN KEY (document_id, organisation_id)
    REFERENCES public.matter_documents(id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_scan_jobs_version FOREIGN KEY (version_id, organisation_id)
    REFERENCES public.matter_document_versions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_document_scan_jobs_attempts CHECK (
    attempts >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempts <= max_attempts
  ),
  CONSTRAINT ck_document_scan_jobs_lease_count CHECK (lease_count >= 0),
  CONSTRAINT ck_document_scan_jobs_lease_state CHECK (
    (
      status = 'LEASED'
      AND lease_owner IS NOT NULL
      AND btrim(lease_owner) <> ''
      AND lease_expires_at IS NOT NULL
    )
    OR (
      status <> 'LEASED'
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CONSTRAINT ck_document_scan_jobs_completion CHECK (
    (status IN ('SUCCEEDED', 'FAILED', 'DEAD_LETTER') AND completed_at IS NOT NULL)
    OR (status IN ('QUEUED', 'LEASED') AND completed_at IS NULL)
  )
);

CREATE INDEX ix_document_scan_jobs_claim
  ON public.document_scan_jobs (status, next_attempt_at, created_at)
  WHERE status IN ('QUEUED', 'LEASED');
CREATE INDEX ix_document_scan_jobs_org_status
  ON public.document_scan_jobs (organisation_id, status, updated_at DESC);

CREATE TABLE private.document_scan_execution_contexts (
  transaction_id bigint NOT NULL,
  job_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  provider varchar(120) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_document_scan_execution_contexts PRIMARY KEY (transaction_id)
);

REVOKE ALL ON TABLE private.document_scan_execution_contexts
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.is_document_scanner_execution(
  p_organisation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM private.document_scan_execution_contexts AS execution
      WHERE execution.transaction_id = pg_catalog.txid_current()
        AND execution.organisation_id = p_organisation_id
    )
$function$;

ALTER FUNCTION private.is_document_scanner_execution(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_document_scanner_execution(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime;
GRANT EXECUTE ON FUNCTION private.is_document_scanner_execution(uuid)
  TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.validate_case_operation_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_actor_id uuid;
  v_system_scan boolean := private.is_document_scanner_execution(NEW.organisation_id);
BEGIN
  IF v_system_scan THEN
    IF TG_TABLE_NAME = 'matter_documents' AND TG_OP = 'UPDATE' THEN
      IF NEW.updated_by_user_id IS DISTINCT FROM OLD.updated_by_user_id THEN
        RAISE EXCEPTION 'System scan cannot change the last human updater'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'version must increment exactly once'
          USING ERRCODE = '40001';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'matter_timeline_events' AND TG_OP = 'INSERT' THEN
      IF NEW.actor_type NOT IN ('SERVICE', 'SYSTEM')
        OR NEW.actor_user_id IS NOT NULL
        OR NEW.actor_identifier IS NULL
        OR btrim(NEW.actor_identifier) = '' THEN
        RAISE EXCEPTION 'System timeline actor is invalid'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'System scan attempted an unsupported actor operation'
      USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS NULL
    OR private.current_organisation_id() IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'Verified organisation context is required'
      USING ERRCODE = '42501';
  END IF;

  v_actor_id := COALESCE(
    NULLIF(to_jsonb(NEW) ->> 'updated_by_user_id', '')::uuid,
    NULLIF(to_jsonb(NEW) ->> 'uploaded_by_user_id', '')::uuid,
    NULLIF(to_jsonb(NEW) ->> 'actor_user_id', '')::uuid
  );

  IF v_actor_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Operation actor does not match verified user'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'matter_timeline_events'
    AND (NEW.actor_type <> 'USER' OR NEW.actor_identifier IS NOT NULL) THEN
    RAISE EXCEPTION 'Interactive timeline actor must be a verified user'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NULLIF(to_jsonb(NEW) ->> 'version', '')::integer
      <> NULLIF(to_jsonb(OLD) ->> 'version', '')::integer + 1 THEN
    RAISE EXCEPTION 'version must increment exactly once'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_case_operation_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_assignee uuid;
  v_system_scan boolean := private.is_document_scanner_execution(NEW.organisation_id);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'version must increment exactly once'
      USING ERRCODE = '40001';
  END IF;

  IF v_system_scan THEN
    IF TG_TABLE_NAME <> 'document_requests' OR TG_OP <> 'UPDATE'
      OR NEW.updated_by_user_id IS DISTINCT FROM OLD.updated_by_user_id THEN
      RAISE EXCEPTION 'System scan attempted an unsupported record operation'
        USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;

  IF NEW.updated_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'updated_by_user_id must match the verified user'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'matter_tasks' THEN
    IF (to_jsonb(NEW) ->> 'assigned_to_user_id') IS DISTINCT FROM
       (to_jsonb(OLD) ->> 'assigned_to_user_id')
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'tasks.assign') THEN
      RAISE EXCEPTION 'tasks.assign permission is required'
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) ->> 'status') IS DISTINCT FROM (to_jsonb(OLD) ->> 'status')
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'tasks.complete') THEN
      RAISE EXCEPTION 'tasks.complete permission is required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'matter_deadlines' THEN
    IF (to_jsonb(NEW) ->> 'owner_user_id') IS DISTINCT FROM
       (to_jsonb(OLD) ->> 'owner_user_id')
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'deadlines.assign') THEN
      RAISE EXCEPTION 'deadlines.assign permission is required'
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) ->> 'status') IS DISTINCT FROM (to_jsonb(OLD) ->> 'status')
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'deadlines.manage') THEN
      RAISE EXCEPTION 'deadlines.manage permission is required'
        USING ERRCODE = '42501';
    END IF;
    IF COALESCE((to_jsonb(NEW) ->> 'is_critical')::boolean, false)
      AND NOT COALESCE((to_jsonb(OLD) ->> 'is_critical')::boolean, false)
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'deadlines.manage') THEN
      RAISE EXCEPTION 'deadlines.manage permission is required for critical deadlines'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'document_requests'
    AND (to_jsonb(NEW) ->> 'status') IS DISTINCT FROM (to_jsonb(OLD) ->> 'status')
    AND NOT private.has_organisation_permission(
      NEW.organisation_id,
      CASE
        WHEN to_jsonb(NEW) ->> 'status' = 'SENT' THEN 'document_requests.send'
        ELSE 'document_requests.manage'
      END
    ) THEN
    RAISE EXCEPTION 'Document request status change is not permitted'
      USING ERRCODE = '42501';
  END IF;

  v_assignee := COALESCE(
    NULLIF(to_jsonb(NEW) ->> 'assigned_to_user_id', '')::uuid,
    NULLIF(to_jsonb(NEW) ->> 'owner_user_id', '')::uuid
  );
  IF v_assignee IS NOT NULL THEN
    PERFORM private.assert_active_organisation_user(
      NEW.organisation_id,
      v_assignee,
      'case operation assignee'
    );
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.validate_case_operation_actor() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_case_operation_row() OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.enqueue_document_scan_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status = 'PENDING_SCAN' AND NEW.scan_status = 'PENDING' THEN
    INSERT INTO public.document_scan_jobs (
      organisation_id, matter_id, document_id, version_id
    )
    VALUES (
      NEW.organisation_id, NEW.matter_id, NEW.document_id, NEW.id
    )
    ON CONFLICT (version_id) DO NOTHING;
  ELSIF NEW.scan_status IN ('CLEAN', 'INFECTED', 'ERROR') THEN
    UPDATE public.document_scan_jobs
    SET status = CASE
          WHEN NEW.scan_status = 'ERROR'
            THEN 'FAILED'::public.document_scan_job_status
          ELSE 'SUCCEEDED'::public.document_scan_job_status
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE version_id = NEW.id
      AND status IN ('QUEUED', 'LEASED');
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.enqueue_document_scan_job() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enqueue_document_scan_job()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE TRIGGER matter_document_versions_enqueue_scan
  AFTER INSERT OR UPDATE ON public.matter_document_versions
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_document_scan_job();

INSERT INTO public.document_scan_jobs (
  organisation_id, matter_id, document_id, version_id
)
SELECT
  version_record.organisation_id,
  version_record.matter_id,
  version_record.document_id,
  version_record.id
FROM public.matter_document_versions AS version_record
WHERE version_record.status = 'PENDING_SCAN'
  AND version_record.scan_status = 'PENDING'
ON CONFLICT (version_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.complete_document_scan_job(
  p_job_id uuid,
  p_worker_id text,
  p_result public.document_scan_status,
  p_provider text,
  p_reference text,
  p_observed_sha256_hex text,
  p_engine_version text,
  p_signature text
)
RETURNS TABLE (
  job_status text,
  document_status text,
  scan_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_job public.document_scan_jobs%ROWTYPE;
  v_version public.matter_document_versions%ROWTYPE;
  v_document public.matter_documents%ROWTYPE;
  v_effective_result public.document_scan_status := p_result;
  v_version_status public.document_status;
  v_document_status public.document_status;
  v_request_item_id uuid;
  v_request_id uuid;
  v_job_status public.document_scan_job_status;
  v_actor_identifier text;
BEGIN
  IF p_job_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
    OR p_result IS NULL OR p_result NOT IN ('CLEAN', 'INFECTED', 'ERROR')
    OR p_provider IS NULL OR btrim(p_provider) = '' OR length(p_provider) > 120
    OR p_reference IS NULL OR btrim(p_reference) = '' OR length(p_reference) > 240
    OR (p_observed_sha256_hex IS NOT NULL AND p_observed_sha256_hex !~ '^[0-9a-f]{64}$')
    OR (p_result <> 'ERROR' AND p_observed_sha256_hex IS NULL)
    OR (
      p_result <> 'ERROR'
      AND (p_engine_version IS NULL OR btrim(p_engine_version) = '')
    )
    OR (
      p_result = 'INFECTED'
      AND (p_signature IS NULL OR btrim(p_signature) = '')
    )
    OR (p_result <> 'INFECTED' AND p_signature IS NOT NULL) THEN
    RAISE EXCEPTION 'Scanner completion is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.document_scan_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status <> 'LEASED'
    OR v_job.lease_owner IS DISTINCT FROM btrim(p_worker_id) THEN
    RAISE EXCEPTION 'Scanner lease is no longer valid' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_version
  FROM public.matter_document_versions AS version_record
  WHERE version_record.id = v_job.version_id
    AND version_record.organisation_id = v_job.organisation_id
  FOR UPDATE;

  IF NOT FOUND OR v_version.status <> 'PENDING_SCAN'
    OR v_version.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Document version is not awaiting a scan' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_document
  FROM public.matter_documents AS document_record
  WHERE document_record.id = v_job.document_id
    AND document_record.organisation_id = v_job.organisation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document was not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_observed_sha256_hex IS DISTINCT FROM v_version.sha256_hex THEN
    v_effective_result := 'ERROR';
  END IF;

  v_version_status := CASE
    WHEN v_effective_result = 'CLEAN' THEN 'AVAILABLE'
    ELSE 'QUARANTINED'
  END;
  v_job_status := CASE
    WHEN v_effective_result = 'ERROR' THEN 'FAILED'
    ELSE 'SUCCEEDED'
  END;
  v_actor_identifier := left('document-scanner:' || btrim(p_provider), 200);

  INSERT INTO private.document_scan_execution_contexts (
    transaction_id, job_id, organisation_id, provider
  )
  VALUES (
    pg_catalog.txid_current(), v_job.id, v_job.organisation_id, btrim(p_provider)
  )
  ON CONFLICT (transaction_id) DO UPDATE SET
    job_id = EXCLUDED.job_id,
    organisation_id = EXCLUDED.organisation_id,
    provider = EXCLUDED.provider,
    created_at = pg_catalog.now();

  PERFORM pg_catalog.set_config('app.organisation_id', v_job.organisation_id::text, true);
  PERFORM pg_catalog.set_config('app.user_id', v_document.updated_by_user_id::text, true);
  PERFORM pg_catalog.set_config('app.aal', 'AAL2', true);

  IF v_effective_result = 'CLEAN' THEN
    UPDATE public.matter_document_versions AS prior_version
    SET status = 'SUPERSEDED',
        superseded_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE prior_version.id = v_document.current_version_id
      AND prior_version.id <> v_version.id
      AND prior_version.status = 'AVAILABLE';
  END IF;

  UPDATE public.matter_document_versions
  SET status = v_version_status,
      scan_status = v_effective_result,
      scan_provider = btrim(p_provider),
      scan_reference = btrim(p_reference),
      scan_observed_sha256_hex = p_observed_sha256_hex,
      scan_engine_version = left(NULLIF(btrim(p_engine_version), ''), 240),
      scan_signature = left(NULLIF(btrim(p_signature), ''), 240),
      scan_completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_version.id;

  UPDATE public.matter_documents
  SET status = CASE
        WHEN v_effective_result = 'CLEAN' THEN 'AVAILABLE'::public.document_status
        WHEN current_version_id IS NULL THEN 'QUARANTINED'::public.document_status
        ELSE status
      END,
      current_version_id = CASE
        WHEN v_effective_result = 'CLEAN' THEN v_version.id
        ELSE current_version_id
      END,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_document.id
    AND organisation_id = v_job.organisation_id
  RETURNING request_item_id, status
    INTO v_request_item_id, v_document_status;

  IF v_effective_result = 'CLEAN' AND v_request_item_id IS NOT NULL THEN
    UPDATE public.document_request_items
    SET status = 'RECEIVED', status_reason = NULL, updated_at = pg_catalog.now()
    WHERE id = v_request_item_id
      AND organisation_id = v_job.organisation_id
    RETURNING request_id INTO v_request_id;

    UPDATE public.document_requests AS request_record
    SET status = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM public.document_request_items AS item
            WHERE item.request_id = request_record.id
              AND item.organisation_id = request_record.organisation_id
              AND item.is_required = true
              AND item.status NOT IN ('RECEIVED', 'ACCEPTED', 'WAIVED')
          ) THEN 'COMPLETED'::public.document_request_status
          ELSE 'PARTIALLY_RECEIVED'::public.document_request_status
        END,
        completed_at = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM public.document_request_items AS item
            WHERE item.request_id = request_record.id
              AND item.organisation_id = request_record.organisation_id
              AND item.is_required = true
              AND item.status NOT IN ('RECEIVED', 'ACCEPTED', 'WAIVED')
          ) THEN pg_catalog.now()
          ELSE NULL
        END,
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE request_record.id = v_request_id
      AND request_record.organisation_id = v_job.organisation_id
      AND request_record.status IN ('SENT', 'PARTIALLY_RECEIVED');
  END IF;

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id, actor_type, actor_identifier
  )
  VALUES (
    v_job.organisation_id,
    v_job.matter_id,
    CASE
      WHEN v_effective_result = 'CLEAN' THEN 'DOCUMENT_AVAILABLE'
      ELSE 'DOCUMENT_QUARANTINED'
    END,
    'DOCUMENT',
    v_job.document_id,
    CASE
      WHEN v_effective_result = 'CLEAN'
        THEN 'Document passed malware scanning and is available.'
      WHEN v_effective_result = 'INFECTED'
        THEN 'Document was quarantined after malware was detected.'
      ELSE 'Document was quarantined after an integrity or scanner failure.'
    END,
    pg_catalog.jsonb_build_object(
      'versionId', v_job.version_id,
      'scanStatus', v_effective_result::text,
      'provider', btrim(p_provider),
      'jobId', v_job.id
    ),
    NULL,
    'SERVICE'::public.audit_actor_type,
    v_actor_identifier
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_identifier,
    source, action, resource_type, resource_id, outcome,
    new_value, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(),
    v_job.organisation_id,
    'SERVICE'::public.audit_actor_type,
    v_actor_identifier,
    'businessos-document-scanner',
    'document.scan.completed',
    'matter_document',
    v_job.document_id::text,
    CASE
      WHEN v_effective_result = 'ERROR' THEN 'FAILURE'::public.audit_outcome
      ELSE 'SUCCESS'::public.audit_outcome
    END,
    pg_catalog.jsonb_build_object(
      'versionId', v_job.version_id,
      'scanStatus', v_effective_result::text,
      'provider', btrim(p_provider),
      'reference', btrim(p_reference)
    ),
    pg_catalog.jsonb_build_object(
      'jobId', v_job.id,
      'hashMatched', p_observed_sha256_hex IS NOT DISTINCT FROM v_version.sha256_hex,
      'engineVersion', left(NULLIF(btrim(p_engine_version), ''), 240),
      'signature', left(NULLIF(btrim(p_signature), ''), 240)
    )
  );

  UPDATE public.document_scan_jobs
  SET status = v_job_status,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = CASE
        WHEN p_observed_sha256_hex IS DISTINCT FROM v_version.sha256_hex
          THEN 'HASH_MISMATCH'
        WHEN v_effective_result = 'ERROR' THEN 'SCANNER_ERROR'
        ELSE NULL
      END,
      last_error_detail = CASE
        WHEN p_observed_sha256_hex IS DISTINCT FROM v_version.sha256_hex
          THEN 'Observed content hash did not match the registered SHA-256.'
        WHEN v_effective_result = 'ERROR'
          THEN 'Scanner returned a terminal error.'
        ELSE NULL
      END,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_job.id;

  DELETE FROM private.document_scan_execution_contexts
  WHERE transaction_id = pg_catalog.txid_current();

  RETURN QUERY
  SELECT v_job_status::text, v_document_status::text, v_effective_result::text;
END
$function$;

CREATE OR REPLACE FUNCTION private.fail_document_scan_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text,
  p_retryable boolean
)
RETURNS TABLE (job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_job public.document_scan_jobs%ROWTYPE;
  v_attempts integer;
BEGIN
  IF p_job_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
    OR p_error_code IS NULL OR btrim(p_error_code) = '' THEN
    RAISE EXCEPTION 'Scanner failure report is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.document_scan_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status <> 'LEASED'
    OR v_job.lease_owner IS DISTINCT FROM btrim(p_worker_id) THEN
    RAISE EXCEPTION 'Scanner lease is no longer valid' USING ERRCODE = '40001';
  END IF;

  v_attempts := v_job.attempts;
  IF COALESCE(p_retryable, false) AND v_attempts < v_job.max_attempts THEN
    UPDATE public.document_scan_jobs
    SET status = 'QUEUED',
        attempts = v_attempts,
        next_attempt_at = pg_catalog.now()
          + pg_catalog.make_interval(
              secs => least(1800, (30 * power(2, greatest(0, v_attempts - 1)))::integer)
            ),
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = left(btrim(p_error_code), 120),
        last_error_detail = left(COALESCE(NULLIF(btrim(p_error_detail), ''), 'Scanner failure.'), 1000),
        updated_at = pg_catalog.now()
    WHERE id = v_job.id;

    RETURN QUERY SELECT 'QUEUED'::text;
    RETURN;
  END IF;

  PERFORM * FROM private.complete_document_scan_job(
    v_job.id,
    p_worker_id,
    'ERROR'::public.document_scan_status,
    'clamav',
    'clamav:' || v_job.id::text || ':failed',
    NULL,
    NULL,
    NULL
  );

  UPDATE public.document_scan_jobs
  SET status = 'DEAD_LETTER',
      attempts = least(v_attempts, max_attempts),
      last_error_code = left(btrim(p_error_code), 120),
      last_error_detail = left(COALESCE(NULLIF(btrim(p_error_detail), ''), 'Scanner failure.'), 1000),
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_job.id;

  RETURN QUERY SELECT 'DEAD_LETTER'::text;
END
$function$;

-- Claims increment attempts up front so worker crashes are counted. Expired
-- final leases are fail-closed instead of remaining stuck forever.
CREATE OR REPLACE FUNCTION private.claim_document_scan_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid,
  organisation_id uuid,
  matter_id uuid,
  document_id uuid,
  version_id uuid,
  storage_bucket text,
  storage_path text,
  expected_sha256_hex text,
  expected_size_bytes bigint,
  content_type text,
  attempt integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_exhausted_job_id uuid;
  v_exhausted_lease_owner text;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' OR length(p_worker_id) > 160
    OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'Scanner lease request is invalid' USING ERRCODE = '22023';
  END IF;

  LOOP
    SELECT job.id, job.lease_owner
      INTO v_exhausted_job_id, v_exhausted_lease_owner
    FROM public.document_scan_jobs AS job
    WHERE job.status = 'LEASED'
      AND job.lease_expires_at <= pg_catalog.now()
      AND job.attempts >= job.max_attempts
    ORDER BY job.lease_expires_at, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    PERFORM * FROM private.fail_document_scan_job(
      v_exhausted_job_id,
      v_exhausted_lease_owner,
      'LEASE_EXPIRED',
      'The scanner lease expired after the final permitted attempt.',
      false
    );
  END LOOP;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.document_scan_jobs AS job
    JOIN public.matter_document_versions AS version_record
      ON version_record.id = job.version_id
     AND version_record.organisation_id = job.organisation_id
    WHERE (
        (job.status = 'QUEUED' AND job.next_attempt_at <= pg_catalog.now())
        OR (job.status = 'LEASED' AND job.lease_expires_at <= pg_catalog.now())
      )
      AND job.attempts < job.max_attempts
      AND version_record.status = 'PENDING_SCAN'
      AND version_record.scan_status = 'PENDING'
    ORDER BY job.next_attempt_at, job.created_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.document_scan_jobs AS job
    SET status = 'LEASED',
        attempts = job.attempts + 1,
        lease_owner = btrim(p_worker_id),
        lease_expires_at = pg_catalog.now()
          + pg_catalog.make_interval(secs => p_lease_seconds),
        lease_count = job.lease_count + 1,
        updated_at = pg_catalog.now()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*
  )
  SELECT
    claimed.id,
    claimed.organisation_id,
    claimed.matter_id,
    claimed.document_id,
    claimed.version_id,
    version_record.storage_bucket::text,
    version_record.storage_path::text,
    version_record.sha256_hex::text,
    version_record.size_bytes,
    version_record.content_type::text,
    claimed.attempts,
    claimed.max_attempts
  FROM claimed
  JOIN public.matter_document_versions AS version_record
    ON version_record.id = claimed.version_id
   AND version_record.organisation_id = claimed.organisation_id;
END
$function$;

ALTER FUNCTION private.claim_document_scan_job(text, integer) OWNER TO postgres;
ALTER FUNCTION private.complete_document_scan_job(
  uuid, text, public.document_scan_status, text, text, text, text, text
) OWNER TO postgres;
ALTER FUNCTION private.fail_document_scan_job(uuid, text, text, text, boolean)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.claim_document_scan_job(text, integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.complete_document_scan_job(
  uuid, text, public.document_scan_status, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.fail_document_scan_job(
  uuid, text, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.claim_document_scan_job(text, integer)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.complete_document_scan_job(
  uuid, text, public.document_scan_status, text, text, text, text, text
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.fail_document_scan_job(
  uuid, text, text, text, boolean
) TO businessos_app;

ALTER TABLE public.document_scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_scan_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_scan_jobs
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader,
       businessos_app, businessos_runtime;

COMMIT;