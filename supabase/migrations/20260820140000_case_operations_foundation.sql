-- BusinessOS Case Operations foundation.
--
-- Adds matter tasks, controlled deadlines, private document metadata/versioning,
-- document requests and an append-only operational timeline. Binary files remain
-- in a private Supabase Storage bucket and are inaccessible until explicitly
-- marked clean by the malware-scanning control plane.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'businessos_app'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'businessos_policy_reader'
  ) THEN
    RAISE EXCEPTION 'BusinessOS database roles are missing';
  END IF;
END
$roles$;

CREATE TYPE public.case_task_status AS ENUM (
  'OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'
);

CREATE TYPE public.case_task_priority AS ENUM (
  'LOW', 'NORMAL', 'HIGH', 'URGENT'
);

CREATE TYPE public.matter_deadline_type AS ENUM (
  'INTERNAL', 'CLIENT', 'STATUTORY', 'COURT', 'TRIBUNAL', 'REGULATORY', 'OTHER'
);

CREATE TYPE public.matter_deadline_status AS ENUM (
  'OPEN', 'SATISFIED', 'MISSED', 'CANCELLED'
);

CREATE TYPE public.document_category AS ENUM (
  'GENERAL', 'IDENTITY', 'FINANCIAL', 'LEGAL', 'EVIDENCE', 'CLIENT_CARE',
  'SUBMISSION', 'DECISION', 'CORRESPONDENCE', 'OTHER'
);

CREATE TYPE public.document_security_classification AS ENUM (
  'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'LEGALLY_PRIVILEGED'
);

CREATE TYPE public.document_status AS ENUM (
  'PENDING_UPLOAD', 'PENDING_SCAN', 'AVAILABLE', 'QUARANTINED',
  'SUPERSEDED', 'ARCHIVED'
);

CREATE TYPE public.document_scan_status AS ENUM (
  'NOT_SCANNED', 'PENDING', 'CLEAN', 'INFECTED', 'ERROR'
);

CREATE TYPE public.document_request_status AS ENUM (
  'DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED', 'EXPIRED'
);

CREATE TYPE public.document_request_item_status AS ENUM (
  'REQUESTED', 'RECEIVED', 'ACCEPTED', 'REJECTED', 'WAIVED'
);

CREATE TABLE public.matter_tasks (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  title varchar(240) NOT NULL,
  description text,
  status public.case_task_status NOT NULL DEFAULT 'OPEN',
  priority public.case_task_priority NOT NULL DEFAULT 'NORMAL',
  assigned_to_user_id uuid,
  due_at timestamptz(6),
  reminder_at timestamptz(6),
  blocked_reason varchar(1000),
  completion_note varchar(2000),
  completed_at timestamptz(6),
  completed_by_user_id uuid,
  cancelled_at timestamptz(6),
  cancelled_by_user_id uuid,
  cancellation_reason varchar(1000),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_matter_tasks PRIMARY KEY (id),
  CONSTRAINT fk_matter_tasks_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_tasks_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_tasks_assigned_to FOREIGN KEY (assigned_to_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matter_tasks_completed_by FOREIGN KEY (completed_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_tasks_cancelled_by FOREIGN KEY (cancelled_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_tasks_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_tasks_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matter_tasks_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_matter_tasks_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_matter_tasks_description CHECK (
    description IS NULL OR char_length(description) BETWEEN 1 AND 10000
  ),
  CONSTRAINT ck_matter_tasks_reminder CHECK (
    reminder_at IS NULL OR due_at IS NULL OR reminder_at <= due_at
  ),
  CONSTRAINT ck_matter_tasks_status_evidence CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL
      AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
    OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL
      AND cancellation_reason IS NOT NULL AND completed_at IS NULL AND completed_by_user_id IS NULL)
    OR
    (status NOT IN ('COMPLETED', 'CANCELLED') AND completed_at IS NULL
      AND completed_by_user_id IS NULL AND cancelled_at IS NULL
      AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
  ),
  CONSTRAINT ck_matter_tasks_blocked_reason CHECK (
    (status = 'BLOCKED' AND blocked_reason IS NOT NULL)
    OR (status <> 'BLOCKED' AND blocked_reason IS NULL)
  ),
  CONSTRAINT ck_matter_tasks_version CHECK (version > 0),
  CONSTRAINT ck_matter_tasks_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.matter_deadlines (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  title varchar(240) NOT NULL,
  description text,
  deadline_type public.matter_deadline_type NOT NULL,
  status public.matter_deadline_status NOT NULL DEFAULT 'OPEN',
  due_at timestamptz(6) NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Europe/London',
  is_critical boolean NOT NULL DEFAULT false,
  owner_user_id uuid,
  source_reference varchar(240),
  satisfied_at timestamptz(6),
  satisfied_by_user_id uuid,
  satisfaction_note varchar(2000),
  missed_at timestamptz(6),
  missed_reason varchar(1000),
  cancelled_at timestamptz(6),
  cancelled_by_user_id uuid,
  cancellation_reason varchar(1000),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_matter_deadlines PRIMARY KEY (id),
  CONSTRAINT fk_matter_deadlines_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_deadlines_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_deadlines_owner FOREIGN KEY (owner_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matter_deadlines_satisfied_by FOREIGN KEY (satisfied_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_deadlines_cancelled_by FOREIGN KEY (cancelled_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_deadlines_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_deadlines_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matter_deadlines_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_matter_deadlines_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_matter_deadlines_timezone CHECK (
    timezone = btrim(timezone) AND char_length(timezone) BETWEEN 1 AND 64
  ),
  CONSTRAINT ck_matter_deadlines_status_evidence CHECK (
    (status = 'SATISFIED' AND satisfied_at IS NOT NULL AND satisfied_by_user_id IS NOT NULL
      AND satisfaction_note IS NOT NULL AND missed_at IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'MISSED' AND missed_at IS NOT NULL AND missed_reason IS NOT NULL
      AND satisfied_at IS NULL AND satisfied_by_user_id IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL
      AND cancellation_reason IS NOT NULL AND satisfied_at IS NULL AND missed_at IS NULL)
    OR
    (status = 'OPEN' AND satisfied_at IS NULL AND satisfied_by_user_id IS NULL
      AND satisfaction_note IS NULL AND missed_at IS NULL AND missed_reason IS NULL
      AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
  ),
  CONSTRAINT ck_matter_deadlines_version CHECK (version > 0),
  CONSTRAINT ck_matter_deadlines_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.document_requests (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  recipient_client_id uuid,
  title varchar(240) NOT NULL,
  message text,
  status public.document_request_status NOT NULL DEFAULT 'DRAFT',
  due_at timestamptz(6),
  sent_at timestamptz(6),
  sent_by_user_id uuid,
  completed_at timestamptz(6),
  cancelled_at timestamptz(6),
  cancelled_by_user_id uuid,
  status_reason varchar(1000),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_document_requests PRIMARY KEY (id),
  CONSTRAINT fk_document_requests_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_requests_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_requests_client FOREIGN KEY (recipient_client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_requests_sent_by FOREIGN KEY (sent_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_requests_cancelled_by FOREIGN KEY (cancelled_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_requests_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_requests_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_document_requests_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_document_requests_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_document_requests_status_evidence CHECK (
    (status = 'DRAFT' AND sent_at IS NULL AND sent_by_user_id IS NULL
      AND completed_at IS NULL AND cancelled_at IS NULL)
    OR
    (status IN ('SENT', 'PARTIALLY_RECEIVED', 'EXPIRED')
      AND sent_at IS NOT NULL AND sent_by_user_id IS NOT NULL
      AND completed_at IS NULL AND cancelled_at IS NULL)
    OR
    (status = 'COMPLETED' AND sent_at IS NOT NULL AND sent_by_user_id IS NOT NULL
      AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL
      AND cancelled_by_user_id IS NOT NULL AND status_reason IS NOT NULL)
  ),
  CONSTRAINT ck_document_requests_version CHECK (version > 0),
  CONSTRAINT ck_document_requests_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.document_request_items (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  category public.document_category NOT NULL,
  title varchar(240) NOT NULL,
  description text,
  is_required boolean NOT NULL DEFAULT true,
  status public.document_request_item_status NOT NULL DEFAULT 'REQUESTED',
  status_reason varchar(1000),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_document_request_items PRIMARY KEY (id),
  CONSTRAINT fk_document_request_items_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_document_request_items_request FOREIGN KEY (request_id, organisation_id)
    REFERENCES public.document_requests (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_document_request_items_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_document_request_items_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_document_request_items_reason CHECK (
    (status IN ('REJECTED', 'WAIVED') AND status_reason IS NOT NULL)
    OR (status NOT IN ('REJECTED', 'WAIVED'))
  ),
  CONSTRAINT ck_document_request_items_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.matter_documents (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  request_item_id uuid,
  title varchar(240) NOT NULL,
  category public.document_category NOT NULL,
  security_classification public.document_security_classification NOT NULL DEFAULT 'CONFIDENTIAL',
  status public.document_status NOT NULL DEFAULT 'PENDING_UPLOAD',
  client_visible boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  retention_review_at timestamptz(6),
  archived_at timestamptz(6),
  archive_reason varchar(1000),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_matter_documents PRIMARY KEY (id),
  CONSTRAINT fk_matter_documents_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_documents_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_documents_request_item FOREIGN KEY (request_item_id, organisation_id)
    REFERENCES public.document_request_items (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_documents_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_documents_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matter_documents_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_matter_documents_current_version_org UNIQUE (current_version_id, organisation_id),
  CONSTRAINT ck_matter_documents_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_matter_documents_archive CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL AND archive_reason IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL AND archive_reason IS NULL)
  ),
  CONSTRAINT ck_matter_documents_version CHECK (version > 0),
  CONSTRAINT ck_matter_documents_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.matter_document_versions (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_number integer NOT NULL,
  original_file_name varchar(255) NOT NULL,
  content_type varchar(160) NOT NULL,
  size_bytes bigint NOT NULL,
  sha256_hex char(64) NOT NULL,
  storage_bucket varchar(100) NOT NULL DEFAULT 'businessos-documents',
  storage_path varchar(800) NOT NULL,
  status public.document_status NOT NULL DEFAULT 'PENDING_UPLOAD',
  scan_status public.document_scan_status NOT NULL DEFAULT 'NOT_SCANNED',
  scan_provider varchar(120),
  scan_reference varchar(240),
  scan_completed_at timestamptz(6),
  uploaded_by_user_id uuid NOT NULL,
  uploaded_at timestamptz(6),
  superseded_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_matter_document_versions PRIMARY KEY (id),
  CONSTRAINT fk_matter_document_versions_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_document_versions_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_document_versions_document FOREIGN KEY (document_id, organisation_id)
    REFERENCES public.matter_documents (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_document_versions_uploaded_by FOREIGN KEY (uploaded_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matter_document_versions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_matter_document_versions_document_version UNIQUE (document_id, version_number),
  CONSTRAINT uq_matter_document_versions_bucket_path UNIQUE (storage_bucket, storage_path),
  CONSTRAINT ck_matter_document_versions_version CHECK (version_number > 0),
  CONSTRAINT ck_matter_document_versions_size CHECK (size_bytes BETWEEN 1 AND 52428800),
  CONSTRAINT ck_matter_document_versions_hash CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_matter_document_versions_file_name CHECK (
    original_file_name = btrim(original_file_name)
    AND char_length(original_file_name) BETWEEN 1 AND 255
    AND original_file_name !~ '[\\/[:cntrl:]]'
  ),
  CONSTRAINT ck_matter_document_versions_content_type CHECK (
    content_type = lower(btrim(content_type))
    AND content_type IN (
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  ),
  CONSTRAINT ck_matter_document_versions_storage CHECK (
    storage_bucket = 'businessos-documents'
    AND storage_path = organisation_id::text || '/' || matter_id::text || '/'
      || document_id::text || '/' || id::text || '/object'
  ),
  CONSTRAINT ck_matter_document_versions_status_scan CHECK (
    (status = 'PENDING_UPLOAD' AND scan_status = 'NOT_SCANNED' AND uploaded_at IS NULL)
    OR (status = 'PENDING_SCAN' AND scan_status = 'PENDING' AND uploaded_at IS NOT NULL)
    OR (status = 'AVAILABLE' AND scan_status = 'CLEAN' AND scan_completed_at IS NOT NULL)
    OR (status = 'QUARANTINED' AND scan_status IN ('INFECTED', 'ERROR') AND scan_completed_at IS NOT NULL)
    OR (status = 'SUPERSEDED' AND scan_status = 'CLEAN' AND superseded_at IS NOT NULL)
    OR (status = 'ARCHIVED' AND scan_status = 'CLEAN')
  ),
  CONSTRAINT ck_matter_document_versions_scan_metadata CHECK (
    (scan_status IN ('CLEAN', 'INFECTED', 'ERROR')
      AND scan_provider IS NOT NULL AND scan_reference IS NOT NULL
      AND scan_completed_at IS NOT NULL)
    OR (scan_status IN ('NOT_SCANNED', 'PENDING')
      AND scan_provider IS NULL AND scan_reference IS NULL AND scan_completed_at IS NULL)
  ),
  CONSTRAINT ck_matter_document_versions_lifecycle CHECK (updated_at >= created_at)
);

ALTER TABLE public.matter_documents
  ADD CONSTRAINT fk_matter_documents_current_version
  FOREIGN KEY (current_version_id, organisation_id)
  REFERENCES public.matter_document_versions (id, organisation_id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE public.matter_timeline_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  event_type varchar(80) NOT NULL,
  source_type varchar(80) NOT NULL,
  source_id uuid,
  summary varchar(500) NOT NULL,
  details jsonb,
  actor_user_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_matter_timeline_events PRIMARY KEY (id),
  CONSTRAINT fk_matter_timeline_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_timeline_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_timeline_actor FOREIGN KEY (actor_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_matter_timeline_event_type CHECK (
    event_type = upper(event_type) AND event_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  CONSTRAINT ck_matter_timeline_source_type CHECK (
    source_type = upper(source_type) AND source_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  CONSTRAINT ck_matter_timeline_summary CHECK (
    summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 500
  ),
  CONSTRAINT ck_matter_timeline_details CHECK (
    details IS NULL OR jsonb_typeof(details) = 'object'
  ),
  CONSTRAINT ck_matter_timeline_occurred CHECK (created_at >= occurred_at)
);

CREATE INDEX ix_matter_tasks_org_matter_status_due
  ON public.matter_tasks (organisation_id, matter_id, status, due_at);
CREATE INDEX ix_matter_tasks_org_assignee_status_due
  ON public.matter_tasks (organisation_id, assigned_to_user_id, status, due_at);
CREATE INDEX ix_matter_deadlines_org_matter_status_due
  ON public.matter_deadlines (organisation_id, matter_id, status, due_at);
CREATE INDEX ix_matter_deadlines_org_open_due
  ON public.matter_deadlines (organisation_id, due_at)
  WHERE status = 'OPEN' AND deleted_at IS NULL;
CREATE INDEX ix_document_requests_org_matter_status_due
  ON public.document_requests (organisation_id, matter_id, status, due_at);
CREATE INDEX ix_document_request_items_org_request_status
  ON public.document_request_items (organisation_id, request_id, status);
CREATE INDEX ix_matter_documents_org_matter_status_created
  ON public.matter_documents (organisation_id, matter_id, status, created_at DESC);
CREATE INDEX ix_matter_documents_org_request_item
  ON public.matter_documents (organisation_id, request_item_id)
  WHERE request_item_id IS NOT NULL;
CREATE INDEX ix_matter_document_versions_org_document_created
  ON public.matter_document_versions (organisation_id, document_id, version_number DESC);
CREATE INDEX ix_matter_document_versions_pending_scan
  ON public.matter_document_versions (organisation_id, created_at)
  WHERE status = 'PENDING_SCAN';
CREATE INDEX ix_matter_timeline_org_matter_occurred
  ON public.matter_timeline_events (organisation_id, matter_id, occurred_at DESC, id DESC);

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'businessos-documents',
  'businessos-documents',
  false,
  52428800,
  ARRAY[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'text/plain', 'text/csv', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

GRANT SELECT ON public.matter_tasks, public.matter_deadlines,
  public.document_requests, public.document_request_items,
  public.matter_documents, public.matter_document_versions,
  public.matter_timeline_events
TO businessos_policy_reader;

-- The narrow policy-reader role receives CREATE only while security-definer
-- helpers are transferred to it. The privilege is revoked before commit.
GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.auth_user_has_organisation_permission(
  p_organisation_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id IS NOT NULL
    AND p_permission_key IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organisation_memberships AS membership
      JOIN public.user_profiles AS profile
        ON profile.id = membership.user_profile_id
      JOIN public.role_assignments AS assignment
        ON assignment.organisation_membership_id = membership.id
       AND assignment.organisation_id = membership.organisation_id
      JOIN public.roles AS role_record
        ON role_record.id = assignment.role_id
       AND role_record.organisation_id = membership.organisation_id
      JOIN public.role_permissions AS role_permission
        ON role_permission.role_id = role_record.id
      JOIN public.permissions AS permission
        ON permission.id = role_permission.permission_id
      WHERE membership.organisation_id = p_organisation_id
        AND membership.user_profile_id = auth.uid()
        AND membership.status = 'ACTIVE'
        AND membership.deleted_at IS NULL
        AND profile.status = 'ACTIVE'
        AND profile.deleted_at IS NULL
        AND assignment.revoked_at IS NULL
        AND assignment.deleted_at IS NULL
        AND assignment.valid_from <= pg_catalog.now()
        AND (assignment.valid_until IS NULL OR assignment.valid_until > pg_catalog.now())
        AND role_record.deleted_at IS NULL
        AND permission.key = p_permission_key
        AND permission.is_active = true
        AND permission.deleted_at IS NULL
        AND (
          NOT permission.requires_mfa
          OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        )
    )
$function$;

CREATE OR REPLACE FUNCTION private.auth_user_can_read_matter(
  p_organisation_id uuid,
  p_matter_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matters AS matter
    WHERE matter.id = p_matter_id
      AND matter.organisation_id = p_organisation_id
      AND matter.deleted_at IS NULL
      AND (
        private.auth_user_has_organisation_permission(
          p_organisation_id, 'matters.read_all'
        )
        OR (
          private.auth_user_has_organisation_permission(
            p_organisation_id, 'matters.read'
          )
          AND (
            matter.assigned_to_user_id = auth.uid()
            OR matter.supervisor_user_id = auth.uid()
            OR matter.created_by_user_id = auth.uid()
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.auth_user_can_upload_document_object(
  p_storage_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matter_document_versions AS version_record
    JOIN public.matter_documents AS document_record
      ON document_record.id = version_record.document_id
     AND document_record.organisation_id = version_record.organisation_id
    WHERE version_record.storage_bucket = 'businessos-documents'
      AND version_record.storage_path = p_storage_path
      AND version_record.status = 'PENDING_UPLOAD'
      AND version_record.scan_status = 'NOT_SCANNED'
      AND version_record.uploaded_by_user_id = auth.uid()
      AND document_record.status IN ('PENDING_UPLOAD', 'AVAILABLE')
      AND document_record.deleted_at IS NULL
      AND private.auth_user_has_organisation_permission(
        version_record.organisation_id, 'documents.upload'
      )
      AND private.auth_user_can_read_matter(
        version_record.organisation_id, version_record.matter_id
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.auth_user_can_read_document_object(
  p_storage_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matter_document_versions AS version_record
    JOIN public.matter_documents AS document_record
      ON document_record.id = version_record.document_id
     AND document_record.organisation_id = version_record.organisation_id
    WHERE version_record.storage_bucket = 'businessos-documents'
      AND version_record.storage_path = p_storage_path
      AND version_record.status = 'AVAILABLE'
      AND version_record.scan_status = 'CLEAN'
      AND document_record.current_version_id = version_record.id
      AND document_record.status = 'AVAILABLE'
      AND document_record.deleted_at IS NULL
      AND private.auth_user_has_organisation_permission(
        version_record.organisation_id, 'documents.read'
      )
      AND private.auth_user_can_read_matter(
        version_record.organisation_id, version_record.matter_id
      )
      AND (
        document_record.security_classification <> 'RESTRICTED'
        OR private.auth_user_has_organisation_permission(
          version_record.organisation_id, 'documents.restricted.read'
        )
      )
      AND (
        document_record.security_classification <> 'LEGALLY_PRIVILEGED'
        OR private.auth_user_has_organisation_permission(
          version_record.organisation_id, 'documents.privileged.read'
        )
      )
  )
$function$;

ALTER FUNCTION private.auth_user_has_organisation_permission(uuid, text)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.auth_user_can_read_matter(uuid, uuid)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.auth_user_can_upload_document_object(text)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.auth_user_can_read_document_object(text)
  OWNER TO businessos_policy_reader;

REVOKE ALL ON FUNCTION private.auth_user_has_organisation_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_user_can_read_matter(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_user_can_upload_document_object(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_user_can_read_document_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.auth_user_can_upload_document_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_user_can_read_document_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.validate_case_operation_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_actor_id uuid;
BEGIN
  IF v_user_id IS NULL OR private.current_organisation_id() IS DISTINCT FROM NEW.organisation_id THEN
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
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'version must increment exactly once'
      USING ERRCODE = '40001';
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

CREATE OR REPLACE FUNCTION private.reject_case_operation_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$function$;

ALTER FUNCTION private.validate_case_operation_actor() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_case_operation_row() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.reject_case_operation_ledger_mutation() OWNER TO businessos_policy_reader;

REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.validate_case_operation_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_case_operation_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reject_case_operation_ledger_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.finalise_matter_document_upload(
  p_document_id uuid,
  p_version_id uuid
)
RETURNS TABLE (
  document_id uuid,
  version_id uuid,
  document_status text,
  scan_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org_id uuid := private.current_organisation_id();
  v_user_id uuid := private.current_user_id();
  v_version public.matter_document_versions%ROWTYPE;
  v_found boolean;
BEGIN
  IF v_org_id IS NULL OR v_user_id IS NULL
    OR NOT private.has_organisation_permission(v_org_id, 'documents.upload') THEN
    RAISE EXCEPTION 'Document upload finalisation is not permitted'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_version
  FROM public.matter_document_versions AS version_record
  WHERE version_record.id = p_version_id
    AND version_record.document_id = p_document_id
    AND version_record.organisation_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document upload was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_version.status <> 'PENDING_UPLOAD'
    OR v_version.scan_status <> 'NOT_SCANNED'
    OR v_version.uploaded_by_user_id <> v_user_id THEN
    RAISE EXCEPTION 'Document upload cannot be finalised in its current state'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM storage.objects AS object_record
    WHERE object_record.bucket_id = v_version.storage_bucket
      AND object_record.name = v_version.storage_path
      AND COALESCE((object_record.metadata ->> 'size')::bigint, -1) = v_version.size_bytes
      AND lower(COALESCE(object_record.metadata ->> 'mimetype', '')) = v_version.content_type
  ) INTO v_found;

  IF NOT v_found THEN
    RAISE EXCEPTION 'Stored object metadata does not match the registered upload'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.matter_document_versions
  SET status = 'PENDING_SCAN',
      scan_status = 'PENDING',
      uploaded_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = v_version.id;

  UPDATE public.matter_documents
  SET status = CASE
        WHEN current_version_id IS NULL THEN 'PENDING_SCAN'::public.document_status
        ELSE status
      END,
      updated_by_user_id = v_user_id,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = p_document_id
    AND organisation_id = v_org_id
    AND status = 'PENDING_UPLOAD';

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id
  )
  VALUES (
    v_org_id, v_version.matter_id, 'DOCUMENT_UPLOADED', 'DOCUMENT', p_document_id,
    'Document uploaded and isolated pending malware scan.',
    jsonb_build_object('versionId', p_version_id, 'scanStatus', 'PENDING'),
    v_user_id
  );

  RETURN QUERY
  SELECT
    p_document_id,
    p_version_id,
    document_record.status::text,
    'PENDING'::text
  FROM public.matter_documents AS document_record
  WHERE document_record.id = p_document_id
    AND document_record.organisation_id = v_org_id;
END
$function$;

ALTER FUNCTION private.finalise_matter_document_upload(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalise_matter_document_upload(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
GRANT EXECUTE ON FUNCTION private.finalise_matter_document_upload(uuid, uuid)
  TO businessos_app;

CREATE OR REPLACE FUNCTION private.record_matter_document_scan_result(
  p_document_id uuid,
  p_version_id uuid,
  p_result public.document_scan_status,
  p_provider text,
  p_reference text,
  p_sha256_hex text
)
RETURNS TABLE (
  document_id uuid,
  version_id uuid,
  document_status text,
  scan_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org_id uuid := private.current_organisation_id();
  v_user_id uuid := private.current_user_id();
  v_version public.matter_document_versions%ROWTYPE;
  v_request_item_id uuid;
  v_request_id uuid;
  v_document_status public.document_status;
  v_version_status public.document_status;
BEGIN
  IF v_org_id IS NULL OR v_user_id IS NULL
    OR NOT private.has_organisation_permission(v_org_id, 'documents.scan.manage') THEN
    RAISE EXCEPTION 'Document scan result recording is not permitted'
      USING ERRCODE = '42501';
  END IF;

  IF p_result NOT IN ('CLEAN', 'INFECTED', 'ERROR')
    OR p_provider IS NULL OR btrim(p_provider) = ''
    OR p_reference IS NULL OR btrim(p_reference) = ''
    OR p_sha256_hex IS NULL OR p_sha256_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A terminal scan result, provider, reference and SHA-256 are required'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_version
  FROM public.matter_document_versions AS version_record
  WHERE version_record.id = p_version_id
    AND version_record.document_id = p_document_id
    AND version_record.organisation_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_version.status <> 'PENDING_SCAN' OR v_version.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Document version is not awaiting a scan result'
      USING ERRCODE = '23514';
  END IF;

  IF v_version.sha256_hex <> p_sha256_hex THEN
    RAISE EXCEPTION 'Scanner SHA-256 does not match the registered document hash'
      USING ERRCODE = '23514';
  END IF;

  v_version_status := CASE WHEN p_result = 'CLEAN' THEN 'AVAILABLE' ELSE 'QUARANTINED' END;

  IF p_result = 'CLEAN' THEN
    UPDATE public.matter_document_versions AS prior_version
    SET status = 'SUPERSEDED',
        superseded_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    FROM public.matter_documents AS document_record
    WHERE document_record.id = p_document_id
      AND document_record.current_version_id = prior_version.id
      AND prior_version.id <> p_version_id
      AND prior_version.status = 'AVAILABLE';
  END IF;

  UPDATE public.matter_document_versions
  SET status = v_version_status,
      scan_status = p_result,
      scan_provider = btrim(p_provider),
      scan_reference = btrim(p_reference),
      scan_completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_version_id;

  UPDATE public.matter_documents
  SET status = CASE
        WHEN p_result = 'CLEAN' THEN 'AVAILABLE'::public.document_status
        WHEN current_version_id IS NULL THEN 'QUARANTINED'::public.document_status
        ELSE status
      END,
      current_version_id = CASE WHEN p_result = 'CLEAN' THEN p_version_id ELSE current_version_id END,
      updated_by_user_id = v_user_id,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = p_document_id
    AND organisation_id = v_org_id
  RETURNING request_item_id, status
    INTO v_request_item_id, v_document_status;

  IF p_result = 'CLEAN' AND v_request_item_id IS NOT NULL THEN
    UPDATE public.document_request_items
    SET status = 'RECEIVED', status_reason = NULL, updated_at = pg_catalog.now()
    WHERE id = v_request_item_id AND organisation_id = v_org_id
    RETURNING request_id INTO v_request_id;

    UPDATE public.document_requests AS request_record
    SET status = CASE
          WHEN NOT EXISTS (
            SELECT 1
            FROM public.document_request_items AS item
            WHERE item.request_id = request_record.id
              AND item.organisation_id = request_record.organisation_id
              AND item.is_required = true
              AND item.status NOT IN ('RECEIVED', 'ACCEPTED', 'WAIVED')
          ) THEN 'COMPLETED'::public.document_request_status
          ELSE 'PARTIALLY_RECEIVED'::public.document_request_status
        END,
        completed_at = CASE
          WHEN NOT EXISTS (
            SELECT 1
            FROM public.document_request_items AS item
            WHERE item.request_id = request_record.id
              AND item.organisation_id = request_record.organisation_id
              AND item.is_required = true
              AND item.status NOT IN ('RECEIVED', 'ACCEPTED', 'WAIVED')
          ) THEN pg_catalog.now()
          ELSE NULL
        END,
        updated_by_user_id = v_user_id,
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE request_record.id = v_request_id
      AND request_record.organisation_id = v_org_id
      AND request_record.status IN ('SENT', 'PARTIALLY_RECEIVED');
  END IF;

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id
  )
  VALUES (
    v_org_id,
    v_version.matter_id,
    CASE WHEN p_result = 'CLEAN' THEN 'DOCUMENT_AVAILABLE' ELSE 'DOCUMENT_QUARANTINED' END,
    'DOCUMENT',
    p_document_id,
    CASE
      WHEN p_result = 'CLEAN' THEN 'Document passed malware scanning and is available.'
      ELSE 'Document was quarantined following malware scanning.'
    END,
    jsonb_build_object('versionId', p_version_id, 'scanStatus', p_result::text),
    v_user_id
  );

  RETURN QUERY SELECT p_document_id, p_version_id, v_document_status::text, p_result::text;
END
$function$;

ALTER FUNCTION private.record_matter_document_scan_result(
  uuid, uuid, public.document_scan_status, text, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.record_matter_document_scan_result(
  uuid, uuid, public.document_scan_status, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
GRANT EXECUTE ON FUNCTION private.record_matter_document_scan_result(
  uuid, uuid, public.document_scan_status, text, text, text
) TO businessos_app;

CREATE TRIGGER matter_tasks_immutable
  BEFORE UPDATE ON public.matter_tasks
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'created_by_user_id', 'created_at', 'deleted_at'
  );
CREATE TRIGGER matter_tasks_validate
  BEFORE INSERT OR UPDATE ON public.matter_tasks
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_operation_row();

CREATE TRIGGER matter_deadlines_immutable
  BEFORE UPDATE ON public.matter_deadlines
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'created_by_user_id', 'created_at', 'deleted_at'
  );
CREATE TRIGGER matter_deadlines_validate
  BEFORE INSERT OR UPDATE ON public.matter_deadlines
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_operation_row();

CREATE TRIGGER document_requests_immutable
  BEFORE UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'created_by_user_id', 'created_at', 'deleted_at'
  );
CREATE TRIGGER document_requests_validate
  BEFORE INSERT OR UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_operation_row();

CREATE TRIGGER matter_documents_immutable
  BEFORE UPDATE ON public.matter_documents
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'request_item_id',
    'created_by_user_id', 'created_at', 'deleted_at'
  );
CREATE TRIGGER matter_documents_validate_actor
  BEFORE INSERT OR UPDATE ON public.matter_documents
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_operation_actor();

CREATE TRIGGER matter_document_versions_validate_actor
  BEFORE INSERT ON public.matter_document_versions
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_operation_actor();
CREATE TRIGGER matter_document_versions_immutable_identity
  BEFORE UPDATE ON public.matter_document_versions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'document_id', 'version_number',
    'original_file_name', 'content_type', 'size_bytes', 'sha256_hex',
    'storage_bucket', 'storage_path', 'uploaded_by_user_id', 'created_at'
  );

CREATE TRIGGER matter_timeline_validate_actor
  BEFORE INSERT ON public.matter_timeline_events
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_operation_actor();
CREATE TRIGGER matter_timeline_append_only
  BEFORE UPDATE OR DELETE ON public.matter_timeline_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_case_operation_ledger_mutation();

WITH permission_seed (
  permission_key, permission_name, permission_description,
  resource_name, action_name, is_sensitive, requires_mfa
) AS (
  VALUES
    ('tasks.read', 'View matter tasks', 'View tasks for authorised matters.', 'tasks', 'read', true, false),
    ('tasks.create', 'Create matter tasks', 'Create controlled tasks for authorised matters.', 'tasks', 'create', true, false),
    ('tasks.update', 'Update matter tasks', 'Update controlled tasks for authorised matters.', 'tasks', 'update', true, false),
    ('tasks.assign', 'Assign matter tasks', 'Assign matter tasks to active organisation workers.', 'tasks', 'assign', true, false),
    ('tasks.complete', 'Complete or cancel matter tasks', 'Record task completion, cancellation or blocking evidence.', 'tasks', 'complete', true, false),
    ('deadlines.read', 'View matter deadlines', 'View internal and external deadlines for authorised matters.', 'deadlines', 'read', true, false),
    ('deadlines.create', 'Create matter deadlines', 'Create controlled internal, statutory or regulatory deadlines.', 'deadlines', 'create', true, false),
    ('deadlines.update', 'Update matter deadlines', 'Update open matter deadline information.', 'deadlines', 'update', true, false),
    ('deadlines.assign', 'Assign matter deadlines', 'Assign deadline ownership to active organisation workers.', 'deadlines', 'assign', true, false),
    ('deadlines.manage', 'Resolve critical deadlines', 'Satisfy, miss or cancel matter deadlines with evidence.', 'deadlines', 'manage', true, true),
    ('documents.read', 'View matter documents', 'View available clean documents for authorised matters.', 'documents', 'read', true, false),
    ('documents.upload', 'Upload matter documents', 'Register and upload documents into the quarantined private vault.', 'documents', 'upload', true, true),
    ('documents.classification.manage', 'Manage document classification', 'Manage document category, visibility and security classification.', 'documents', 'classification_manage', true, true),
    ('documents.restricted.read', 'View restricted documents', 'View documents classified as restricted.', 'documents', 'restricted_read', true, true),
    ('documents.privileged.read', 'View legally privileged documents', 'View documents classified as legally privileged.', 'documents', 'privileged_read', true, true),
    ('documents.scan.manage', 'Record malware scan results', 'Record trusted malware scan outcomes and release or quarantine files.', 'documents', 'scan_manage', true, true),
    ('documents.archive', 'Archive documents', 'Archive document records under controlled retention procedures.', 'documents', 'archive', true, true),
    ('document_requests.read', 'View document requests', 'View document requests for authorised matters.', 'document_requests', 'read', true, false),
    ('document_requests.create', 'Create document requests', 'Create structured client document requests.', 'document_requests', 'create', true, false),
    ('document_requests.send', 'Issue document requests', 'Issue prepared document requests to authorised recipients.', 'document_requests', 'send', true, false),
    ('document_requests.manage', 'Manage document requests', 'Complete, expire or cancel document requests with evidence.', 'document_requests', 'manage', true, false),
    ('matter_timeline.read', 'View matter timeline', 'View the append-only operational timeline for authorised matters.', 'matter_timeline', 'read', true, false)
)
INSERT INTO public.permissions (
  id, key, name, description, resource, action, data_scope,
  is_sensitive, requires_mfa, allows_ai_use, is_active,
  metadata, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), permission_key, permission_name,
  permission_description, resource_name, action_name,
  'ORGANISATION'::public.permission_data_scope,
  is_sensitive, requires_mfa, false, true,
  jsonb_build_object(
    'classification', 'personal-confidential',
    'contains_pii', true,
    'ai_default', 'deny'
  ),
  pg_catalog.now(), pg_catalog.now()
FROM permission_seed
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  data_scope = EXCLUDED.data_scope,
  is_sensitive = EXCLUDED.is_sensitive,
  requires_mfa = EXCLUDED.requires_mfa,
  allows_ai_use = false,
  is_active = true,
  metadata = EXCLUDED.metadata,
  deleted_at = NULL,
  updated_at = pg_catalog.now();

INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT
  pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN ('organisation_owner', 'system_administrator')
  AND role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.resource IN (
    'tasks', 'deadlines', 'documents', 'document_requests', 'matter_timeline'
  )
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('case_manager', 'tasks.read'),
    ('case_manager', 'tasks.create'),
    ('case_manager', 'tasks.update'),
    ('case_manager', 'tasks.assign'),
    ('case_manager', 'tasks.complete'),
    ('case_manager', 'deadlines.read'),
    ('case_manager', 'deadlines.create'),
    ('case_manager', 'deadlines.update'),
    ('case_manager', 'deadlines.assign'),
    ('case_manager', 'deadlines.manage'),
    ('case_manager', 'documents.read'),
    ('case_manager', 'documents.upload'),
    ('case_manager', 'documents.classification.manage'),
    ('case_manager', 'documents.restricted.read'),
    ('case_manager', 'documents.archive'),
    ('case_manager', 'document_requests.read'),
    ('case_manager', 'document_requests.create'),
    ('case_manager', 'document_requests.send'),
    ('case_manager', 'document_requests.manage'),
    ('case_manager', 'matter_timeline.read'),
    ('case_worker', 'tasks.read'),
    ('case_worker', 'tasks.create'),
    ('case_worker', 'tasks.update'),
    ('case_worker', 'tasks.complete'),
    ('case_worker', 'deadlines.read'),
    ('case_worker', 'deadlines.create'),
    ('case_worker', 'deadlines.update'),
    ('case_worker', 'documents.read'),
    ('case_worker', 'documents.upload'),
    ('case_worker', 'document_requests.read'),
    ('case_worker', 'document_requests.create'),
    ('case_worker', 'document_requests.send'),
    ('case_worker', 'matter_timeline.read'),
    ('solicitor', 'tasks.read'),
    ('solicitor', 'tasks.create'),
    ('solicitor', 'tasks.update'),
    ('solicitor', 'tasks.assign'),
    ('solicitor', 'tasks.complete'),
    ('solicitor', 'deadlines.read'),
    ('solicitor', 'deadlines.create'),
    ('solicitor', 'deadlines.update'),
    ('solicitor', 'deadlines.assign'),
    ('solicitor', 'deadlines.manage'),
    ('solicitor', 'documents.read'),
    ('solicitor', 'documents.upload'),
    ('solicitor', 'documents.classification.manage'),
    ('solicitor', 'documents.restricted.read'),
    ('solicitor', 'documents.privileged.read'),
    ('solicitor', 'documents.archive'),
    ('solicitor', 'document_requests.read'),
    ('solicitor', 'document_requests.create'),
    ('solicitor', 'document_requests.send'),
    ('solicitor', 'document_requests.manage'),
    ('solicitor', 'matter_timeline.read'),
    ('compliance_manager', 'tasks.read'),
    ('compliance_manager', 'deadlines.read'),
    ('compliance_manager', 'deadlines.manage'),
    ('compliance_manager', 'documents.read'),
    ('compliance_manager', 'documents.restricted.read'),
    ('compliance_manager', 'documents.privileged.read'),
    ('compliance_manager', 'documents.scan.manage'),
    ('compliance_manager', 'documents.archive'),
    ('compliance_manager', 'document_requests.read'),
    ('compliance_manager', 'document_requests.manage'),
    ('compliance_manager', 'matter_timeline.read'),
    ('read_only', 'tasks.read'),
    ('read_only', 'deadlines.read'),
    ('read_only', 'matter_timeline.read')
)
INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT
  pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM role_permission_seed
JOIN public.roles AS role_record ON role_record.key = role_permission_seed.role_key
JOIN public.permissions AS permission_record ON permission_record.key = role_permission_seed.permission_key
WHERE role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

REVOKE ALL PRIVILEGES ON public.matter_tasks, public.matter_deadlines,
  public.document_requests, public.document_request_items,
  public.matter_documents, public.matter_document_versions,
  public.matter_timeline_events
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON TYPE public.case_task_status, public.case_task_priority,
  public.matter_deadline_type, public.matter_deadline_status,
  public.document_category, public.document_security_classification,
  public.document_status, public.document_scan_status,
  public.document_request_status, public.document_request_item_status
TO businessos_app, businessos_policy_reader;

GRANT SELECT, INSERT, UPDATE ON public.matter_tasks,
  public.matter_deadlines, public.document_requests,
  public.document_request_items, public.matter_documents,
  public.matter_document_versions
TO businessos_app;

GRANT SELECT, INSERT ON public.matter_timeline_events TO businessos_app;

ALTER TABLE public.matter_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_deadlines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_request_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_timeline_events FORCE ROW LEVEL SECURITY;

CREATE POLICY policy_reader_case_tasks ON public.matter_tasks
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_deadlines ON public.matter_deadlines
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_document_requests ON public.document_requests
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_document_request_items ON public.document_request_items
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_matter_documents ON public.matter_documents
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_matter_document_versions ON public.matter_document_versions
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_matter_timeline ON public.matter_timeline_events
  FOR SELECT TO businessos_policy_reader USING (true);

CREATE POLICY matter_tasks_select ON public.matter_tasks
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'tasks.read')
    AND private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY matter_tasks_insert ON public.matter_tasks
  FOR INSERT TO businessos_app
  WITH CHECK (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'tasks.create')
    AND private.can_update_matter(organisation_id, matter_id)
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
    AND (
      assigned_to_user_id IS NULL
      OR assigned_to_user_id = private.current_user_id()
      OR private.has_organisation_permission(organisation_id, 'tasks.assign')
    )
  );
CREATE POLICY matter_tasks_update ON public.matter_tasks
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'tasks.update')
    AND private.can_update_matter(organisation_id, matter_id)
  )
  WITH CHECK (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'tasks.update')
    AND private.can_update_matter(organisation_id, matter_id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY matter_deadlines_select ON public.matter_deadlines
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'deadlines.read')
    AND private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY matter_deadlines_insert ON public.matter_deadlines
  FOR INSERT TO businessos_app
  WITH CHECK (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'deadlines.create')
    AND private.can_update_matter(organisation_id, matter_id)
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
    AND (NOT is_critical OR private.has_organisation_permission(organisation_id, 'deadlines.manage'))
    AND (
      owner_user_id IS NULL
      OR owner_user_id = private.current_user_id()
      OR private.has_organisation_permission(organisation_id, 'deadlines.assign')
    )
  );
CREATE POLICY matter_deadlines_update ON public.matter_deadlines
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND (
      private.has_organisation_permission(organisation_id, 'deadlines.update')
      OR private.has_organisation_permission(organisation_id, 'deadlines.manage')
    )
    AND private.can_update_matter(organisation_id, matter_id)
  )
  WITH CHECK (
    deleted_at IS NULL
    AND (
      private.has_organisation_permission(organisation_id, 'deadlines.update')
      OR private.has_organisation_permission(organisation_id, 'deadlines.manage')
    )
    AND private.can_update_matter(organisation_id, matter_id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY document_requests_select ON public.document_requests
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'document_requests.read')
    AND private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY document_requests_insert ON public.document_requests
  FOR INSERT TO businessos_app
  WITH CHECK (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'document_requests.create')
    AND private.can_update_matter(organisation_id, matter_id)
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
    AND (
      recipient_client_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.matter_parties AS party
        WHERE party.organisation_id = document_requests.organisation_id
          AND party.matter_id = document_requests.matter_id
          AND party.client_id = document_requests.recipient_client_id
          AND party.deleted_at IS NULL
      )
    )
  );
CREATE POLICY document_requests_update ON public.document_requests
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND (
      private.has_organisation_permission(organisation_id, 'document_requests.manage')
      OR private.has_organisation_permission(organisation_id, 'document_requests.send')
    )
    AND private.can_update_matter(organisation_id, matter_id)
    AND (
      private.has_organisation_permission(organisation_id, 'document_requests.manage')
      OR private.has_organisation_permission(organisation_id, 'document_requests.send')
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND private.can_update_matter(organisation_id, matter_id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY document_request_items_select ON public.document_request_items
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'document_requests.read')
    AND EXISTS (
      SELECT 1 FROM public.document_requests AS request_record
      WHERE request_record.id = request_id
        AND request_record.organisation_id = organisation_id
        AND request_record.deleted_at IS NULL
        AND private.can_read_matter(organisation_id, request_record.matter_id)
    )
  );
CREATE POLICY document_request_items_insert ON public.document_request_items
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'document_requests.create')
    AND EXISTS (
      SELECT 1 FROM public.document_requests AS request_record
      WHERE request_record.id = request_id
        AND request_record.organisation_id = organisation_id
        AND request_record.status = 'DRAFT'
        AND request_record.deleted_at IS NULL
        AND private.can_update_matter(organisation_id, request_record.matter_id)
    )
  );
CREATE POLICY document_request_items_update ON public.document_request_items
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'document_requests.manage')
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'document_requests.manage')
  );

CREATE POLICY matter_documents_select ON public.matter_documents
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'documents.read')
    AND private.can_read_matter(organisation_id, matter_id)
    AND (
      security_classification <> 'RESTRICTED'
      OR private.has_organisation_permission(organisation_id, 'documents.restricted.read')
    )
    AND (
      security_classification <> 'LEGALLY_PRIVILEGED'
      OR private.has_organisation_permission(organisation_id, 'documents.privileged.read')
    )
  );
CREATE POLICY matter_documents_insert ON public.matter_documents
  FOR INSERT TO businessos_app
  WITH CHECK (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'documents.upload')
    AND private.can_update_matter(organisation_id, matter_id)
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
    AND (
      request_item_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.document_request_items AS item
        JOIN public.document_requests AS request_record
          ON request_record.id = item.request_id
         AND request_record.organisation_id = item.organisation_id
        WHERE item.id = matter_documents.request_item_id
          AND item.organisation_id = matter_documents.organisation_id
          AND request_record.matter_id = matter_documents.matter_id
          AND request_record.deleted_at IS NULL
          AND item.status IN ('REQUESTED', 'REJECTED')
      )
    )
  );
CREATE POLICY matter_documents_update ON public.matter_documents
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.can_update_matter(organisation_id, matter_id)
    AND (
      private.has_organisation_permission(organisation_id, 'documents.classification.manage')
      OR private.has_organisation_permission(organisation_id, 'documents.scan.manage')
      OR private.has_organisation_permission(organisation_id, 'documents.archive')
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND private.can_update_matter(organisation_id, matter_id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY matter_document_versions_select ON public.matter_document_versions
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'documents.read')
    AND private.can_read_matter(organisation_id, matter_id)
    AND EXISTS (
      SELECT 1
      FROM public.matter_documents AS document_record
      WHERE document_record.id = matter_document_versions.document_id
        AND document_record.organisation_id = matter_document_versions.organisation_id
        AND document_record.deleted_at IS NULL
        AND (
          document_record.security_classification <> 'RESTRICTED'
          OR private.has_organisation_permission(
            matter_document_versions.organisation_id, 'documents.restricted.read'
          )
        )
        AND (
          document_record.security_classification <> 'LEGALLY_PRIVILEGED'
          OR private.has_organisation_permission(
            matter_document_versions.organisation_id, 'documents.privileged.read'
          )
        )
    )
  );
CREATE POLICY matter_document_versions_insert ON public.matter_document_versions
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'documents.upload')
    AND private.can_update_matter(organisation_id, matter_id)
    AND uploaded_by_user_id = private.current_user_id()
    AND EXISTS (
      SELECT 1
      FROM public.matter_documents AS document_record
      WHERE document_record.id = matter_document_versions.document_id
        AND document_record.organisation_id = matter_document_versions.organisation_id
        AND document_record.matter_id = matter_document_versions.matter_id
        AND document_record.status IN ('PENDING_UPLOAD', 'AVAILABLE')
        AND document_record.deleted_at IS NULL
    )
  );
CREATE POLICY matter_document_versions_update ON public.matter_document_versions
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'documents.scan.manage')
    AND private.can_update_matter(organisation_id, matter_id)
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'documents.scan.manage')
    AND private.can_update_matter(organisation_id, matter_id)
  );

CREATE POLICY matter_timeline_select ON public.matter_timeline_events
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'matter_timeline.read')
    AND private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY matter_timeline_insert ON public.matter_timeline_events
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.can_update_matter(organisation_id, matter_id)
    AND actor_user_id = private.current_user_id()
  );

CREATE POLICY businessos_document_object_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'businessos-documents'
  AND private.auth_user_can_upload_document_object(name)
);

CREATE POLICY businessos_document_object_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'businessos-documents'
  AND private.auth_user_can_read_document_object(name)
);

COMMENT ON TABLE public.matter_tasks IS
  'Tenant-isolated matter tasks with controlled assignment, completion evidence and optimistic concurrency.';
COMMENT ON TABLE public.matter_deadlines IS
  'Tenant-isolated internal, statutory and regulatory deadlines with immutable resolution evidence.';
COMMENT ON TABLE public.document_requests IS
  'Structured client document requests and their controlled lifecycle.';
COMMENT ON TABLE public.document_request_items IS
  'Required and optional evidence items associated with a document request.';
COMMENT ON TABLE public.matter_documents IS
  'Logical matter document records; binary objects remain private and fail closed pending malware scanning.';
COMMENT ON TABLE public.matter_document_versions IS
  'Immutable document object identities, hashes, scan evidence and version lifecycle.';
COMMENT ON TABLE public.matter_timeline_events IS
  'Append-only matter operational evidence without raw document contents.';

COMMIT;