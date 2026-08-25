-- Gate N: UK data-protection operations and evidence-backed production release.
--
-- This migration deliberately does not label a deployment "certified". It
-- provides the controls and immutable evidence needed to make an honest release
-- decision after real provider, recovery, accessibility, capacity and
-- independent security exercises have been completed.

BEGIN;

CREATE TYPE public.data_subject_request_type AS ENUM (
  'ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION', 'PORTABILITY',
  'OBJECTION', 'AUTOMATED_DECISION_REVIEW'
);
CREATE TYPE public.data_subject_request_status AS ENUM (
  'RECEIVED', 'IDENTITY_VERIFICATION', 'IN_PROGRESS', 'ON_HOLD',
  'READY_FOR_REVIEW', 'COMPLETED', 'REFUSED', 'WITHDRAWN'
);
CREATE TYPE public.identity_proof_status AS ENUM (
  'NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED'
);
CREATE TYPE public.privacy_incident_severity AS ENUM (
  'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
);
CREATE TYPE public.privacy_incident_status AS ENUM (
  'OPEN', 'CONTAINING', 'INVESTIGATING', 'NOTIFICATION_DECISION',
  'RESOLVED', 'CLOSED'
);
CREATE TYPE public.breach_notification_decision AS ENUM (
  'UNASSESSED', 'NOT_REPORTABLE', 'ICO_REQUIRED', 'ICO_NOTIFIED',
  'SUBJECTS_REQUIRED', 'SUBJECTS_NOTIFIED'
);
CREATE TYPE public.retention_action AS ENUM (
  'REVIEW', 'RETAIN', 'ARCHIVE', 'ANONYMISE', 'DELETE'
);
CREATE TYPE public.retention_review_status AS ENUM (
  'DUE', 'IN_REVIEW', 'BLOCKED', 'APPROVED', 'COMPLETED', 'CANCELLED'
);
CREATE TYPE public.assurance_evidence_status AS ENUM (
  'NOT_TESTED', 'SUBMITTED', 'PASS', 'FAIL', 'BLOCKED', 'EXPIRED'
);
CREATE TYPE public.release_decision_status AS ENUM (
  'BLOCKED', 'APPROVED', 'REVOKED'
);

CREATE TABLE public.data_subject_requests (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  request_reference varchar(40) NOT NULL,
  request_type public.data_subject_request_type NOT NULL,
  status public.data_subject_request_status NOT NULL DEFAULT 'RECEIVED',
  identity_status public.identity_proof_status NOT NULL DEFAULT 'NOT_STARTED',
  subject_name varchar(240) NOT NULL,
  subject_email varchar(320),
  subject_phone varchar(50),
  client_id uuid,
  request_details varchar(4000) NOT NULL,
  received_at timestamptz(6) NOT NULL,
  due_at timestamptz(6) NOT NULL,
  extended_due_at timestamptz(6),
  extension_reason varchar(2000),
  owner_user_profile_id uuid,
  response_reference varchar(1000),
  resolution_note varchar(4000),
  completed_at timestamptz(6),
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_data_subject_requests PRIMARY KEY (id),
  CONSTRAINT uq_data_subject_requests_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_data_subject_requests_org_reference UNIQUE (
    organisation_id, request_reference
  ),
  CONSTRAINT fk_data_subject_requests_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_data_subject_requests_client FOREIGN KEY (
    client_id, organisation_id
  ) REFERENCES public.clients(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_data_subject_requests_owner FOREIGN KEY (owner_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_data_subject_requests_creator FOREIGN KEY (
    created_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_data_subject_requests_updater FOREIGN KEY (
    updated_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_data_subject_requests_identity CHECK (
    subject_email IS NOT NULL OR subject_phone IS NOT NULL OR client_id IS NOT NULL
  ),
  CONSTRAINT ck_data_subject_requests_text CHECK (
    char_length(pg_catalog.btrim(subject_name)) BETWEEN 2 AND 240
    AND char_length(pg_catalog.btrim(request_details)) BETWEEN 10 AND 4000
  ),
  CONSTRAINT ck_data_subject_requests_deadline CHECK (
    due_at >= received_at
    AND (extended_due_at IS NULL OR extended_due_at >= due_at)
    AND ((extended_due_at IS NULL AND extension_reason IS NULL)
      OR (extended_due_at IS NOT NULL
        AND char_length(pg_catalog.btrim(extension_reason)) >= 10))
  ),
  CONSTRAINT ck_data_subject_requests_completion CHECK (
    (status IN ('COMPLETED', 'REFUSED', 'WITHDRAWN') AND completed_at IS NOT NULL)
    OR (status NOT IN ('COMPLETED', 'REFUSED', 'WITHDRAWN') AND completed_at IS NULL)
  ),
  CONSTRAINT ck_data_subject_requests_version CHECK (version > 0)
);
CREATE INDEX ix_data_subject_requests_org_status_due
  ON public.data_subject_requests (organisation_id, status, due_at);
CREATE INDEX ix_data_subject_requests_org_subject_email
  ON public.data_subject_requests (organisation_id, lower(subject_email));

CREATE TABLE public.data_subject_request_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  from_status public.data_subject_request_status,
  to_status public.data_subject_request_status NOT NULL,
  identity_status public.identity_proof_status NOT NULL,
  note varchar(4000) NOT NULL,
  evidence_reference varchar(1000),
  actor_user_profile_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_data_subject_request_events PRIMARY KEY (id),
  CONSTRAINT fk_data_subject_request_events_request FOREIGN KEY (
    request_id, organisation_id
  ) REFERENCES public.data_subject_requests(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_data_subject_request_events_actor FOREIGN KEY (
    actor_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_data_subject_request_events_note CHECK (
    char_length(pg_catalog.btrim(note)) BETWEEN 10 AND 4000
  )
);
CREATE INDEX ix_data_subject_request_events_request_occurred
  ON public.data_subject_request_events (
    organisation_id, request_id, occurred_at DESC
  );

CREATE TABLE public.legal_holds (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  scope_type varchar(20) NOT NULL,
  scope_id uuid,
  reason varchar(4000) NOT NULL,
  starts_at timestamptz(6) NOT NULL,
  expires_at timestamptz(6),
  released_at timestamptz(6),
  release_reason varchar(4000),
  created_by_user_profile_id uuid NOT NULL,
  released_by_user_profile_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_legal_holds PRIMARY KEY (id),
  CONSTRAINT uq_legal_holds_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_legal_holds_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_legal_holds_creator FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_legal_holds_releaser FOREIGN KEY (released_by_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_legal_holds_scope CHECK (
    (scope_type = 'ORGANISATION' AND scope_id IS NULL)
    OR (scope_type IN ('CLIENT', 'MATTER', 'DOCUMENT') AND scope_id IS NOT NULL)
  ),
  CONSTRAINT ck_legal_holds_reason CHECK (
    char_length(pg_catalog.btrim(reason)) BETWEEN 10 AND 4000
  ),
  CONSTRAINT ck_legal_holds_time CHECK (
    expires_at IS NULL OR expires_at > starts_at
  ),
  CONSTRAINT ck_legal_holds_release CHECK (
    (released_at IS NULL AND release_reason IS NULL
      AND released_by_user_profile_id IS NULL)
    OR (released_at IS NOT NULL
      AND char_length(pg_catalog.btrim(release_reason)) BETWEEN 10 AND 4000
      AND released_by_user_profile_id IS NOT NULL)
  ),
  CONSTRAINT ck_legal_holds_version CHECK (version > 0)
);
CREATE UNIQUE INDEX uq_legal_holds_org_active_scope
  ON public.legal_holds (
    organisation_id, scope_type, COALESCE(scope_id, organisation_id)
  ) WHERE released_at IS NULL;
CREATE INDEX ix_legal_holds_org_active
  ON public.legal_holds (organisation_id, starts_at, expires_at)
  WHERE released_at IS NULL;

CREATE TABLE public.retention_policies (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  policy_key varchar(120) NOT NULL,
  name varchar(180) NOT NULL,
  resource_type varchar(120) NOT NULL,
  trigger_event varchar(160) NOT NULL,
  retention_days integer NOT NULL,
  action public.retention_action NOT NULL,
  lawful_reason varchar(2000) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_retention_policies PRIMARY KEY (id),
  CONSTRAINT uq_retention_policies_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_retention_policies_org_key UNIQUE (organisation_id, policy_key),
  CONSTRAINT fk_retention_policies_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_policies_creator FOREIGN KEY (
    created_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_policies_updater FOREIGN KEY (
    updated_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_retention_policies_key CHECK (
    policy_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_retention_policies_resource CHECK (
    resource_type ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT ck_retention_policies_days CHECK (
    retention_days BETWEEN 1 AND 36500
  ),
  CONSTRAINT ck_retention_policies_text CHECK (
    char_length(pg_catalog.btrim(name)) BETWEEN 2 AND 180
    AND char_length(pg_catalog.btrim(lawful_reason)) BETWEEN 10 AND 2000
  ),
  CONSTRAINT ck_retention_policies_version CHECK (version > 0)
);
CREATE INDEX ix_retention_policies_org_active
  ON public.retention_policies (organisation_id, is_active, resource_type);

CREATE TABLE public.retention_reviews (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  resource_type varchar(120) NOT NULL,
  resource_id uuid NOT NULL,
  status public.retention_review_status NOT NULL DEFAULT 'DUE',
  decision public.retention_action,
  due_at timestamptz(6) NOT NULL,
  legal_hold_id uuid,
  owner_user_profile_id uuid,
  decision_notes varchar(4000),
  completion_evidence_reference varchar(1000),
  decided_by_user_profile_id uuid,
  decided_at timestamptz(6),
  completed_at timestamptz(6),
  created_by_user_profile_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_retention_reviews PRIMARY KEY (id),
  CONSTRAINT uq_retention_reviews_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_retention_reviews_org_resource_policy UNIQUE (
    organisation_id, resource_type, resource_id, policy_id
  ),
  CONSTRAINT fk_retention_reviews_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_reviews_policy FOREIGN KEY (policy_id, organisation_id)
    REFERENCES public.retention_policies(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_reviews_hold FOREIGN KEY (legal_hold_id, organisation_id)
    REFERENCES public.legal_holds(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_reviews_owner FOREIGN KEY (owner_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_reviews_decider FOREIGN KEY (decided_by_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_retention_reviews_creator FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_retention_reviews_resource CHECK (
    resource_type ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT ck_retention_reviews_decision CHECK (
    (status IN ('DUE', 'IN_REVIEW') AND decision IS NULL
      AND decided_at IS NULL AND decided_by_user_profile_id IS NULL)
    OR (status IN ('BLOCKED', 'APPROVED', 'COMPLETED', 'CANCELLED')
      AND decision IS NOT NULL AND decided_at IS NOT NULL
      AND decided_by_user_profile_id IS NOT NULL
      AND char_length(pg_catalog.btrim(decision_notes)) BETWEEN 10 AND 4000)
  ),
  CONSTRAINT ck_retention_reviews_completion CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL
      AND char_length(pg_catalog.btrim(completion_evidence_reference)) >= 8)
    OR (status <> 'COMPLETED' AND completed_at IS NULL)
  ),
  CONSTRAINT ck_retention_reviews_version CHECK (version > 0)
);
CREATE INDEX ix_retention_reviews_org_status_due
  ON public.retention_reviews (organisation_id, status, due_at);

CREATE TABLE public.privacy_incidents (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  incident_reference varchar(40) NOT NULL,
  title varchar(240) NOT NULL,
  description varchar(8000) NOT NULL,
  severity public.privacy_incident_severity NOT NULL,
  status public.privacy_incident_status NOT NULL DEFAULT 'OPEN',
  personal_data_breach boolean NOT NULL,
  data_categories varchar(160)[] NOT NULL DEFAULT ARRAY[]::varchar(160)[],
  approximate_people_affected integer NOT NULL DEFAULT 0,
  discovered_at timestamptz(6) NOT NULL,
  notification_deadline_at timestamptz(6),
  contained_at timestamptz(6),
  risk_assessment varchar(8000),
  notification_decision public.breach_notification_decision NOT NULL
    DEFAULT 'UNASSESSED',
  ico_reference varchar(240),
  ico_notified_at timestamptz(6),
  subject_notification_evidence varchar(1000),
  subjects_notified_at timestamptz(6),
  resolution varchar(4000),
  resolved_at timestamptz(6),
  owner_user_profile_id uuid,
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_privacy_incidents PRIMARY KEY (id),
  CONSTRAINT uq_privacy_incidents_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_privacy_incidents_org_reference UNIQUE (
    organisation_id, incident_reference
  ),
  CONSTRAINT fk_privacy_incidents_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_privacy_incidents_owner FOREIGN KEY (owner_user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_privacy_incidents_creator FOREIGN KEY (
    created_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_privacy_incidents_updater FOREIGN KEY (
    updated_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_privacy_incidents_text CHECK (
    char_length(pg_catalog.btrim(title)) BETWEEN 3 AND 240
    AND char_length(pg_catalog.btrim(description)) BETWEEN 20 AND 8000
  ),
  CONSTRAINT ck_privacy_incidents_people CHECK (
    approximate_people_affected BETWEEN 0 AND 100000000
  ),
  CONSTRAINT ck_privacy_incidents_categories CHECK (
    cardinality(data_categories) <= 30
  ),
  CONSTRAINT ck_privacy_incidents_discovery CHECK (
    discovered_at <= created_at + interval '1 minute'
  ),
  CONSTRAINT ck_privacy_incidents_notification_clock CHECK (
    (personal_data_breach AND notification_deadline_at IS NOT NULL)
    OR (NOT personal_data_breach AND notification_deadline_at IS NULL)
  ),
  CONSTRAINT ck_privacy_incidents_ico_evidence CHECK (
    notification_decision <> 'ICO_NOTIFIED'
    OR (ico_reference IS NOT NULL AND ico_notified_at IS NOT NULL)
  ),
  CONSTRAINT ck_privacy_incidents_subject_evidence CHECK (
    notification_decision <> 'SUBJECTS_NOTIFIED'
    OR (subject_notification_evidence IS NOT NULL
      AND subjects_notified_at IS NOT NULL)
  ),
  CONSTRAINT ck_privacy_incidents_resolution CHECK (
    (status IN ('RESOLVED', 'CLOSED') AND resolved_at IS NOT NULL
      AND char_length(pg_catalog.btrim(resolution)) BETWEEN 10 AND 4000)
    OR (status NOT IN ('RESOLVED', 'CLOSED') AND resolved_at IS NULL)
  ),
  CONSTRAINT ck_privacy_incidents_version CHECK (version > 0)
);
CREATE INDEX ix_privacy_incidents_org_status_severity
  ON public.privacy_incidents (
    organisation_id, status, severity, discovered_at DESC
  );
CREATE INDEX ix_privacy_incidents_notification_deadline
  ON public.privacy_incidents (notification_deadline_at)
  WHERE personal_data_breach AND notification_decision = 'UNASSESSED';

CREATE TABLE public.privacy_incident_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  from_status public.privacy_incident_status,
  to_status public.privacy_incident_status NOT NULL,
  severity public.privacy_incident_severity NOT NULL,
  notification_decision public.breach_notification_decision NOT NULL,
  note varchar(4000) NOT NULL,
  evidence_reference varchar(1000),
  actor_user_profile_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_privacy_incident_events PRIMARY KEY (id),
  CONSTRAINT fk_privacy_incident_events_incident FOREIGN KEY (
    incident_id, organisation_id
  ) REFERENCES public.privacy_incidents(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_privacy_incident_events_actor FOREIGN KEY (
    actor_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_privacy_incident_events_note CHECK (
    char_length(pg_catalog.btrim(note)) BETWEEN 10 AND 4000
  )
);
CREATE INDEX ix_privacy_incident_events_incident_occurred
  ON public.privacy_incident_events (
    organisation_id, incident_id, occurred_at DESC
  );

CREATE TABLE public.assurance_evidence (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  evidence_key varchar(120) NOT NULL,
  title varchar(180) NOT NULL,
  category varchar(80) NOT NULL,
  mandatory boolean NOT NULL DEFAULT false,
  status public.assurance_evidence_status NOT NULL DEFAULT 'NOT_TESTED',
  evidence_reference varchar(1000),
  evidence_sha256 char(64),
  assessor_name varchar(240),
  assessor_organisation varchar(240),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  tested_at timestamptz(6),
  expires_at timestamptz(6),
  notes varchar(4000),
  recorded_by_user_profile_id uuid,
  reviewed_by_user_profile_id uuid,
  reviewed_at timestamptz(6),
  review_note varchar(4000),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_assurance_evidence PRIMARY KEY (id),
  CONSTRAINT uq_assurance_evidence_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_assurance_evidence_org_key UNIQUE (organisation_id, evidence_key),
  CONSTRAINT fk_assurance_evidence_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_assurance_evidence_recorder FOREIGN KEY (
    recorded_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_assurance_evidence_reviewer FOREIGN KEY (
    reviewed_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_assurance_evidence_key CHECK (
    evidence_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_assurance_evidence_category CHECK (
    category ~ '^[A-Z][A-Z0-9_]*$'
  ),
  CONSTRAINT ck_assurance_evidence_scope CHECK (
    pg_catalog.jsonb_typeof(scope) = 'object'
  ),
  CONSTRAINT ck_assurance_evidence_submission CHECK (
    (status = 'NOT_TESTED' AND evidence_reference IS NULL
      AND evidence_sha256 IS NULL AND recorded_by_user_profile_id IS NULL)
    OR (status <> 'NOT_TESTED' AND evidence_reference IS NOT NULL
      AND evidence_sha256 ~ '^[a-f0-9]{64}$'
      AND assessor_name IS NOT NULL AND tested_at IS NOT NULL
      AND expires_at IS NOT NULL AND expires_at > tested_at
      AND recorded_by_user_profile_id IS NOT NULL)
  ),
  CONSTRAINT ck_assurance_evidence_review CHECK (
    (status IN ('PASS', 'FAIL', 'BLOCKED')
      AND reviewed_by_user_profile_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND char_length(pg_catalog.btrim(review_note)) BETWEEN 10 AND 4000
      AND reviewed_by_user_profile_id <> recorded_by_user_profile_id)
    OR (status NOT IN ('PASS', 'FAIL', 'BLOCKED')
      AND reviewed_by_user_profile_id IS NULL AND reviewed_at IS NULL
      AND review_note IS NULL)
  ),
  CONSTRAINT ck_assurance_evidence_version CHECK (version > 0)
);
CREATE INDEX ix_assurance_evidence_org_status
  ON public.assurance_evidence (
    organisation_id, mandatory, status, expires_at
  );

CREATE TABLE public.production_release_decisions (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  release_reference varchar(128) NOT NULL,
  environment varchar(20) NOT NULL,
  decision public.release_decision_status NOT NULL,
  rationale varchar(4000) NOT NULL,
  change_reference varchar(1000),
  blocker_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_by_user_profile_id uuid NOT NULL,
  assurance_level public.authentication_assurance_level NOT NULL,
  decided_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_production_release_decisions PRIMARY KEY (id),
  CONSTRAINT uq_production_release_decisions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_production_release_decisions_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_production_release_decisions_decider FOREIGN KEY (
    decided_by_user_profile_id
  ) REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_production_release_decisions_reference CHECK (
    release_reference ~ '^[A-Za-z0-9][A-Za-z0-9._-]{6,127}$'
  ),
  CONSTRAINT ck_production_release_decisions_environment CHECK (
    environment IN ('PRODUCTION', 'STAGING')
  ),
  CONSTRAINT ck_production_release_decisions_rationale CHECK (
    char_length(pg_catalog.btrim(rationale)) BETWEEN 20 AND 4000
  ),
  CONSTRAINT ck_production_release_decisions_json CHECK (
    pg_catalog.jsonb_typeof(blocker_snapshot) = 'array'
    AND pg_catalog.jsonb_typeof(evidence_snapshot) = 'array'
  ),
  CONSTRAINT ck_production_release_decisions_aal CHECK (
    assurance_level = 'AAL2'
  )
);
CREATE INDEX ix_production_release_decisions_org_release
  ON public.production_release_decisions (
    organisation_id, release_reference, environment, decided_at DESC
  );

WITH permission_seed(
  permission_key, permission_name, permission_description,
  resource_name, action_name, requires_mfa
) AS (
  VALUES
    ('compliance.read', 'View data-protection operations',
      'View tenant data-rights, breach and retention governance records.',
      'compliance', 'read', false),
    ('compliance.manage', 'Manage data-subject rights',
      'Operate verified UK data-subject-rights workflows and export candidates.',
      'compliance', 'manage', true),
    ('incidents.read', 'View privacy incidents',
      'View tenant privacy-incident and notification-decision evidence.',
      'incidents', 'read', false),
    ('incidents.manage', 'Manage privacy incidents',
      'Record, assess, contain and close privacy incidents with notification evidence.',
      'incidents', 'manage', true),
    ('retention.read', 'View retention governance',
      'View retention policies, reviews and active legal holds.',
      'retention', 'read', false),
    ('retention.manage', 'Manage retention governance',
      'Operate versioned retention reviews and legal holds without automatic destructive deletion.',
      'retention', 'manage', true),
    ('assurance.read', 'View assurance evidence',
      'View release-control evidence, independent review and expiry state.',
      'assurance', 'read', false),
    ('assurance.manage', 'Manage assurance evidence',
      'Submit and independently review hashed production-assurance evidence.',
      'assurance', 'manage', true),
    ('release.approve', 'Decide production release',
      'Record an AAL2 production release decision after mandatory controls pass.',
      'release', 'approve', true)
)
INSERT INTO public.permissions (
  id, key, name, description, resource, action, data_scope,
  is_sensitive, requires_mfa, allows_ai_use, is_active,
  metadata, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), permission_key, permission_name,
  permission_description, resource_name, action_name,
  'ORGANISATION'::public.permission_data_scope, true, requires_mfa,
  false, true,
  pg_catalog.jsonb_build_object(
    'classification', 'restricted-governance',
    'contains_pii', true,
    'ai_default', 'deny',
    'control_family', 'gate-n-uk-compliance-production-assurance'
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
    'compliance.read', 'compliance.manage', 'incidents.read',
    'incidents.manage', 'retention.read', 'retention.manage',
    'assurance.read', 'assurance.manage', 'release.approve'
  )
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('compliance_manager', 'compliance.read'),
    ('compliance_manager', 'compliance.manage'),
    ('compliance_manager', 'incidents.read'),
    ('compliance_manager', 'incidents.manage'),
    ('compliance_manager', 'retention.read'),
    ('compliance_manager', 'retention.manage'),
    ('compliance_manager', 'assurance.read'),
    ('compliance_manager', 'assurance.manage'),
    ('compliance_manager', 'release.approve'),
    ('solicitor', 'compliance.read'),
    ('solicitor', 'incidents.read'),
    ('case_manager', 'compliance.read'),
    ('case_manager', 'incidents.read'),
    ('case_manager', 'retention.read'),
    ('case_manager', 'assurance.read')
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

CREATE OR REPLACE FUNCTION private.reject_gate_n_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'Gate N evidence is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;

ALTER FUNCTION private.reject_gate_n_evidence_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_gate_n_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE TRIGGER data_subject_request_events_append_only
  BEFORE UPDATE OR DELETE ON public.data_subject_request_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_gate_n_evidence_mutation();
CREATE TRIGGER privacy_incident_events_append_only
  BEFORE UPDATE OR DELETE ON public.privacy_incident_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_gate_n_evidence_mutation();
CREATE TRIGGER production_release_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.production_release_decisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_gate_n_evidence_mutation();

CREATE TRIGGER data_subject_requests_immutable_identity
  BEFORE UPDATE ON public.data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'request_reference', 'request_type',
    'created_by_user_profile_id', 'created_at'
  );
CREATE TRIGGER legal_holds_immutable_identity
  BEFORE UPDATE ON public.legal_holds
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'scope_type', 'scope_id',
    'created_by_user_profile_id', 'created_at'
  );
CREATE TRIGGER retention_policies_immutable_identity
  BEFORE UPDATE ON public.retention_policies
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'policy_key', 'created_by_user_profile_id',
    'created_at'
  );
CREATE TRIGGER retention_reviews_immutable_identity
  BEFORE UPDATE ON public.retention_reviews
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'policy_id', 'resource_type', 'resource_id',
    'created_by_user_profile_id', 'created_at'
  );
CREATE TRIGGER privacy_incidents_immutable_identity
  BEFORE UPDATE ON public.privacy_incidents
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'incident_reference', 'discovered_at',
    'created_by_user_profile_id', 'created_at'
  );
CREATE TRIGGER assurance_evidence_immutable_identity
  BEFORE UPDATE ON public.assurance_evidence
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'evidence_key', 'mandatory', 'created_at'
  );

ALTER TABLE public.data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_subject_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.data_subject_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_subject_request_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retention_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assurance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assurance_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_release_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_release_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY data_subject_requests_select
  ON public.data_subject_requests FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'compliance.read')
  );
CREATE POLICY data_subject_request_events_select
  ON public.data_subject_request_events FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'compliance.read')
  );
CREATE POLICY legal_holds_select
  ON public.legal_holds FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'retention.read')
  );
CREATE POLICY retention_policies_select
  ON public.retention_policies FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'retention.read')
  );
CREATE POLICY retention_reviews_select
  ON public.retention_reviews FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'retention.read')
  );
CREATE POLICY privacy_incidents_select
  ON public.privacy_incidents FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'incidents.read')
  );
CREATE POLICY privacy_incident_events_select
  ON public.privacy_incident_events FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'incidents.read')
  );
CREATE POLICY assurance_evidence_select
  ON public.assurance_evidence FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'assurance.read')
  );
CREATE POLICY production_release_decisions_select
  ON public.production_release_decisions FOR SELECT TO businessos_app
  USING (
    organisation_id = private.current_organisation_id()
    AND private.has_organisation_permission(organisation_id, 'assurance.read')
  );

REVOKE ALL ON TABLE public.data_subject_requests,
  public.data_subject_request_events, public.legal_holds,
  public.retention_policies, public.retention_reviews,
  public.privacy_incidents, public.privacy_incident_events,
  public.assurance_evidence, public.production_release_decisions
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.seed_gate_n_assurance(
  p_organisation_id uuid
)
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
    RAISE EXCEPTION 'Organisation was not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.assurance_evidence (
    organisation_id, evidence_key, title, category, mandatory
  )
  SELECT p_organisation_id, seed.evidence_key, seed.title, seed.category, true
  FROM (
    VALUES
      ('backup.restore', 'Independent backup restoration exercise', 'RESILIENCE'),
      ('security.penetration_test', 'Independent penetration test and remediation', 'SECURITY'),
      ('security.vulnerability_scan', 'Dependency, secret and container vulnerability scan', 'SECURITY'),
      ('operations.capacity_test', 'Capacity, soak and failure-recovery test', 'RESILIENCE'),
      ('operations.incident_tabletop', 'Security and privacy incident tabletop', 'INCIDENT_RESPONSE'),
      ('privacy.dpia', 'Current data protection impact assessment', 'PRIVACY'),
      ('privacy.ropa', 'Current record of processing activities', 'PRIVACY'),
      ('privacy.processor_contracts', 'Processor contracts and transfer safeguards review', 'PRIVACY'),
      ('accessibility.wcag22', 'WCAG 2.2 accessibility review', 'ACCESSIBILITY'),
      ('acceptance.uk_pilot', 'UK stakeholder pilot and end-to-end journey', 'ACCEPTANCE'),
      ('providers.live_operations', 'Email, WhatsApp, calendar, payments and AI live-provider acceptance', 'PROVIDERS'),
      ('operations.monitoring_alerts', 'Production monitoring, alert routing and on-call exercise', 'OPERATIONS')
  ) AS seed(evidence_key, title, category)
  ON CONFLICT (organisation_id, evidence_key) DO NOTHING;
END;
$function$;
ALTER FUNCTION private.seed_gate_n_assurance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.seed_gate_n_assurance(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.seed_gate_n_assurance_after_organisation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.seed_gate_n_assurance(NEW.id);
  RETURN NEW;
END;
$function$;
ALTER FUNCTION private.seed_gate_n_assurance_after_organisation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.seed_gate_n_assurance_after_organisation()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE TRIGGER organisations_seed_gate_n_assurance
  AFTER INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION private.seed_gate_n_assurance_after_organisation();

SELECT private.seed_gate_n_assurance(organisation.id)
FROM public.organisations AS organisation
WHERE organisation.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION private.record_gate_n_audit(
  p_organisation_id uuid,
  p_actor_user_profile_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_previous_value jsonb,
  p_new_value jsonb,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_organisation_id IS DISTINCT FROM private.current_organisation_id()
    OR p_actor_user_profile_id IS DISTINCT FROM private.current_user_id()
    OR p_action IS NULL OR p_resource_type IS NULL
    OR COALESCE(pg_catalog.jsonb_typeof(p_metadata), '') <> 'object' THEN
    RAISE EXCEPTION 'Invalid Gate N audit context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome,
    previous_value, new_value, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), p_organisation_id,
    'USER'::public.audit_actor_type, p_actor_user_profile_id,
    'businessos-api', left(p_action, 160), left(p_resource_type, 120),
    left(p_resource_id, 160), 'SUCCESS'::public.audit_outcome,
    p_previous_value, p_new_value,
    COALESCE(p_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'assuranceLevel', private.current_aal(),
      'gate', 'N'
    )
  );
END;
$function$;
ALTER FUNCTION private.record_gate_n_audit(
  uuid, uuid, text, text, text, jsonb, jsonb, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.record_gate_n_audit(
  uuid, uuid, text, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.get_production_release_blockers(
  p_organisation_id uuid,
  p_decider_user_profile_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(blocker) ORDER BY blocker.code, blocker.subject),
    '[]'::jsonb
  )
  FROM (
    SELECT
      'MANDATORY_EVIDENCE'::text AS code,
      evidence.evidence_key::text AS subject,
      CASE
        WHEN evidence.status = 'PASS' AND evidence.expires_at <= pg_catalog.now()
          THEN 'Evidence has expired.'
        ELSE 'Mandatory evidence is not independently passed.'
      END::text AS detail
    FROM public.assurance_evidence AS evidence
    WHERE evidence.organisation_id = p_organisation_id
      AND evidence.mandatory = true
      AND (
        evidence.status <> 'PASS'
        OR evidence.expires_at IS NULL
        OR evidence.expires_at <= pg_catalog.now()
      )

    UNION ALL

    SELECT
      'SEGREGATION_OF_DUTIES'::text,
      evidence.evidence_key::text,
      'The release decider cannot be the recorder or reviewer of this critical evidence.'::text
    FROM public.assurance_evidence AS evidence
    WHERE evidence.organisation_id = p_organisation_id
      AND evidence.evidence_key IN (
        'backup.restore', 'security.penetration_test', 'acceptance.uk_pilot'
      )
      AND evidence.status = 'PASS'
      AND (
        evidence.recorded_by_user_profile_id = p_decider_user_profile_id
        OR evidence.reviewed_by_user_profile_id = p_decider_user_profile_id
      )

    UNION ALL

    SELECT
      'PRIVACY_INCIDENT'::text,
      incident.incident_reference::text,
      ('Open ' || lower(incident.severity::text) || ' privacy incident.')::text
    FROM public.privacy_incidents AS incident
    WHERE incident.organisation_id = p_organisation_id
      AND incident.status NOT IN ('RESOLVED', 'CLOSED')
      AND incident.severity IN ('HIGH', 'CRITICAL')

    UNION ALL

    SELECT
      'BREACH_NOTIFICATION'::text,
      incident.incident_reference::text,
      'Personal-data breach notification decision remains unresolved.'::text
    FROM public.privacy_incidents AS incident
    WHERE incident.organisation_id = p_organisation_id
      AND incident.personal_data_breach = true
      AND incident.status <> 'CLOSED'
      AND incident.notification_decision IN (
        'UNASSESSED', 'ICO_REQUIRED', 'SUBJECTS_REQUIRED'
      )

    UNION ALL

    SELECT
      'OVERDUE_DATA_RIGHT'::text,
      request_record.request_reference::text,
      'A data-subject request is beyond its controlled response deadline.'::text
    FROM public.data_subject_requests AS request_record
    WHERE request_record.organisation_id = p_organisation_id
      AND request_record.status NOT IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
      AND COALESCE(request_record.extended_due_at, request_record.due_at)
        < pg_catalog.now()

    UNION ALL

    SELECT
      'OVERDUE_RETENTION_REVIEW'::text,
      review.id::text,
      'A retention review is overdue and unresolved.'::text
    FROM public.retention_reviews AS review
    WHERE review.organisation_id = p_organisation_id
      AND review.status IN ('DUE', 'IN_REVIEW', 'BLOCKED')
      AND review.due_at < pg_catalog.now()

    UNION ALL

    SELECT
      'PILOT_ACCEPTANCE'::text,
      'role-journeys'::text,
      'All eight stakeholder journeys need current passing evidence.'::text
    WHERE (
      SELECT count(DISTINCT evidence.role_name)
      FROM public.pilot_acceptance_evidence AS evidence
      WHERE evidence.organisation_id = p_organisation_id
        AND evidence.status = 'PASS'
    ) < 8

    UNION ALL

    SELECT
      'PILOT_DEFECT'::text,
      feedback.id::text,
      ('Open ' || lower(feedback.severity::text) || ' pilot defect.')::text
    FROM public.pilot_feedback AS feedback
    WHERE feedback.organisation_id = p_organisation_id
      AND feedback.status IN ('OPEN', 'TRIAGED')
      AND feedback.severity IN ('HIGH', 'CRITICAL')
  ) AS blocker;
$function$;
ALTER FUNCTION private.get_production_release_blockers(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.get_production_release_blockers(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.create_data_subject_request(
  p_request_type public.data_subject_request_type,
  p_subject_name text,
  p_subject_email text,
  p_subject_phone text,
  p_client_id uuid,
  p_received_at timestamptz,
  p_request_details text,
  p_owner_user_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_id uuid := pg_catalog.gen_random_uuid();
  v_received_at timestamptz := COALESCE(p_received_at, pg_catalog.now());
  v_due_at timestamptz;
  v_reference text;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'compliance.manage') THEN
    RAISE EXCEPTION 'AAL2 data-rights authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_request_type IS NULL
    OR p_subject_name IS NULL
    OR char_length(pg_catalog.btrim(p_subject_name)) NOT BETWEEN 2 AND 240
    OR p_request_details IS NULL
    OR char_length(pg_catalog.btrim(p_request_details)) NOT BETWEEN 10 AND 4000
    OR (p_subject_email IS NULL AND p_subject_phone IS NULL AND p_client_id IS NULL)
    OR v_received_at > pg_catalog.now() + interval '1 minute' THEN
    RAISE EXCEPTION 'Data-subject request information is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients AS client
    WHERE client.id = p_client_id AND client.organisation_id = v_org
      AND client.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Linked client was not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_owner_user_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organisation_memberships AS membership
    WHERE membership.organisation_id = v_org
      AND membership.user_profile_id = p_owner_user_profile_id
      AND membership.status = 'ACTIVE' AND membership.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Request owner is not an active member' USING ERRCODE = 'P0002';
  END IF;

  v_due_at := v_received_at + interval '1 month';
  v_reference := 'DSR-' || pg_catalog.to_char(v_received_at, 'YYYYMM') || '-'
    || upper(substr(replace(v_id::text, '-', ''), 1, 10));

  INSERT INTO public.data_subject_requests (
    id, organisation_id, request_reference, request_type, status,
    identity_status, subject_name, subject_email, subject_phone, client_id,
    request_details, received_at, due_at, owner_user_profile_id,
    created_by_user_profile_id, updated_by_user_profile_id
  ) VALUES (
    v_id, v_org, v_reference, p_request_type, 'RECEIVED', 'NOT_STARTED',
    pg_catalog.btrim(p_subject_name), nullif(lower(pg_catalog.btrim(p_subject_email)), ''),
    nullif(pg_catalog.btrim(p_subject_phone), ''), p_client_id,
    pg_catalog.btrim(p_request_details), v_received_at, v_due_at,
    COALESCE(p_owner_user_profile_id, v_user), v_user, v_user
  );

  INSERT INTO public.data_subject_request_events (
    organisation_id, request_id, from_status, to_status, identity_status,
    note, actor_user_profile_id
  ) VALUES (
    v_org, v_id, NULL, 'RECEIVED', 'NOT_STARTED',
    'Data-subject request recorded from the received request evidence.', v_user
  );

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'data_subject_request.created',
    'data_subject_request', v_id::text, NULL,
    pg_catalog.jsonb_build_object(
      'requestReference', v_reference,
      'requestType', p_request_type::text,
      'status', 'RECEIVED',
      'dueAt', v_due_at,
      'clientId', p_client_id
    ),
    pg_catalog.jsonb_build_object('containsSubjectData', true)
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'requestReference', v_reference,
    'requestType', p_request_type::text, 'status', 'RECEIVED',
    'identityStatus', 'NOT_STARTED', 'receivedAt', v_received_at,
    'dueAt', v_due_at, 'version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.transition_data_subject_request(
  p_request_id uuid,
  p_status public.data_subject_request_status,
  p_identity_status public.identity_proof_status,
  p_note text,
  p_evidence_reference text,
  p_response_reference text,
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
  v_request public.data_subject_requests%ROWTYPE;
  v_identity public.identity_proof_status;
  v_allowed boolean := false;
  v_completed_at timestamptz;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'compliance.manage') THEN
    RAISE EXCEPTION 'AAL2 data-rights authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_request_id IS NULL OR p_status IS NULL
    OR p_note IS NULL
    OR char_length(pg_catalog.btrim(p_note)) NOT BETWEEN 10 AND 4000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Data-subject request transition is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.data_subject_requests AS request_record
  WHERE request_record.id = p_request_id
    AND request_record.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data-subject request was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'Data-subject request changed; refresh before retrying'
      USING ERRCODE = '40001';
  END IF;

  v_identity := COALESCE(p_identity_status, v_request.identity_status);
  v_allowed := CASE v_request.status
    WHEN 'RECEIVED' THEN p_status IN (
      'IDENTITY_VERIFICATION', 'IN_PROGRESS', 'ON_HOLD', 'WITHDRAWN'
    )
    WHEN 'IDENTITY_VERIFICATION' THEN p_status IN (
      'IN_PROGRESS', 'ON_HOLD', 'REFUSED', 'WITHDRAWN'
    )
    WHEN 'IN_PROGRESS' THEN p_status IN (
      'ON_HOLD', 'READY_FOR_REVIEW', 'REFUSED', 'WITHDRAWN'
    )
    WHEN 'ON_HOLD' THEN p_status IN (
      'IDENTITY_VERIFICATION', 'IN_PROGRESS', 'REFUSED', 'WITHDRAWN'
    )
    WHEN 'READY_FOR_REVIEW' THEN p_status IN (
      'IN_PROGRESS', 'COMPLETED', 'REFUSED'
    )
    ELSE false
  END;
  IF NOT v_allowed OR p_status = v_request.status THEN
    RAISE EXCEPTION 'Data-subject request transition is not permitted'
      USING ERRCODE = '22023';
  END IF;
  IF v_identity = 'VERIFIED'
    AND char_length(pg_catalog.btrim(COALESCE(p_evidence_reference, ''))) < 8
    AND v_request.identity_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Identity verification requires an evidence reference'
      USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('READY_FOR_REVIEW', 'COMPLETED')
    AND v_identity <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Verified identity is required before response review'
      USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('COMPLETED', 'REFUSED')
    AND char_length(pg_catalog.btrim(COALESCE(p_response_reference, ''))) < 8 THEN
    RAISE EXCEPTION 'Completion or refusal requires response evidence'
      USING ERRCODE = '22023';
  END IF;

  v_completed_at := CASE
    WHEN p_status IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
      THEN pg_catalog.now()
    ELSE NULL
  END;
  UPDATE public.data_subject_requests
  SET status = p_status,
      identity_status = v_identity,
      response_reference = CASE
        WHEN p_status IN ('COMPLETED', 'REFUSED')
          THEN pg_catalog.btrim(p_response_reference)
        ELSE response_reference
      END,
      resolution_note = CASE
        WHEN p_status IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
          THEN pg_catalog.btrim(p_note)
        ELSE resolution_note
      END,
      completed_at = v_completed_at,
      updated_by_user_profile_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_request.id AND organisation_id = v_org;

  INSERT INTO public.data_subject_request_events (
    organisation_id, request_id, from_status, to_status, identity_status,
    note, evidence_reference, actor_user_profile_id
  ) VALUES (
    v_org, v_request.id, v_request.status, p_status, v_identity,
    pg_catalog.btrim(p_note), nullif(pg_catalog.btrim(p_evidence_reference), ''),
    v_user
  );

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'data_subject_request.transitioned',
    'data_subject_request', v_request.id::text,
    pg_catalog.jsonb_build_object(
      'status', v_request.status::text,
      'identityStatus', v_request.identity_status::text,
      'version', v_request.version
    ),
    pg_catalog.jsonb_build_object(
      'status', p_status::text,
      'identityStatus', v_identity::text,
      'version', v_request.version + 1,
      'responseEvidenceRecorded', p_response_reference IS NOT NULL
    ),
    pg_catalog.jsonb_build_object('eventEvidenceRecorded', p_evidence_reference IS NOT NULL)
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_request.id, 'requestReference', v_request.request_reference,
    'status', p_status::text, 'identityStatus', v_identity::text,
    'completedAt', v_completed_at, 'version', v_request.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.extend_data_subject_request(
  p_request_id uuid,
  p_extended_due_at timestamptz,
  p_reason text,
  p_notification_reference text,
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
  v_request public.data_subject_requests%ROWTYPE;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'compliance.manage') THEN
    RAISE EXCEPTION 'AAL2 data-rights authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_request_id IS NULL OR p_extended_due_at IS NULL
    OR p_reason IS NULL
    OR char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 20 AND 2000
    OR char_length(pg_catalog.btrim(
      COALESCE(p_notification_reference, '')
    )) NOT BETWEEN 8 AND 1000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Data-subject deadline extension is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.data_subject_requests AS request_record
  WHERE request_record.id = p_request_id
    AND request_record.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data-subject request was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'Data-subject request changed; refresh before retrying'
      USING ERRCODE = '40001';
  END IF;
  IF v_request.status IN ('COMPLETED', 'REFUSED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Closed data-subject requests cannot be extended'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_request.extended_due_at IS NOT NULL THEN
    RAISE EXCEPTION 'The data-subject request already has an extension'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_extended_due_at <= v_request.due_at
    OR p_extended_due_at > v_request.due_at + interval '2 months'
    OR p_extended_due_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Extension must be after the original deadline and no more than two additional months'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.data_subject_requests
  SET extended_due_at = p_extended_due_at,
      extension_reason = pg_catalog.btrim(p_reason),
      updated_by_user_profile_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_request.id AND organisation_id = v_org;

  INSERT INTO public.data_subject_request_events (
    organisation_id, request_id, from_status, to_status, identity_status,
    note, evidence_reference, actor_user_profile_id
  ) VALUES (
    v_org, v_request.id, v_request.status, v_request.status,
    v_request.identity_status,
    'Response deadline extended: ' || pg_catalog.btrim(p_reason),
    pg_catalog.btrim(p_notification_reference), v_user
  );

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'data_subject_request.deadline_extended',
    'data_subject_request', v_request.id::text,
    pg_catalog.jsonb_build_object(
      'dueAt', v_request.due_at, 'extendedDueAt', v_request.extended_due_at,
      'version', v_request.version
    ),
    pg_catalog.jsonb_build_object(
      'dueAt', v_request.due_at, 'extendedDueAt', p_extended_due_at,
      'notificationEvidenceRecorded', true,
      'version', v_request.version + 1
    ),
    pg_catalog.jsonb_build_object('statutoryAssessmentRemainsHuman', true)
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_request.id, 'requestReference', v_request.request_reference,
    'status', v_request.status::text, 'dueAt', v_request.due_at,
    'extendedDueAt', p_extended_due_at,
    'notificationReferenceRecorded', true,
    'version', v_request.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.build_data_subject_export_candidate(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_request public.data_subject_requests%ROWTYPE;
  v_client_ids uuid[] := ARRAY[]::uuid[];
  v_matter_ids uuid[] := ARRAY[]::uuid[];
  v_result jsonb;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'compliance.manage') THEN
    RAISE EXCEPTION 'AAL2 data-export authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_request
  FROM public.data_subject_requests AS request_record
  WHERE request_record.id = p_request_id
    AND request_record.organisation_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data-subject request was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_request.request_type NOT IN ('ACCESS', 'PORTABILITY')
    OR v_request.identity_status <> 'VERIFIED'
    OR v_request.status NOT IN ('IN_PROGRESS', 'READY_FOR_REVIEW') THEN
    RAISE EXCEPTION 'Verified access or portability request is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(client.id), ARRAY[]::uuid[])
    INTO v_client_ids
  FROM public.clients AS client
  WHERE client.organisation_id = v_org
    AND client.deleted_at IS NULL
    AND (
      client.id = v_request.client_id
      OR (v_request.subject_email IS NOT NULL
        AND lower(client.email) = lower(v_request.subject_email))
      OR (v_request.subject_phone IS NOT NULL
        AND client.phone = v_request.subject_phone)
    );

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT party.matter_id), ARRAY[]::uuid[])
    INTO v_matter_ids
  FROM public.matter_parties AS party
  WHERE party.organisation_id = v_org
    AND party.client_id = ANY(v_client_ids)
    AND party.deleted_at IS NULL;

  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion', 'businessos.data-subject-export-candidate.v1',
    'generatedAt', pg_catalog.now(),
    'request', pg_catalog.jsonb_build_object(
      'id', v_request.id,
      'requestReference', v_request.request_reference,
      'requestType', v_request.request_type::text,
      'subjectName', v_request.subject_name,
      'receivedAt', v_request.received_at,
      'dueAt', COALESCE(v_request.extended_due_at, v_request.due_at)
    ),
    'reviewControl', pg_catalog.jsonb_build_object(
      'candidateOnly', true,
      'requiresHumanReview', true,
      'automaticallyDelivered', false,
      'scopeNotice', 'Review identity, third-party information, legal privilege, exemptions and completeness before disclosure.'
    ),
    'clients', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', client.id, 'clientNumber', client.client_number,
        'kind', client.kind::text, 'status', client.status::text,
        'displayName', client.display_name, 'firstName', client.first_name,
        'lastName', client.last_name, 'organisationName', client.organisation_name,
        'email', client.email, 'phone', client.phone,
        'dateOfBirth', client.date_of_birth, 'nationality', client.nationality,
        'countryOfResidenceCode', client.country_of_residence_code,
        'address', pg_catalog.jsonb_build_object(
          'line1', client.address_line_1, 'line2', client.address_line_2,
          'city', client.city, 'region', client.region,
          'postalCode', client.postal_code,
          'countryCode', client.address_country_code
        ),
        'preferredLanguage', client.preferred_language,
        'preferredCommunication', client.preferred_communication::text,
        'processingLawfulBasis', client.processing_lawful_basis::text,
        'privacyNoticeVersion', client.privacy_notice_version,
        'privacyNoticeAcknowledgedAt', client.privacy_notice_acknowledged_at,
        'marketingConsent', client.marketing_consent,
        'createdAt', client.created_at, 'updatedAt', client.updated_at
      ) ORDER BY client.created_at)
      FROM public.clients AS client
      WHERE client.organisation_id = v_org AND client.id = ANY(v_client_ids)
    ), '[]'::jsonb),
    'enquiries', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', enquiry.id, 'name', pg_catalog.btrim(
          enquiry.first_name || ' ' || COALESCE(enquiry.last_name, '')
        ),
        'email', enquiry.email, 'phone', enquiry.phone,
        'country', enquiry.country, 'serviceType', enquiry.service_type,
        'message', enquiry.message, 'source', enquiry.source,
        'status', enquiry.status::text, 'priority', enquiry.priority::text,
        'createdAt', enquiry.created_at, 'updatedAt', enquiry.updated_at
      ) ORDER BY enquiry.created_at)
      FROM public.enquiries AS enquiry
      WHERE enquiry.organisation_id = v_org AND enquiry.deleted_at IS NULL
        AND (
          (v_request.subject_email IS NOT NULL
            AND lower(enquiry.email) = lower(v_request.subject_email))
          OR (v_request.subject_phone IS NOT NULL
            AND enquiry.phone = v_request.subject_phone)
          OR enquiry.id IN (
            SELECT client.source_enquiry_id FROM public.clients AS client
            WHERE client.id = ANY(v_client_ids)
              AND client.source_enquiry_id IS NOT NULL
          )
        )
    ), '[]'::jsonb),
    'matters', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', matter.id, 'matterNumber', matter.matter_number,
        'title', matter.title, 'description', matter.description,
        'serviceType', matter.service_type, 'status', matter.status::text,
        'priority', matter.priority::text,
        'nextActionSummary', matter.next_action_summary,
        'nextActionAt', matter.next_action_at,
        'criticalDeadlineAt', matter.critical_deadline_at,
        'openedAt', matter.opened_at, 'closedAt', matter.closed_at,
        'closureReason', matter.closure_reason, 'outcome', matter.outcome,
        'createdAt', matter.created_at, 'updatedAt', matter.updated_at
      ) ORDER BY matter.created_at)
      FROM public.matters AS matter
      WHERE matter.organisation_id = v_org AND matter.id = ANY(v_matter_ids)
        AND matter.deleted_at IS NULL
    ), '[]'::jsonb),
    'documentMetadata', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', document_record.id, 'matterId', document_record.matter_id,
        'title', document_record.title, 'category', document_record.category::text,
        'status', document_record.status::text,
        'clientVisible', document_record.client_visible,
        'expiresAt', document_record.expires_at,
        'createdAt', document_record.created_at
      ) ORDER BY document_record.created_at)
      FROM public.matter_documents AS document_record
      WHERE document_record.organisation_id = v_org
        AND document_record.matter_id = ANY(v_matter_ids)
        AND document_record.deleted_at IS NULL
    ), '[]'::jsonb),
    'communications', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', message.id, 'conversationId', message.conversation_id,
        'matterId', message.matter_id, 'clientId', message.client_id,
        'channel', message.channel::text, 'direction', message.direction::text,
        'senderAddress', message.sender_address,
        'recipientAddresses', message.recipient_addresses,
        'subject', message.subject, 'bodyText', message.body_text,
        'status', message.status::text, 'sentAt', message.sent_at,
        'deliveredAt', message.delivered_at, 'readAt', message.read_at,
        'createdAt', message.created_at
      ) ORDER BY message.created_at)
      FROM public.communication_messages AS message
      WHERE message.organisation_id = v_org
        AND (message.client_id = ANY(v_client_ids)
          OR message.matter_id = ANY(v_matter_ids))
    ), '[]'::jsonb),
    'financialDocuments', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', document_record.id,
        'documentType', document_record.document_type::text,
        'status', document_record.status::text,
        'documentNumber', document_record.document_number,
        'currencyCode', document_record.currency_code,
        'issueDate', document_record.issue_date, 'dueDate', document_record.due_date,
        'reference', document_record.reference,
        'subtotalMinor', document_record.subtotal_minor::text,
        'taxMinor', document_record.tax_minor::text,
        'totalMinor', document_record.total_minor::text,
        'balanceMinor', document_record.balance_minor::text,
        'createdAt', document_record.created_at
      ) ORDER BY document_record.created_at)
      FROM public.finance_documents AS document_record
      WHERE document_record.organisation_id = v_org
        AND document_record.client_id = ANY(v_client_ids)
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', payment.id, 'paymentNumber', payment.payment_number,
        'paymentType', payment.payment_type::text, 'method', payment.method::text,
        'status', payment.status::text, 'currencyCode', payment.currency_code,
        'amountMinor', payment.amount_minor::text,
        'occurredAt', payment.occurred_at, 'reference', payment.reference,
        'provider', payment.provider, 'providerReference', payment.provider_reference
      ) ORDER BY payment.occurred_at)
      FROM public.finance_payments AS payment
      WHERE payment.organisation_id = v_org
        AND payment.client_id = ANY(v_client_ids)
    ), '[]'::jsonb)
  );

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'data_subject_request.export_candidate_generated',
    'data_subject_request', v_request.id::text, NULL,
    pg_catalog.jsonb_build_object(
      'requestReference', v_request.request_reference,
      'candidateGenerated', true,
      'automaticallyDelivered', false,
      'matchedClientCount', cardinality(v_client_ids),
      'matchedMatterCount', cardinality(v_matter_ids)
    ),
    pg_catalog.jsonb_build_object('humanDisclosureReviewRequired', true)
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.create_privacy_incident(
  p_title text,
  p_description text,
  p_severity public.privacy_incident_severity,
  p_personal_data_breach boolean,
  p_discovered_at timestamptz,
  p_data_categories text[],
  p_approximate_people_affected integer,
  p_owner_user_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_id uuid := pg_catalog.gen_random_uuid();
  v_reference text;
  v_deadline timestamptz;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'incidents.manage') THEN
    RAISE EXCEPTION 'AAL2 incident-management authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_title IS NULL OR char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 3 AND 240
    OR p_description IS NULL
    OR char_length(pg_catalog.btrim(p_description)) NOT BETWEEN 20 AND 8000
    OR p_severity IS NULL OR p_personal_data_breach IS NULL
    OR p_discovered_at IS NULL
    OR p_discovered_at > pg_catalog.now() + interval '1 minute'
    OR p_data_categories IS NULL OR cardinality(p_data_categories) > 30
    OR p_approximate_people_affected IS NULL
    OR p_approximate_people_affected NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Privacy incident information is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_owner_user_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organisation_memberships AS membership
    WHERE membership.organisation_id = v_org
      AND membership.user_profile_id = p_owner_user_profile_id
      AND membership.status = 'ACTIVE' AND membership.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Incident owner is not an active member' USING ERRCODE = 'P0002';
  END IF;

  v_reference := 'INC-' || pg_catalog.to_char(p_discovered_at, 'YYYYMM') || '-'
    || upper(substr(replace(v_id::text, '-', ''), 1, 10));
  v_deadline := CASE WHEN p_personal_data_breach
    THEN p_discovered_at + interval '72 hours' ELSE NULL END;

  INSERT INTO public.privacy_incidents (
    id, organisation_id, incident_reference, title, description,
    severity, status, personal_data_breach, data_categories,
    approximate_people_affected, discovered_at, notification_deadline_at,
    owner_user_profile_id, created_by_user_profile_id,
    updated_by_user_profile_id
  ) VALUES (
    v_id, v_org, v_reference, pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_description), p_severity, 'OPEN',
    p_personal_data_breach,
    ARRAY(
      SELECT DISTINCT left(pg_catalog.btrim(category), 160)
      FROM unnest(p_data_categories) AS category
      WHERE pg_catalog.btrim(category) <> ''
      ORDER BY 1
    )::varchar(160)[],
    p_approximate_people_affected, p_discovered_at, v_deadline,
    COALESCE(p_owner_user_profile_id, v_user), v_user, v_user
  );

  INSERT INTO public.privacy_incident_events (
    organisation_id, incident_id, from_status, to_status, severity,
    notification_decision, note, actor_user_profile_id
  ) VALUES (
    v_org, v_id, NULL, 'OPEN', p_severity, 'UNASSESSED',
    'Privacy incident recorded and the notification assessment clock started where applicable.',
    v_user
  );

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'privacy_incident.created', 'privacy_incident', v_id::text,
    NULL,
    pg_catalog.jsonb_build_object(
      'incidentReference', v_reference, 'severity', p_severity::text,
      'status', 'OPEN', 'personalDataBreach', p_personal_data_breach,
      'notificationDeadlineAt', v_deadline,
      'approximatePeopleAffected', p_approximate_people_affected
    ),
    pg_catalog.jsonb_build_object('notificationDecision', 'UNASSESSED')
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'incidentReference', v_reference,
    'status', 'OPEN', 'severity', p_severity::text,
    'personalDataBreach', p_personal_data_breach,
    'notificationDecision', 'UNASSESSED',
    'notificationDeadlineAt', v_deadline, 'version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.update_privacy_incident(
  p_incident_id uuid,
  p_status public.privacy_incident_status,
  p_severity public.privacy_incident_severity,
  p_personal_data_breach boolean,
  p_notification_decision public.breach_notification_decision,
  p_contained_at timestamptz,
  p_risk_assessment text,
  p_resolution text,
  p_ico_reference text,
  p_subject_notification_evidence text,
  p_event_note text,
  p_evidence_reference text,
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
  v_incident public.privacy_incidents%ROWTYPE;
  v_allowed boolean := false;
  v_ico_reference text;
  v_subject_evidence text;
  v_ico_notified_at timestamptz;
  v_subjects_notified_at timestamptz;
  v_resolved_at timestamptz;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'incidents.manage') THEN
    RAISE EXCEPTION 'AAL2 incident-management authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_incident_id IS NULL OR p_status IS NULL OR p_severity IS NULL
    OR p_personal_data_breach IS NULL OR p_notification_decision IS NULL
    OR p_risk_assessment IS NULL
    OR char_length(pg_catalog.btrim(p_risk_assessment)) NOT BETWEEN 20 AND 8000
    OR p_event_note IS NULL
    OR char_length(pg_catalog.btrim(p_event_note)) NOT BETWEEN 10 AND 4000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Privacy incident update is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_incident
  FROM public.privacy_incidents AS incident
  WHERE incident.id = p_incident_id AND incident.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Privacy incident was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_incident.version <> p_expected_version THEN
    RAISE EXCEPTION 'Privacy incident changed; refresh before retrying'
      USING ERRCODE = '40001';
  END IF;
  IF v_incident.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Closed privacy incidents are immutable'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  v_allowed := p_status = v_incident.status OR CASE v_incident.status
    WHEN 'OPEN' THEN p_status IN (
      'CONTAINING', 'INVESTIGATING', 'NOTIFICATION_DECISION', 'RESOLVED'
    )
    WHEN 'CONTAINING' THEN p_status IN (
      'INVESTIGATING', 'NOTIFICATION_DECISION', 'RESOLVED'
    )
    WHEN 'INVESTIGATING' THEN p_status IN (
      'CONTAINING', 'NOTIFICATION_DECISION', 'RESOLVED'
    )
    WHEN 'NOTIFICATION_DECISION' THEN p_status IN ('INVESTIGATING', 'RESOLVED')
    WHEN 'RESOLVED' THEN p_status IN ('INVESTIGATING', 'CLOSED')
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Privacy incident transition is not permitted'
      USING ERRCODE = '22023';
  END IF;
  IF v_incident.personal_data_breach
    AND NOT p_personal_data_breach
    AND v_incident.notification_decision IN (
      'ICO_REQUIRED', 'ICO_NOTIFIED', 'SUBJECTS_REQUIRED', 'SUBJECTS_NOTIFIED'
    ) THEN
    RAISE EXCEPTION 'A notified breach cannot be reclassified as non-breach'
      USING ERRCODE = '22023';
  END IF;
  IF NOT p_personal_data_breach
    AND p_notification_decision NOT IN ('UNASSESSED', 'NOT_REPORTABLE') THEN
    RAISE EXCEPTION 'Non-breach incidents cannot require breach notification'
      USING ERRCODE = '22023';
  END IF;

  v_ico_reference := COALESCE(
    nullif(pg_catalog.btrim(p_ico_reference), ''), v_incident.ico_reference
  );
  v_subject_evidence := COALESCE(
    nullif(pg_catalog.btrim(p_subject_notification_evidence), ''),
    v_incident.subject_notification_evidence
  );
  v_ico_notified_at := CASE
    WHEN p_notification_decision = 'ICO_NOTIFIED'
      THEN COALESCE(v_incident.ico_notified_at, pg_catalog.now())
    ELSE v_incident.ico_notified_at
  END;
  v_subjects_notified_at := CASE
    WHEN p_notification_decision = 'SUBJECTS_NOTIFIED'
      THEN COALESCE(v_incident.subjects_notified_at, pg_catalog.now())
    ELSE v_incident.subjects_notified_at
  END;

  IF p_notification_decision = 'ICO_NOTIFIED'
    AND char_length(COALESCE(v_ico_reference, '')) < 3 THEN
    RAISE EXCEPTION 'ICO notification requires its submission reference'
      USING ERRCODE = '22023';
  END IF;
  IF p_notification_decision = 'SUBJECTS_NOTIFIED'
    AND char_length(COALESCE(v_subject_evidence, '')) < 8 THEN
    RAISE EXCEPTION 'Subject notification requires delivery evidence'
      USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('RESOLVED', 'CLOSED') THEN
    IF p_contained_at IS NULL
      OR char_length(pg_catalog.btrim(COALESCE(p_resolution, ''))) < 10
      OR (p_personal_data_breach AND p_notification_decision IN (
        'UNASSESSED', 'ICO_REQUIRED', 'SUBJECTS_REQUIRED'
      )) THEN
      RAISE EXCEPTION 'Incident resolution controls are incomplete'
        USING ERRCODE = '22023';
    END IF;
    v_resolved_at := COALESCE(v_incident.resolved_at, pg_catalog.now());
  ELSE
    v_resolved_at := NULL;
  END IF;

  UPDATE public.privacy_incidents
  SET status = p_status,
      severity = p_severity,
      personal_data_breach = p_personal_data_breach,
      notification_deadline_at = CASE WHEN p_personal_data_breach
        THEN COALESCE(notification_deadline_at, discovered_at + interval '72 hours')
        ELSE NULL END,
      contained_at = COALESCE(p_contained_at, contained_at),
      risk_assessment = pg_catalog.btrim(p_risk_assessment),
      notification_decision = p_notification_decision,
      ico_reference = v_ico_reference,
      ico_notified_at = v_ico_notified_at,
      subject_notification_evidence = v_subject_evidence,
      subjects_notified_at = v_subjects_notified_at,
      resolution = CASE WHEN p_status IN ('RESOLVED', 'CLOSED')
        THEN pg_catalog.btrim(p_resolution) ELSE resolution END,
      resolved_at = v_resolved_at,
      updated_by_user_profile_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_incident.id AND organisation_id = v_org;

  INSERT INTO public.privacy_incident_events (
    organisation_id, incident_id, from_status, to_status, severity,
    notification_decision, note, evidence_reference, actor_user_profile_id
  ) VALUES (
    v_org, v_incident.id, v_incident.status, p_status, p_severity,
    p_notification_decision, pg_catalog.btrim(p_event_note),
    nullif(pg_catalog.btrim(p_evidence_reference), ''), v_user
  );

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'privacy_incident.updated', 'privacy_incident',
    v_incident.id::text,
    pg_catalog.jsonb_build_object(
      'status', v_incident.status::text,
      'severity', v_incident.severity::text,
      'personalDataBreach', v_incident.personal_data_breach,
      'notificationDecision', v_incident.notification_decision::text,
      'version', v_incident.version
    ),
    pg_catalog.jsonb_build_object(
      'status', p_status::text, 'severity', p_severity::text,
      'personalDataBreach', p_personal_data_breach,
      'notificationDecision', p_notification_decision::text,
      'icoReferenceRecorded', v_ico_reference IS NOT NULL,
      'subjectNotificationEvidenceRecorded', v_subject_evidence IS NOT NULL,
      'version', v_incident.version + 1
    ),
    pg_catalog.jsonb_build_object('eventEvidenceRecorded', p_evidence_reference IS NOT NULL)
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_incident.id, 'incidentReference', v_incident.incident_reference,
    'status', p_status::text, 'severity', p_severity::text,
    'personalDataBreach', p_personal_data_breach,
    'notificationDecision', p_notification_decision::text,
    'notificationDeadlineAt', CASE WHEN p_personal_data_breach
      THEN COALESCE(v_incident.notification_deadline_at,
        v_incident.discovered_at + interval '72 hours') ELSE NULL END,
    'resolvedAt', v_resolved_at, 'version', v_incident.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.gate_n_resource_exists(
  p_organisation_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT CASE p_resource_type
    WHEN 'client' THEN EXISTS (
      SELECT 1 FROM public.clients AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    WHEN 'matter' THEN EXISTS (
      SELECT 1 FROM public.matters AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    WHEN 'matter_document' THEN EXISTS (
      SELECT 1 FROM public.matter_documents AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    WHEN 'communication_message' THEN EXISTS (
      SELECT 1 FROM public.communication_messages AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    WHEN 'finance_document' THEN EXISTS (
      SELECT 1 FROM public.finance_documents AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    WHEN 'enquiry' THEN EXISTS (
      SELECT 1 FROM public.enquiries AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    WHEN 'data_subject_request' THEN EXISTS (
      SELECT 1 FROM public.data_subject_requests AS record
      WHERE record.id = p_resource_id
        AND record.organisation_id = p_organisation_id
    )
    ELSE false
  END;
$function$;
ALTER FUNCTION private.gate_n_resource_exists(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gate_n_resource_exists(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.find_active_legal_hold(
  p_organisation_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT hold.id
  FROM public.legal_holds AS hold
  WHERE hold.organisation_id = p_organisation_id
    AND hold.released_at IS NULL
    AND hold.starts_at <= pg_catalog.now()
    AND (hold.expires_at IS NULL OR hold.expires_at > pg_catalog.now())
    AND (
      hold.scope_type = 'ORGANISATION'
      OR (hold.scope_type = 'CLIENT' AND (
        (p_resource_type = 'client' AND hold.scope_id = p_resource_id)
        OR EXISTS (
          SELECT 1 FROM public.matter_parties AS party
          WHERE party.organisation_id = p_organisation_id
            AND party.client_id = hold.scope_id
            AND party.deleted_at IS NULL
            AND (
              (p_resource_type = 'matter' AND party.matter_id = p_resource_id)
              OR (p_resource_type = 'matter_document' AND EXISTS (
                SELECT 1 FROM public.matter_documents AS document_record
                WHERE document_record.id = p_resource_id
                  AND document_record.organisation_id = p_organisation_id
                  AND document_record.matter_id = party.matter_id
              ))
              OR (p_resource_type = 'communication_message' AND EXISTS (
                SELECT 1 FROM public.communication_messages AS message
                WHERE message.id = p_resource_id
                  AND message.organisation_id = p_organisation_id
                  AND (message.client_id = hold.scope_id
                    OR message.matter_id = party.matter_id)
              ))
              OR (p_resource_type = 'finance_document' AND EXISTS (
                SELECT 1 FROM public.finance_documents AS finance_record
                WHERE finance_record.id = p_resource_id
                  AND finance_record.organisation_id = p_organisation_id
                  AND finance_record.client_id = hold.scope_id
              ))
            )
        )
        OR (p_resource_type = 'data_subject_request' AND EXISTS (
          SELECT 1 FROM public.data_subject_requests AS request_record
          WHERE request_record.id = p_resource_id
            AND request_record.organisation_id = p_organisation_id
            AND request_record.client_id = hold.scope_id
        ))
      ))
      OR (hold.scope_type = 'MATTER' AND (
        (p_resource_type = 'matter' AND hold.scope_id = p_resource_id)
        OR (p_resource_type = 'matter_document' AND EXISTS (
          SELECT 1 FROM public.matter_documents AS document_record
          WHERE document_record.id = p_resource_id
            AND document_record.organisation_id = p_organisation_id
            AND document_record.matter_id = hold.scope_id
        ))
        OR (p_resource_type = 'communication_message' AND EXISTS (
          SELECT 1 FROM public.communication_messages AS message
          WHERE message.id = p_resource_id
            AND message.organisation_id = p_organisation_id
            AND message.matter_id = hold.scope_id
        ))
        OR (p_resource_type = 'finance_document' AND EXISTS (
          SELECT 1 FROM public.finance_documents AS finance_record
          WHERE finance_record.id = p_resource_id
            AND finance_record.organisation_id = p_organisation_id
            AND finance_record.matter_id = hold.scope_id
        ))
      ))
      OR (hold.scope_type = 'DOCUMENT'
        AND p_resource_type = 'matter_document'
        AND hold.scope_id = p_resource_id)
    )
  ORDER BY CASE hold.scope_type
    WHEN 'ORGANISATION' THEN 1 WHEN 'CLIENT' THEN 2
    WHEN 'MATTER' THEN 3 ELSE 4 END, hold.created_at
  LIMIT 1;
$function$;
ALTER FUNCTION private.find_active_legal_hold(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.find_active_legal_hold(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.create_legal_hold(
  p_scope_type text,
  p_scope_id uuid,
  p_reason text,
  p_starts_at timestamptz,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'retention.manage') THEN
    RAISE EXCEPTION 'AAL2 retention authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_scope_type NOT IN ('ORGANISATION', 'CLIENT', 'MATTER', 'DOCUMENT')
    OR ((p_scope_type = 'ORGANISATION') <> (p_scope_id IS NULL))
    OR p_reason IS NULL
    OR char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 4000
    OR p_starts_at IS NULL
    OR (p_expires_at IS NOT NULL AND p_expires_at <= p_starts_at) THEN
    RAISE EXCEPTION 'Legal-hold information is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_scope_type = 'CLIENT' AND NOT private.gate_n_resource_exists(
    v_org, 'client', p_scope_id
  ) THEN
    RAISE EXCEPTION 'Legal-hold client was not found' USING ERRCODE = 'P0002';
  ELSIF p_scope_type = 'MATTER' AND NOT private.gate_n_resource_exists(
    v_org, 'matter', p_scope_id
  ) THEN
    RAISE EXCEPTION 'Legal-hold matter was not found' USING ERRCODE = 'P0002';
  ELSIF p_scope_type = 'DOCUMENT' AND NOT private.gate_n_resource_exists(
    v_org, 'matter_document', p_scope_id
  ) THEN
    RAISE EXCEPTION 'Legal-hold document was not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.legal_holds (
    organisation_id, scope_type, scope_id, reason, starts_at, expires_at,
    created_by_user_profile_id
  ) VALUES (
    v_org, p_scope_type, p_scope_id, pg_catalog.btrim(p_reason),
    p_starts_at, p_expires_at, v_user
  ) RETURNING id INTO v_id;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'legal_hold.created', 'legal_hold', v_id::text,
    NULL,
    pg_catalog.jsonb_build_object(
      'scopeType', p_scope_type, 'scopeId', p_scope_id,
      'startsAt', p_starts_at, 'expiresAt', p_expires_at,
      'active', true
    ),
    pg_catalog.jsonb_build_object('reasonRecorded', true)
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'scopeType', p_scope_type, 'scopeId', p_scope_id,
    'startsAt', p_starts_at, 'expiresAt', p_expires_at,
    'releasedAt', NULL, 'version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.release_legal_hold(
  p_hold_id uuid,
  p_release_reason text,
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
  v_hold public.legal_holds%ROWTYPE;
  v_released_at timestamptz := pg_catalog.now();
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'retention.manage') THEN
    RAISE EXCEPTION 'AAL2 retention authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_release_reason IS NULL
    OR char_length(pg_catalog.btrim(p_release_reason)) NOT BETWEEN 10 AND 4000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Legal-hold release is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_hold FROM public.legal_holds AS hold
  WHERE hold.id = p_hold_id AND hold.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legal hold was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_hold.version <> p_expected_version THEN
    RAISE EXCEPTION 'Legal hold changed; refresh before retrying'
      USING ERRCODE = '40001';
  END IF;
  IF v_hold.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'Legal hold has already been released'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE public.legal_holds
  SET released_at = v_released_at,
      release_reason = pg_catalog.btrim(p_release_reason),
      released_by_user_profile_id = v_user,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_hold.id AND organisation_id = v_org;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'legal_hold.released', 'legal_hold', v_hold.id::text,
    pg_catalog.jsonb_build_object('releasedAt', NULL, 'version', v_hold.version),
    pg_catalog.jsonb_build_object(
      'releasedAt', v_released_at, 'version', v_hold.version + 1
    ),
    pg_catalog.jsonb_build_object('releaseReasonRecorded', true)
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_hold.id, 'scopeType', v_hold.scope_type,
    'scopeId', v_hold.scope_id, 'releasedAt', v_released_at,
    'version', v_hold.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.upsert_retention_policy(
  p_policy_key text,
  p_name text,
  p_resource_type text,
  p_trigger_event text,
  p_retention_days integer,
  p_action public.retention_action,
  p_lawful_reason text,
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
  v_policy public.retention_policies%ROWTYPE;
  v_id uuid;
  v_version integer;
  v_created boolean := false;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'retention.manage') THEN
    RAISE EXCEPTION 'AAL2 retention authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_policy_key IS NULL
    OR p_policy_key !~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
    OR p_name IS NULL OR char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 2 AND 180
    OR p_resource_type IS NULL OR p_resource_type !~ '^[a-z][a-z0-9_]*$'
    OR p_resource_type NOT IN (
      'client', 'matter', 'matter_document', 'communication_message',
      'finance_document', 'enquiry', 'data_subject_request'
    )
    OR p_trigger_event IS NULL
    OR char_length(pg_catalog.btrim(p_trigger_event)) NOT BETWEEN 3 AND 160
    OR p_retention_days NOT BETWEEN 1 AND 36500
    OR p_action IS NULL OR p_lawful_reason IS NULL
    OR char_length(pg_catalog.btrim(p_lawful_reason)) NOT BETWEEN 10 AND 2000
    OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Retention policy is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_policy FROM public.retention_policies AS policy
  WHERE policy.organisation_id = v_org AND policy.policy_key = p_policy_key
  FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR v_policy.version <> p_expected_version THEN
      RAISE EXCEPTION 'Retention policy changed; refresh before retrying'
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.retention_policies
    SET name = pg_catalog.btrim(p_name),
        resource_type = p_resource_type,
        trigger_event = pg_catalog.btrim(p_trigger_event),
        retention_days = p_retention_days,
        action = p_action,
        lawful_reason = pg_catalog.btrim(p_lawful_reason),
        is_active = p_is_active,
        updated_by_user_profile_id = v_user,
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE id = v_policy.id AND organisation_id = v_org;
    v_id := v_policy.id;
    v_version := v_policy.version + 1;
  ELSE
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'New retention policy cannot include an expected version'
        USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.retention_policies (
      organisation_id, policy_key, name, resource_type, trigger_event,
      retention_days, action, lawful_reason, is_active,
      created_by_user_profile_id, updated_by_user_profile_id
    ) VALUES (
      v_org, p_policy_key, pg_catalog.btrim(p_name), p_resource_type,
      pg_catalog.btrim(p_trigger_event), p_retention_days, p_action,
      pg_catalog.btrim(p_lawful_reason), p_is_active, v_user, v_user
    ) RETURNING id, version INTO v_id, v_version;
    v_created := true;
  END IF;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'retention_policy.upserted', 'retention_policy', v_id::text,
    CASE WHEN v_created THEN NULL ELSE pg_catalog.jsonb_build_object(
      'resourceType', v_policy.resource_type,
      'retentionDays', v_policy.retention_days,
      'action', v_policy.action::text,
      'isActive', v_policy.is_active,
      'version', v_policy.version
    ) END,
    pg_catalog.jsonb_build_object(
      'policyKey', p_policy_key, 'resourceType', p_resource_type,
      'retentionDays', p_retention_days, 'action', p_action::text,
      'isActive', p_is_active, 'version', v_version
    ),
    pg_catalog.jsonb_build_object('lawfulReasonRecorded', true)
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'policyKey', p_policy_key, 'name', pg_catalog.btrim(p_name),
    'resourceType', p_resource_type, 'retentionDays', p_retention_days,
    'action', p_action::text, 'isActive', p_is_active,
    'created', v_created, 'version', v_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.create_retention_review(
  p_resource_type text,
  p_resource_id uuid,
  p_policy_id uuid,
  p_due_at timestamptz,
  p_owner_user_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_policy public.retention_policies%ROWTYPE;
  v_hold_id uuid;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'retention.manage') THEN
    RAISE EXCEPTION 'AAL2 retention authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_resource_type IS NULL OR p_resource_id IS NULL OR p_policy_id IS NULL
    OR p_due_at IS NULL THEN
    RAISE EXCEPTION 'Retention review information is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_policy FROM public.retention_policies AS policy
  WHERE policy.id = p_policy_id AND policy.organisation_id = v_org
    AND policy.is_active = true;
  IF NOT FOUND OR v_policy.resource_type <> p_resource_type THEN
    RAISE EXCEPTION 'Active matching retention policy was not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.gate_n_resource_exists(v_org, p_resource_type, p_resource_id) THEN
    RAISE EXCEPTION 'Retention resource was not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_owner_user_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organisation_memberships AS membership
    WHERE membership.organisation_id = v_org
      AND membership.user_profile_id = p_owner_user_profile_id
      AND membership.status = 'ACTIVE' AND membership.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Retention owner is not an active member' USING ERRCODE = 'P0002';
  END IF;

  v_hold_id := private.find_active_legal_hold(
    v_org, p_resource_type, p_resource_id
  );
  INSERT INTO public.retention_reviews (
    organisation_id, policy_id, resource_type, resource_id, status,
    due_at, legal_hold_id, owner_user_profile_id, created_by_user_profile_id
  ) VALUES (
    v_org, p_policy_id, p_resource_type, p_resource_id, 'DUE', p_due_at,
    v_hold_id, COALESCE(p_owner_user_profile_id, v_user), v_user
  ) RETURNING id INTO v_id;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'retention_review.created', 'retention_review', v_id::text,
    NULL,
    pg_catalog.jsonb_build_object(
      'policyId', p_policy_id, 'resourceType', p_resource_type,
      'resourceId', p_resource_id, 'dueAt', p_due_at,
      'legalHoldId', v_hold_id, 'status', 'DUE'
    ),
    pg_catalog.jsonb_build_object('destructiveActionExecuted', false)
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'policyId', p_policy_id, 'resourceType', p_resource_type,
    'resourceId', p_resource_id, 'status', 'DUE',
    'legalHoldId', v_hold_id, 'dueAt', p_due_at, 'version', 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.decide_retention_review(
  p_review_id uuid,
  p_status public.retention_review_status,
  p_decision public.retention_action,
  p_notes text,
  p_completion_evidence_reference text,
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
  v_review public.retention_reviews%ROWTYPE;
  v_policy public.retention_policies%ROWTYPE;
  v_hold_id uuid;
  v_effective_status public.retention_review_status;
  v_completed_at timestamptz;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'retention.manage') THEN
    RAISE EXCEPTION 'AAL2 retention authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_review_id IS NULL
    OR p_status NOT IN ('BLOCKED', 'APPROVED', 'COMPLETED', 'CANCELLED')
    OR p_decision IS NULL OR p_notes IS NULL
    OR char_length(pg_catalog.btrim(p_notes)) NOT BETWEEN 10 AND 4000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Retention decision is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_review FROM public.retention_reviews AS review
  WHERE review.id = p_review_id AND review.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retention review was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_review.version <> p_expected_version THEN
    RAISE EXCEPTION 'Retention review changed; refresh before retrying'
      USING ERRCODE = '40001';
  END IF;
  IF v_review.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Completed retention decisions are immutable'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_policy FROM public.retention_policies AS policy
  WHERE policy.id = v_review.policy_id AND policy.organisation_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retention policy was not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_status IN ('APPROVED', 'COMPLETED') AND p_decision <> v_policy.action THEN
    RAISE EXCEPTION 'Decision does not match the approved retention policy'
      USING ERRCODE = '22023';
  END IF;

  v_hold_id := private.find_active_legal_hold(
    v_org, v_review.resource_type, v_review.resource_id
  );
  v_effective_status := p_status;
  IF v_hold_id IS NOT NULL AND p_decision IN ('ARCHIVE', 'ANONYMISE', 'DELETE') THEN
    v_effective_status := 'BLOCKED';
  END IF;
  IF v_effective_status = 'COMPLETED'
    AND char_length(pg_catalog.btrim(
      COALESCE(p_completion_evidence_reference, '')
    )) < 8 THEN
    RAISE EXCEPTION 'Completed disposition requires execution evidence'
      USING ERRCODE = '22023';
  END IF;
  v_completed_at := CASE WHEN v_effective_status = 'COMPLETED'
    THEN pg_catalog.now() ELSE NULL END;

  UPDATE public.retention_reviews
  SET status = v_effective_status,
      decision = p_decision,
      legal_hold_id = v_hold_id,
      decision_notes = CASE WHEN v_effective_status = 'BLOCKED'
        AND v_hold_id IS NOT NULL
        THEN left(pg_catalog.btrim(p_notes)
          || ' Active legal hold prevents disposition.', 4000)
        ELSE pg_catalog.btrim(p_notes) END,
      completion_evidence_reference = CASE
        WHEN v_effective_status = 'COMPLETED'
          THEN pg_catalog.btrim(p_completion_evidence_reference)
        ELSE NULL END,
      decided_by_user_profile_id = v_user,
      decided_at = pg_catalog.now(),
      completed_at = v_completed_at,
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_review.id AND organisation_id = v_org;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'retention_review.decided', 'retention_review',
    v_review.id::text,
    pg_catalog.jsonb_build_object(
      'status', v_review.status::text, 'decision', v_review.decision::text,
      'version', v_review.version
    ),
    pg_catalog.jsonb_build_object(
      'status', v_effective_status::text, 'decision', p_decision::text,
      'legalHoldId', v_hold_id,
      'completionEvidenceRecorded', v_completed_at IS NOT NULL,
      'version', v_review.version + 1
    ),
    pg_catalog.jsonb_build_object(
      'destructiveActionExecutedByThisFunction', false,
      'legalHoldEnforced', v_hold_id IS NOT NULL
    )
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_review.id, 'status', v_effective_status::text,
    'decision', p_decision::text, 'legalHoldId', v_hold_id,
    'completedAt', v_completed_at,
    'executionEvidenceRecorded', v_completed_at IS NOT NULL,
    'version', v_review.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_assurance_evidence(
  p_evidence_key text,
  p_title text,
  p_category text,
  p_evidence_reference text,
  p_evidence_sha256 text,
  p_assessor_name text,
  p_assessor_organisation text,
  p_scope jsonb,
  p_tested_at timestamptz,
  p_expires_at timestamptz,
  p_notes text,
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
  v_evidence public.assurance_evidence%ROWTYPE;
  v_id uuid;
  v_version integer;
  v_title text;
  v_category text;
  v_mandatory boolean := false;
  v_created boolean := false;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'assurance.manage') THEN
    RAISE EXCEPTION 'AAL2 assurance authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_evidence_key IS NULL
    OR p_evidence_key !~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
    OR p_title IS NULL OR char_length(pg_catalog.btrim(p_title)) NOT BETWEEN 2 AND 180
    OR p_category IS NULL OR p_category !~ '^[A-Z][A-Z0-9_]*$'
    OR p_evidence_reference IS NULL
    OR char_length(pg_catalog.btrim(p_evidence_reference)) NOT BETWEEN 8 AND 1000
    OR lower(p_evidence_sha256) !~ '^[a-f0-9]{64}$'
    OR p_assessor_name IS NULL
    OR char_length(pg_catalog.btrim(p_assessor_name)) NOT BETWEEN 2 AND 240
    OR p_scope IS NULL OR pg_catalog.jsonb_typeof(p_scope) <> 'object'
    OR p_tested_at IS NULL OR p_tested_at > pg_catalog.now() + interval '1 minute'
    OR p_expires_at IS NULL OR p_expires_at <= pg_catalog.now()
    OR p_expires_at <= p_tested_at
    OR p_notes IS NULL
    OR char_length(pg_catalog.btrim(p_notes)) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'Assurance evidence is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_scope = '{}'::jsonb THEN
    RAISE EXCEPTION 'Assurance evidence must identify its tested scope'
      USING ERRCODE = '22023';
  END IF;
  IF p_evidence_key IN (
    'backup.restore', 'security.penetration_test',
    'security.vulnerability_scan', 'operations.capacity_test',
    'operations.incident_tabletop', 'privacy.dpia', 'privacy.ropa',
    'privacy.processor_contracts', 'accessibility.wcag22',
    'acceptance.uk_pilot', 'providers.live_operations',
    'operations.monitoring_alerts'
  ) AND p_expires_at > p_tested_at + (CASE p_evidence_key
    WHEN 'backup.restore' THEN interval '120 days'
    WHEN 'security.vulnerability_scan' THEN interval '45 days'
    WHEN 'acceptance.uk_pilot' THEN interval '185 days'
    WHEN 'providers.live_operations' THEN interval '100 days'
    WHEN 'operations.monitoring_alerts' THEN interval '100 days'
    ELSE interval '370 days'
  END) THEN
    RAISE EXCEPTION 'Mandatory assurance evidence exceeds its maximum validity window'
      USING ERRCODE = '22023';
  END IF;
  IF p_evidence_key = 'security.penetration_test'
    AND char_length(pg_catalog.btrim(COALESCE(p_assessor_organisation, ''))) < 2 THEN
    RAISE EXCEPTION 'Independent penetration-test evidence requires the assessor organisation'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_evidence FROM public.assurance_evidence AS evidence
  WHERE evidence.organisation_id = v_org
    AND evidence.evidence_key = p_evidence_key
  FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR v_evidence.version <> p_expected_version THEN
      RAISE EXCEPTION 'Assurance evidence changed; refresh before retrying'
        USING ERRCODE = '40001';
    END IF;
    v_title := CASE WHEN v_evidence.mandatory
      THEN v_evidence.title ELSE pg_catalog.btrim(p_title) END;
    v_category := CASE WHEN v_evidence.mandatory
      THEN v_evidence.category ELSE p_category END;
    v_mandatory := v_evidence.mandatory;
    UPDATE public.assurance_evidence
    SET title = v_title,
        category = v_category,
        status = 'SUBMITTED',
        evidence_reference = pg_catalog.btrim(p_evidence_reference),
        evidence_sha256 = lower(p_evidence_sha256),
        assessor_name = pg_catalog.btrim(p_assessor_name),
        assessor_organisation = nullif(pg_catalog.btrim(p_assessor_organisation), ''),
        scope = p_scope,
        tested_at = p_tested_at,
        expires_at = p_expires_at,
        notes = pg_catalog.btrim(p_notes),
        recorded_by_user_profile_id = v_user,
        reviewed_by_user_profile_id = NULL,
        reviewed_at = NULL,
        review_note = NULL,
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE id = v_evidence.id AND organisation_id = v_org;
    v_id := v_evidence.id;
    v_version := v_evidence.version + 1;
  ELSE
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'New assurance evidence cannot include an expected version'
        USING ERRCODE = '22023';
    END IF;
    v_title := pg_catalog.btrim(p_title);
    v_category := p_category;
    INSERT INTO public.assurance_evidence (
      organisation_id, evidence_key, title, category, mandatory, status,
      evidence_reference, evidence_sha256, assessor_name,
      assessor_organisation, scope, tested_at, expires_at, notes,
      recorded_by_user_profile_id
    ) VALUES (
      v_org, p_evidence_key, v_title, v_category, false, 'SUBMITTED',
      pg_catalog.btrim(p_evidence_reference), lower(p_evidence_sha256),
      pg_catalog.btrim(p_assessor_name),
      nullif(pg_catalog.btrim(p_assessor_organisation), ''), p_scope,
      p_tested_at, p_expires_at, pg_catalog.btrim(p_notes), v_user
    ) RETURNING id, version INTO v_id, v_version;
    v_created := true;
  END IF;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'assurance_evidence.submitted',
    'assurance_evidence', v_id::text,
    CASE WHEN v_created THEN NULL ELSE pg_catalog.jsonb_build_object(
      'status', v_evidence.status::text,
      'evidenceSha256', v_evidence.evidence_sha256,
      'expiresAt', v_evidence.expires_at,
      'version', v_evidence.version
    ) END,
    pg_catalog.jsonb_build_object(
      'evidenceKey', p_evidence_key, 'status', 'SUBMITTED',
      'evidenceSha256', lower(p_evidence_sha256),
      'testedAt', p_tested_at, 'expiresAt', p_expires_at,
      'mandatory', v_mandatory, 'version', v_version
    ),
    pg_catalog.jsonb_build_object(
      'evidenceReferenceRecorded', true,
      'independentReviewRequired', true,
      'evidenceBodyStoredInDatabase', false
    )
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'evidenceKey', p_evidence_key,
    'title', v_title, 'category', v_category,
    'mandatory', v_mandatory, 'status', 'SUBMITTED',
    'evidenceSha256', lower(p_evidence_sha256),
    'testedAt', p_tested_at, 'expiresAt', p_expires_at,
    'created', v_created, 'version', v_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.review_assurance_evidence(
  p_evidence_id uuid,
  p_status public.assurance_evidence_status,
  p_review_note text,
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
  v_evidence public.assurance_evidence%ROWTYPE;
  v_reviewed_at timestamptz := pg_catalog.now();
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'assurance.manage') THEN
    RAISE EXCEPTION 'AAL2 assurance authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('PASS', 'FAIL', 'BLOCKED')
    OR p_review_note IS NULL
    OR char_length(pg_catalog.btrim(p_review_note)) NOT BETWEEN 10 AND 4000
    OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Assurance review is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_evidence FROM public.assurance_evidence AS evidence
  WHERE evidence.id = p_evidence_id AND evidence.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assurance evidence was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_evidence.version <> p_expected_version THEN
    RAISE EXCEPTION 'Assurance evidence changed; refresh before retrying'
      USING ERRCODE = '40001';
  END IF;
  IF v_evidence.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Only submitted evidence can be reviewed'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_evidence.recorded_by_user_profile_id = v_user THEN
    RAISE EXCEPTION 'Evidence must be reviewed by a different AAL2 user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status = 'PASS' AND v_evidence.expires_at <= v_reviewed_at THEN
    RAISE EXCEPTION 'Expired evidence cannot pass review' USING ERRCODE = '22023';
  END IF;

  UPDATE public.assurance_evidence
  SET status = p_status,
      reviewed_by_user_profile_id = v_user,
      reviewed_at = v_reviewed_at,
      review_note = pg_catalog.btrim(p_review_note),
      version = version + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_evidence.id AND organisation_id = v_org;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'assurance_evidence.reviewed',
    'assurance_evidence', v_evidence.id::text,
    pg_catalog.jsonb_build_object(
      'status', v_evidence.status::text, 'version', v_evidence.version
    ),
    pg_catalog.jsonb_build_object(
      'status', p_status::text, 'reviewedAt', v_reviewed_at,
      'version', v_evidence.version + 1
    ),
    pg_catalog.jsonb_build_object(
      'evidenceKey', v_evidence.evidence_key,
      'separationOfDutiesEnforced', true,
      'evidenceSha256', v_evidence.evidence_sha256
    )
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_evidence.id, 'evidenceKey', v_evidence.evidence_key,
    'status', p_status::text, 'reviewedAt', v_reviewed_at,
    'reviewedByCurrentUser', true, 'version', v_evidence.version + 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.decide_production_release(
  p_release_reference text,
  p_environment text,
  p_decision public.release_decision_status,
  p_rationale text,
  p_change_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_blockers jsonb;
  v_evidence jsonb;
  v_id uuid;
  v_decided_at timestamptz := pg_catalog.now();
  v_prior_approved boolean;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR private.current_aal() <> 'AAL2'
    OR NOT private.has_organisation_permission(v_org, 'release.approve') THEN
    RAISE EXCEPTION 'AAL2 release authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_release_reference IS NULL
    OR p_release_reference !~ '^[A-Za-z0-9][A-Za-z0-9._-]{6,127}$'
    OR p_environment NOT IN ('PRODUCTION', 'STAGING')
    OR p_decision IS NULL OR p_rationale IS NULL
    OR char_length(pg_catalog.btrim(p_rationale)) NOT BETWEEN 20 AND 4000 THEN
    RAISE EXCEPTION 'Production release decision is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_org::text || ':' || p_release_reference
      || ':' || p_environment, 0)
  );
  v_blockers := private.get_production_release_blockers(v_org, v_user);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'evidenceKey', evidence.evidence_key,
    'status', CASE WHEN evidence.status = 'PASS'
      AND evidence.expires_at <= pg_catalog.now() THEN 'EXPIRED'
      ELSE evidence.status::text END,
    'evidenceSha256', evidence.evidence_sha256,
    'testedAt', evidence.tested_at, 'expiresAt', evidence.expires_at,
    'recordedByUserId', evidence.recorded_by_user_profile_id,
    'reviewedByUserId', evidence.reviewed_by_user_profile_id,
    'reviewedAt', evidence.reviewed_at, 'version', evidence.version
  ) ORDER BY evidence.evidence_key), '[]'::jsonb)
  INTO v_evidence
  FROM public.assurance_evidence AS evidence
  WHERE evidence.organisation_id = v_org AND evidence.mandatory = true;

  SELECT COALESCE((
    SELECT decision.decision = 'APPROVED'
    FROM public.production_release_decisions AS decision
    WHERE decision.organisation_id = v_org
      AND decision.release_reference = p_release_reference
      AND decision.environment = p_environment
    ORDER BY decision.decided_at DESC, decision.id DESC
    LIMIT 1
  ), false) INTO v_prior_approved;

  IF p_decision = 'APPROVED' AND pg_catalog.jsonb_array_length(v_blockers) > 0 THEN
    RAISE EXCEPTION 'Production release is blocked by unresolved controls'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_decision = 'APPROVED' AND v_prior_approved THEN
    RAISE EXCEPTION 'This production release is already approved'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_decision = 'REVOKED' AND NOT v_prior_approved THEN
    RAISE EXCEPTION 'Only an active approved release can be revoked'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO public.production_release_decisions (
    organisation_id, release_reference, environment, decision, rationale,
    change_reference, blocker_snapshot, evidence_snapshot,
    decided_by_user_profile_id, assurance_level, decided_at
  ) VALUES (
    v_org, p_release_reference, p_environment, p_decision,
    pg_catalog.btrim(p_rationale),
    nullif(pg_catalog.btrim(p_change_reference), ''),
    v_blockers, v_evidence, v_user,
    'AAL2'::public.authentication_assurance_level, v_decided_at
  ) RETURNING id INTO v_id;

  PERFORM private.record_gate_n_audit(
    v_org, v_user, 'production_release.decided',
    'production_release_decision', v_id::text, NULL,
    pg_catalog.jsonb_build_object(
      'releaseReference', p_release_reference,
      'environment', p_environment, 'decision', p_decision::text,
      'changeReferenceRecorded', p_change_reference IS NOT NULL,
      'blockerCount', pg_catalog.jsonb_array_length(v_blockers),
      'evidenceSnapshotCount', pg_catalog.jsonb_array_length(v_evidence),
      'decidedAt', v_decided_at
    ),
    pg_catalog.jsonb_build_object(
      'separationOfDutiesEvaluated', true,
      'immutableSnapshotRecorded', true
    )
  );
  RETURN pg_catalog.jsonb_build_object(
    'id', v_id, 'releaseReference', p_release_reference,
    'environment', p_environment, 'decision', p_decision::text,
    'eligibleAtDecision', pg_catalog.jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers, 'decidedAt', v_decided_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.get_compliance_assurance_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_can_manage_rights boolean;
  v_can_read_incidents boolean;
  v_can_manage_incidents boolean;
  v_can_read_retention boolean;
  v_can_manage_retention boolean;
  v_can_read_assurance boolean;
  v_can_manage_assurance boolean;
  v_can_approve_release boolean;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR NOT private.has_organisation_permission(v_org, 'compliance.read') THEN
    RAISE EXCEPTION 'Compliance dashboard authority is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_can_manage_rights := private.has_organisation_permission(
    v_org, 'compliance.manage'
  ) AND private.current_aal() = 'AAL2';
  v_can_read_incidents := private.has_organisation_permission(
    v_org, 'incidents.read'
  );
  v_can_manage_incidents := private.has_organisation_permission(
    v_org, 'incidents.manage'
  ) AND private.current_aal() = 'AAL2';
  v_can_read_retention := private.has_organisation_permission(
    v_org, 'retention.read'
  );
  v_can_manage_retention := private.has_organisation_permission(
    v_org, 'retention.manage'
  ) AND private.current_aal() = 'AAL2';
  v_can_read_assurance := private.has_organisation_permission(
    v_org, 'assurance.read'
  );
  v_can_manage_assurance := private.has_organisation_permission(
    v_org, 'assurance.manage'
  ) AND private.current_aal() = 'AAL2';
  v_can_approve_release := private.has_organisation_permission(
    v_org, 'release.approve'
  ) AND private.current_aal() = 'AAL2';
  IF v_can_read_assurance THEN
    v_blockers := private.get_production_release_blockers(v_org, v_user);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'access', pg_catalog.jsonb_build_object(
      'assuranceLevel', private.current_aal(),
      'rightsManage', v_can_manage_rights,
      'incidentsRead', v_can_read_incidents,
      'incidentsManage', v_can_manage_incidents,
      'retentionRead', v_can_read_retention,
      'retentionManage', v_can_manage_retention,
      'assuranceRead', v_can_read_assurance,
      'assuranceManage', v_can_manage_assurance,
      'releaseApprove', v_can_approve_release
    ),
    'summary', pg_catalog.jsonb_build_object(
      'openRights', (
        SELECT count(*)::integer FROM public.data_subject_requests AS request_record
        WHERE request_record.organisation_id = v_org
          AND request_record.status NOT IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
      ),
      'rightsDueSevenDays', (
        SELECT count(*)::integer FROM public.data_subject_requests AS request_record
        WHERE request_record.organisation_id = v_org
          AND request_record.status NOT IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
          AND COALESCE(request_record.extended_due_at, request_record.due_at)
            <= pg_catalog.now() + interval '7 days'
      ),
      'rightsOverdue', (
        SELECT count(*)::integer FROM public.data_subject_requests AS request_record
        WHERE request_record.organisation_id = v_org
          AND request_record.status NOT IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
          AND COALESCE(request_record.extended_due_at, request_record.due_at)
            < pg_catalog.now()
      ),
      'openIncidents', CASE WHEN v_can_read_incidents THEN (
        SELECT count(*)::integer FROM public.privacy_incidents AS incident
        WHERE incident.organisation_id = v_org
          AND incident.status NOT IN ('RESOLVED', 'CLOSED')
      ) ELSE 0 END,
      'notificationClocks', CASE WHEN v_can_read_incidents THEN (
        SELECT count(*)::integer FROM public.privacy_incidents AS incident
        WHERE incident.organisation_id = v_org
          AND incident.personal_data_breach = true
          AND incident.status <> 'CLOSED'
          AND incident.notification_decision IN (
            'UNASSESSED', 'ICO_REQUIRED', 'SUBJECTS_REQUIRED'
          )
      ) ELSE 0 END,
      'dueRetentionReviews', CASE WHEN v_can_read_retention THEN (
        SELECT count(*)::integer FROM public.retention_reviews AS review
        WHERE review.organisation_id = v_org
          AND review.status IN ('DUE', 'IN_REVIEW', 'BLOCKED')
      ) ELSE 0 END,
      'activeLegalHolds', CASE WHEN v_can_read_retention THEN (
        SELECT count(*)::integer FROM public.legal_holds AS hold
        WHERE hold.organisation_id = v_org AND hold.released_at IS NULL
          AND hold.starts_at <= pg_catalog.now()
          AND (hold.expires_at IS NULL OR hold.expires_at > pg_catalog.now())
      ) ELSE 0 END,
      'mandatoryEvidencePassed', CASE WHEN v_can_read_assurance THEN (
        SELECT count(*)::integer FROM public.assurance_evidence AS evidence
        WHERE evidence.organisation_id = v_org AND evidence.mandatory = true
          AND evidence.status = 'PASS' AND evidence.expires_at > pg_catalog.now()
      ) ELSE 0 END,
      'mandatoryEvidenceTotal', CASE WHEN v_can_read_assurance THEN (
        SELECT count(*)::integer FROM public.assurance_evidence AS evidence
        WHERE evidence.organisation_id = v_org AND evidence.mandatory = true
      ) ELSE 0 END,
      'releaseBlockerCount', pg_catalog.jsonb_array_length(v_blockers),
      'releaseEligible', v_can_read_assurance
        AND pg_catalog.jsonb_array_length(v_blockers) = 0
    ),
    'rights', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(right_item))
      FROM (
        SELECT
          request_record.id, request_record.request_reference AS "requestReference",
          request_record.request_type::text AS "requestType",
          request_record.status::text AS status,
          request_record.identity_status::text AS "identityStatus",
          request_record.subject_name AS "subjectName",
          request_record.subject_email AS "subjectEmail",
          request_record.subject_phone AS "subjectPhone",
          request_record.client_id AS "clientId",
          request_record.request_details AS "requestDetails",
          request_record.received_at AS "receivedAt",
          request_record.due_at AS "dueAt",
          request_record.extended_due_at AS "extendedDueAt",
          COALESCE(request_record.extended_due_at, request_record.due_at)
            AS "effectiveDueAt",
          floor(extract(epoch FROM (
            COALESCE(request_record.extended_due_at, request_record.due_at)
              - pg_catalog.now()
          )) / 86400)::integer AS "daysRemaining",
          request_record.owner_user_profile_id AS "ownerUserId",
          COALESCE(NULLIF(profile.display_name, ''), profile.email) AS "ownerName",
          request_record.response_reference AS "responseReference",
          request_record.completed_at AS "completedAt",
          request_record.version, request_record.updated_at AS "updatedAt"
        FROM public.data_subject_requests AS request_record
        LEFT JOIN public.user_profiles AS profile
          ON profile.id = request_record.owner_user_profile_id
        WHERE request_record.organisation_id = v_org
        ORDER BY
          CASE WHEN request_record.status IN ('COMPLETED', 'REFUSED', 'WITHDRAWN')
            THEN 1 ELSE 0 END,
          COALESCE(request_record.extended_due_at, request_record.due_at),
          request_record.created_at DESC
        LIMIT 60
      ) AS right_item
    ), '[]'::jsonb),
    'incidents', CASE WHEN v_can_read_incidents THEN COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(incident_item))
      FROM (
        SELECT
          incident.id, incident.incident_reference AS "incidentReference",
          incident.title, incident.description,
          incident.severity::text AS severity,
          incident.status::text AS status,
          incident.personal_data_breach AS "personalDataBreach",
          incident.data_categories AS "dataCategories",
          incident.approximate_people_affected AS "approximatePeopleAffected",
          incident.discovered_at AS "discoveredAt",
          incident.notification_deadline_at AS "notificationDeadlineAt",
          CASE WHEN incident.notification_deadline_at IS NULL THEN NULL
            ELSE floor(extract(epoch FROM (
              incident.notification_deadline_at - pg_catalog.now()
            )) / 3600)::integer END AS "notificationHoursRemaining",
          incident.contained_at AS "containedAt",
          incident.risk_assessment AS "riskAssessment",
          incident.notification_decision::text AS "notificationDecision",
          incident.ico_reference AS "icoReference",
          incident.ico_notified_at AS "icoNotifiedAt",
          incident.subject_notification_evidence AS "subjectNotificationEvidence",
          incident.subjects_notified_at AS "subjectsNotifiedAt",
          incident.resolution, incident.resolved_at AS "resolvedAt",
          incident.owner_user_profile_id AS "ownerUserId",
          COALESCE(NULLIF(profile.display_name, ''), profile.email) AS "ownerName",
          incident.version, incident.updated_at AS "updatedAt"
        FROM public.privacy_incidents AS incident
        LEFT JOIN public.user_profiles AS profile
          ON profile.id = incident.owner_user_profile_id
        WHERE incident.organisation_id = v_org
        ORDER BY
          CASE incident.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3 ELSE 4 END,
          CASE WHEN incident.status IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END,
          incident.discovered_at DESC
        LIMIT 50
      ) AS incident_item
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'retention', CASE WHEN v_can_read_retention THEN pg_catalog.jsonb_build_object(
      'policies', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(policy_item))
        FROM (
          SELECT policy.id, policy.policy_key AS "policyKey", policy.name,
            policy.resource_type AS "resourceType",
            policy.trigger_event AS "triggerEvent",
            policy.retention_days AS "retentionDays",
            policy.action::text AS action, policy.lawful_reason AS "lawfulReason",
            policy.is_active AS "isActive", policy.version,
            policy.updated_at AS "updatedAt"
          FROM public.retention_policies AS policy
          WHERE policy.organisation_id = v_org
          ORDER BY policy.is_active DESC, policy.resource_type, policy.name
        ) AS policy_item
      ), '[]'::jsonb),
      'reviews', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(review_item))
        FROM (
          SELECT review.id, review.policy_id AS "policyId",
            policy.name AS "policyName", review.resource_type AS "resourceType",
            review.resource_id AS "resourceId", review.status::text AS status,
            review.decision::text AS decision, review.due_at AS "dueAt",
            review.legal_hold_id AS "legalHoldId",
            review.owner_user_profile_id AS "ownerUserId",
            review.decision_notes AS "decisionNotes",
            review.completion_evidence_reference AS "completionEvidenceReference",
            review.decided_at AS "decidedAt", review.completed_at AS "completedAt",
            review.version, review.updated_at AS "updatedAt"
          FROM public.retention_reviews AS review
          JOIN public.retention_policies AS policy
            ON policy.id = review.policy_id
           AND policy.organisation_id = review.organisation_id
          WHERE review.organisation_id = v_org
          ORDER BY
            CASE review.status WHEN 'BLOCKED' THEN 1 WHEN 'DUE' THEN 2
              WHEN 'IN_REVIEW' THEN 3 ELSE 4 END,
            review.due_at, review.created_at DESC
          LIMIT 60
        ) AS review_item
      ), '[]'::jsonb),
      'legalHolds', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(hold_item))
        FROM (
          SELECT hold.id, hold.scope_type AS "scopeType",
            hold.scope_id AS "scopeId", hold.reason,
            hold.starts_at AS "startsAt", hold.expires_at AS "expiresAt",
            hold.released_at AS "releasedAt", hold.release_reason AS "releaseReason",
            hold.version, hold.updated_at AS "updatedAt"
          FROM public.legal_holds AS hold
          WHERE hold.organisation_id = v_org
          ORDER BY (hold.released_at IS NULL) DESC, hold.created_at DESC
          LIMIT 60
        ) AS hold_item
      ), '[]'::jsonb)
    ) ELSE pg_catalog.jsonb_build_object(
      'policies', '[]'::jsonb, 'reviews', '[]'::jsonb,
      'legalHolds', '[]'::jsonb
    ) END,
    'assurance', CASE WHEN v_can_read_assurance THEN pg_catalog.jsonb_build_object(
      'evidence', COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(evidence_item))
        FROM (
          SELECT evidence.id, evidence.evidence_key AS "evidenceKey",
            evidence.title, evidence.category, evidence.mandatory,
            evidence.status::text AS status,
            CASE WHEN evidence.status = 'PASS'
              AND evidence.expires_at <= pg_catalog.now() THEN 'EXPIRED'
              ELSE evidence.status::text END AS "effectiveStatus",
            evidence.evidence_reference AS "evidenceReference",
            evidence.evidence_sha256 AS "evidenceSha256",
            evidence.assessor_name AS "assessorName",
            evidence.assessor_organisation AS "assessorOrganisation",
            evidence.scope, evidence.tested_at AS "testedAt",
            evidence.expires_at AS "expiresAt", evidence.notes,
            evidence.recorded_by_user_profile_id AS "recordedByUserId",
            evidence.reviewed_by_user_profile_id AS "reviewedByUserId",
            evidence.reviewed_at AS "reviewedAt",
            evidence.review_note AS "reviewNote", evidence.version,
            evidence.updated_at AS "updatedAt"
          FROM public.assurance_evidence AS evidence
          WHERE evidence.organisation_id = v_org
          ORDER BY evidence.mandatory DESC, evidence.category, evidence.title
        ) AS evidence_item
      ), '[]'::jsonb),
      'blockers', v_blockers,
      'latestRelease', (
        SELECT pg_catalog.to_jsonb(latest_release)
        FROM (
          SELECT decision.id,
            decision.release_reference AS "releaseReference",
            decision.environment, decision.decision::text AS decision,
            decision.rationale, decision.change_reference AS "changeReference",
            decision.blocker_snapshot AS "blockerSnapshot",
            decision.decided_by_user_profile_id AS "decidedByUserId",
            decision.decided_at AS "decidedAt"
          FROM public.production_release_decisions AS decision
          WHERE decision.organisation_id = v_org
          ORDER BY decision.decided_at DESC, decision.id DESC
          LIMIT 1
        ) AS latest_release
      ),
      'releaseEligible', pg_catalog.jsonb_array_length(v_blockers) = 0,
      'certificationBoundary', 'BusinessOS records evidence and release decisions. Independent certification, penetration testing and production-provider evidence must come from the responsible external parties.'
    ) ELSE pg_catalog.jsonb_build_object(
      'evidence', '[]'::jsonb, 'blockers', '[]'::jsonb,
      'latestRelease', NULL, 'releaseEligible', false,
      'certificationBoundary', 'Assurance evidence permission is required.'
    ) END
  );
END;
$function$;
ALTER FUNCTION private.create_data_subject_request(
  public.data_subject_request_type, text, text, text, uuid, timestamptz,
  text, uuid
) OWNER TO postgres;
ALTER FUNCTION private.transition_data_subject_request(
  uuid, public.data_subject_request_status, public.identity_proof_status,
  text, text, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.extend_data_subject_request(
  uuid, timestamptz, text, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.build_data_subject_export_candidate(uuid)
  OWNER TO postgres;
ALTER FUNCTION private.create_privacy_incident(
  text, text, public.privacy_incident_severity, boolean, timestamptz,
  text[], integer, uuid
) OWNER TO postgres;
ALTER FUNCTION private.update_privacy_incident(
  uuid, public.privacy_incident_status, public.privacy_incident_severity,
  boolean, public.breach_notification_decision, timestamptz,
  text, text, text, text, text, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.create_legal_hold(
  text, uuid, text, timestamptz, timestamptz
) OWNER TO postgres;
ALTER FUNCTION private.release_legal_hold(uuid, text, integer)
  OWNER TO postgres;
ALTER FUNCTION private.upsert_retention_policy(
  text, text, text, text, integer, public.retention_action,
  text, boolean, integer
) OWNER TO postgres;
ALTER FUNCTION private.create_retention_review(
  text, uuid, uuid, timestamptz, uuid
) OWNER TO postgres;
ALTER FUNCTION private.decide_retention_review(
  uuid, public.retention_review_status, public.retention_action,
  text, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.record_assurance_evidence(
  text, text, text, text, text, text, text, jsonb,
  timestamptz, timestamptz, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.review_assurance_evidence(
  uuid, public.assurance_evidence_status, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.decide_production_release(
  text, text, public.release_decision_status, text, text
) OWNER TO postgres;
ALTER FUNCTION private.get_compliance_assurance_dashboard()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.create_data_subject_request(
  public.data_subject_request_type, text, text, text, uuid, timestamptz,
  text, uuid
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.transition_data_subject_request(
  uuid, public.data_subject_request_status, public.identity_proof_status,
  text, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.extend_data_subject_request(
  uuid, timestamptz, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.build_data_subject_export_candidate(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.create_privacy_incident(
  text, text, public.privacy_incident_severity, boolean, timestamptz,
  text[], integer, uuid
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.update_privacy_incident(
  uuid, public.privacy_incident_status, public.privacy_incident_severity,
  boolean, public.breach_notification_decision, timestamptz,
  text, text, text, text, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.create_legal_hold(
  text, uuid, text, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.release_legal_hold(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.upsert_retention_policy(
  text, text, text, text, integer, public.retention_action,
  text, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.create_retention_review(
  text, uuid, uuid, timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.decide_retention_review(
  uuid, public.retention_review_status, public.retention_action,
  text, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.record_assurance_evidence(
  text, text, text, text, text, text, text, jsonb,
  timestamptz, timestamptz, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.review_assurance_evidence(
  uuid, public.assurance_evidence_status, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.decide_production_release(
  text, text, public.release_decision_status, text, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.get_compliance_assurance_dashboard()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app,
       businessos_runtime, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.create_data_subject_request(
  public.data_subject_request_type, text, text, text, uuid, timestamptz,
  text, uuid
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.transition_data_subject_request(
  uuid, public.data_subject_request_status, public.identity_proof_status,
  text, text, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.extend_data_subject_request(
  uuid, timestamptz, text, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.build_data_subject_export_candidate(uuid)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.create_privacy_incident(
  text, text, public.privacy_incident_severity, boolean, timestamptz,
  text[], integer, uuid
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.update_privacy_incident(
  uuid, public.privacy_incident_status, public.privacy_incident_severity,
  boolean, public.breach_notification_decision, timestamptz,
  text, text, text, text, text, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.create_legal_hold(
  text, uuid, text, timestamptz, timestamptz
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.release_legal_hold(uuid, text, integer)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.upsert_retention_policy(
  text, text, text, text, integer, public.retention_action,
  text, boolean, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.create_retention_review(
  text, uuid, uuid, timestamptz, uuid
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.decide_retention_review(
  uuid, public.retention_review_status, public.retention_action,
  text, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.record_assurance_evidence(
  text, text, text, text, text, text, text, jsonb,
  timestamptz, timestamptz, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.review_assurance_evidence(
  uuid, public.assurance_evidence_status, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.decide_production_release(
  text, text, public.release_decision_status, text, text
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.get_compliance_assurance_dashboard()
  TO businessos_app;

COMMENT ON TABLE public.data_subject_requests IS
  'Tenant-scoped UK data-subject-rights workflow; due dates remain visible while on hold.';
COMMENT ON TABLE public.privacy_incidents IS
  'Privacy-incident register with a 72-hour assessment clock for recorded personal-data breaches.';
COMMENT ON TABLE public.assurance_evidence IS
  'Hashed evidence references with two-person review; evidence bodies remain in approved external storage.';
COMMENT ON TABLE public.production_release_decisions IS
  'Append-only AAL2 release decisions. APPROVED means registered controls passed; it is not third-party certification.';

COMMIT;
