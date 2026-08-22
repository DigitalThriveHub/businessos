-- BusinessOS deterministic workflow, SLA and approval foundation.
--
-- Security properties:
--   * every operational record is organisation-bound and forced through RLS;
--   * polymorphic subjects are validated against the existing enquiry/client/matter tables;
--   * workflow versions and approval decisions are append-only evidence;
--   * human work completion and approval decisions use narrow atomic functions;
--   * a bounded background function advances SLA risk, breach, escalation and expiry;
--   * the initial enquiry-response workflow is created atomically and idempotently.

DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'businessos_app'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'businessos_policy_reader'
  ) THEN
    RAISE EXCEPTION 'BusinessOS database roles must exist before workflow foundation';
  END IF;
END
$roles$;

CREATE TYPE public.automation_subject_type AS ENUM (
  'ENQUIRY', 'CLIENT', 'MATTER'
);
CREATE TYPE public.workflow_definition_status AS ENUM (
  'DRAFT', 'ACTIVE', 'RETIRED'
);
CREATE TYPE public.workflow_run_status AS ENUM (
  'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'
);
CREATE TYPE public.workflow_action_type AS ENUM (
  'SYSTEM', 'HUMAN_TASK', 'APPROVAL', 'TIMER'
);
CREATE TYPE public.workflow_action_status AS ENUM (
  'PENDING', 'READY', 'RUNNING', 'WAITING', 'SUCCEEDED',
  'FAILED', 'CANCELLED', 'DEAD_LETTER'
);
CREATE TYPE public.work_priority AS ENUM (
  'LOW', 'NORMAL', 'HIGH', 'URGENT'
);
CREATE TYPE public.sla_instance_status AS ENUM (
  'ACTIVE', 'AT_RISK', 'BREACHED', 'SATISFIED', 'CANCELLED'
);
CREATE TYPE public.escalation_event_status AS ENUM (
  'RECORDED', 'ACKNOWLEDGED', 'RESOLVED'
);
CREATE TYPE public.approval_request_status AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'
);
CREATE TYPE public.approval_decision_type AS ENUM (
  'APPROVED', 'REJECTED'
);
CREATE TYPE public.approval_risk_level AS ENUM (
  'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
);

CREATE TABLE public.workflow_definitions (
  id uuid CONSTRAINT pk_workflow_definitions PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  key varchar(120) NOT NULL,
  name varchar(180) NOT NULL,
  description text NOT NULL,
  subject_type public.automation_subject_type NOT NULL,
  trigger_event varchar(160) NOT NULL,
  status public.workflow_definition_status NOT NULL DEFAULT 'DRAFT',
  created_by_user_profile_id uuid,
  updated_by_user_profile_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz,
  CONSTRAINT fk_workflow_definitions_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_definitions_created_by
    FOREIGN KEY (created_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_definitions_updated_by
    FOREIGN KEY (updated_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT uq_workflow_definitions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_workflow_definitions_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_workflow_definitions_key
    CHECK (key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  CONSTRAINT ck_workflow_definitions_trigger
    CHECK (trigger_event ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  CONSTRAINT ck_workflow_definitions_name CHECK (btrim(name) <> ''),
  CONSTRAINT ck_workflow_definitions_description CHECK (btrim(description) <> '')
);

CREATE TABLE public.workflow_versions (
  id uuid CONSTRAINT pk_workflow_versions PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  workflow_definition_id uuid NOT NULL,
  version integer NOT NULL,
  configuration jsonb NOT NULL,
  checksum_sha256 char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  published_by_user_profile_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fk_workflow_versions_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_versions_definition
    FOREIGN KEY (workflow_definition_id, organisation_id)
    REFERENCES public.workflow_definitions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_versions_published_by
    FOREIGN KEY (published_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT uq_workflow_versions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_workflow_versions_id_definition_org
    UNIQUE (id, workflow_definition_id, organisation_id),
  CONSTRAINT uq_workflow_versions_definition_version
    UNIQUE (workflow_definition_id, version),
  CONSTRAINT ck_workflow_versions_version CHECK (version >= 1),
  CONSTRAINT ck_workflow_versions_configuration
    CHECK (pg_catalog.jsonb_typeof(configuration) = 'object'),
  CONSTRAINT ck_workflow_versions_checksum
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.workflow_runs (
  id uuid CONSTRAINT pk_workflow_runs PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  workflow_definition_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  subject_type public.automation_subject_type NOT NULL,
  subject_id uuid NOT NULL,
  trigger_event varchar(160) NOT NULL,
  idempotency_key varchar(180) NOT NULL,
  status public.workflow_run_status NOT NULL DEFAULT 'RUNNING',
  current_step_key varchar(120),
  owner_user_id uuid,
  owner_team_id uuid,
  next_action_summary varchar(500),
  next_action_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error_code varchar(120),
  last_error_detail varchar(1000),
  started_by_actor_type public.audit_actor_type NOT NULL DEFAULT 'SYSTEM',
  started_by_user_profile_id uuid,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_workflow_runs_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_runs_definition
    FOREIGN KEY (workflow_definition_id, organisation_id)
    REFERENCES public.workflow_definitions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_runs_version
    FOREIGN KEY (workflow_version_id, workflow_definition_id, organisation_id)
    REFERENCES public.workflow_versions(id, workflow_definition_id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_runs_owner_user
    FOREIGN KEY (owner_user_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_runs_owner_team
    FOREIGN KEY (owner_team_id, organisation_id)
    REFERENCES public.teams(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_runs_started_by
    FOREIGN KEY (started_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT uq_workflow_runs_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_workflow_runs_org_idempotency
    UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT ck_workflow_runs_idempotency CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT ck_workflow_runs_attempts
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 25
      AND attempt_count <= max_attempts),
  CONSTRAINT ck_workflow_runs_version CHECK (version >= 1),
  CONSTRAINT ck_workflow_runs_actor
    CHECK (
      (started_by_actor_type IN ('USER', 'SUPPORT') AND started_by_user_profile_id IS NOT NULL)
      OR (started_by_actor_type NOT IN ('USER', 'SUPPORT'))
    ),
  CONSTRAINT ck_workflow_runs_terminal_time
    CHECK (
      (status = 'COMPLETED' AND completed_at IS NOT NULL AND failed_at IS NULL)
      OR (status IN ('FAILED', 'DEAD_LETTER') AND failed_at IS NOT NULL)
      OR (status NOT IN ('COMPLETED', 'FAILED', 'DEAD_LETTER'))
    )
);

CREATE TABLE public.workflow_actions (
  id uuid CONSTRAINT pk_workflow_actions PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  workflow_run_id uuid NOT NULL,
  step_key varchar(120) NOT NULL,
  action_type public.workflow_action_type NOT NULL,
  action_key varchar(160) NOT NULL,
  title varchar(240) NOT NULL,
  description text,
  status public.workflow_action_status NOT NULL DEFAULT 'PENDING',
  priority public.work_priority NOT NULL DEFAULT 'NORMAL',
  owner_user_id uuid,
  owner_team_id uuid,
  due_at timestamptz,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  idempotency_key varchar(180) NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz,
  last_error_code varchar(120),
  last_error_detail varchar(1000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_workflow_actions_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_actions_run
    FOREIGN KEY (workflow_run_id, organisation_id)
    REFERENCES public.workflow_runs(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_actions_owner_user
    FOREIGN KEY (owner_user_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_workflow_actions_owner_team
    FOREIGN KEY (owner_team_id, organisation_id)
    REFERENCES public.teams(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_workflow_actions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_workflow_actions_run_step UNIQUE (workflow_run_id, step_key),
  CONSTRAINT uq_workflow_actions_org_idempotency
    UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT ck_workflow_actions_keys
    CHECK (
      step_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
      AND action_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
      AND btrim(idempotency_key) <> ''
    ),
  CONSTRAINT ck_workflow_actions_title CHECK (btrim(title) <> ''),
  CONSTRAINT ck_workflow_actions_payloads
    CHECK (
      pg_catalog.jsonb_typeof(input) = 'object'
      AND (output IS NULL OR pg_catalog.jsonb_typeof(output) = 'object')
    ),
  CONSTRAINT ck_workflow_actions_attempts
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 25
      AND attempt_count <= max_attempts),
  CONSTRAINT ck_workflow_actions_version CHECK (version >= 1),
  CONSTRAINT ck_workflow_actions_completion
    CHECK (
      (status = 'SUCCEEDED' AND completed_at IS NOT NULL)
      OR status <> 'SUCCEEDED'
    )
);

CREATE TABLE public.sla_policies (
  id uuid CONSTRAINT pk_sla_policies PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  key varchar(120) NOT NULL,
  name varchar(180) NOT NULL,
  description text NOT NULL,
  subject_type public.automation_subject_type NOT NULL,
  start_event varchar(160) NOT NULL,
  stop_event varchar(160) NOT NULL,
  target_seconds integer NOT NULL,
  warning_seconds integer NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Europe/London',
  calendar_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_profile_id uuid,
  updated_by_user_profile_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_sla_policies_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sla_policies_created_by
    FOREIGN KEY (created_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sla_policies_updated_by
    FOREIGN KEY (updated_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT uq_sla_policies_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_sla_policies_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_sla_policies_keys
    CHECK (
      key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
      AND start_event ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
      AND stop_event ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
    ),
  CONSTRAINT ck_sla_policies_duration
    CHECK (target_seconds BETWEEN 60 AND 2592000
      AND warning_seconds BETWEEN 0 AND target_seconds),
  CONSTRAINT ck_sla_policies_timezone CHECK (btrim(timezone) <> ''),
  CONSTRAINT ck_sla_policies_calendar
    CHECK (pg_catalog.jsonb_typeof(calendar_configuration) = 'object'),
  CONSTRAINT ck_sla_policies_version CHECK (version >= 1)
);

CREATE TABLE public.escalation_rules (
  id uuid CONSTRAINT pk_escalation_rules PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  sla_policy_id uuid NOT NULL,
  level smallint NOT NULL,
  name varchar(180) NOT NULL,
  after_breach_seconds integer NOT NULL,
  action_key varchar(160) NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz,
  CONSTRAINT fk_escalation_rules_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_escalation_rules_policy
    FOREIGN KEY (sla_policy_id, organisation_id)
    REFERENCES public.sla_policies(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_escalation_rules_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_escalation_rules_policy_level UNIQUE (sla_policy_id, level),
  CONSTRAINT ck_escalation_rules_level CHECK (level BETWEEN 1 AND 10),
  CONSTRAINT ck_escalation_rules_delay
    CHECK (after_breach_seconds BETWEEN 0 AND 2592000),
  CONSTRAINT ck_escalation_rules_action
    CHECK (action_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  CONSTRAINT ck_escalation_rules_configuration
    CHECK (pg_catalog.jsonb_typeof(configuration) = 'object')
);

CREATE TABLE public.sla_instances (
  id uuid CONSTRAINT pk_sla_instances PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  sla_policy_id uuid NOT NULL,
  workflow_run_id uuid,
  workflow_action_id uuid,
  subject_type public.automation_subject_type NOT NULL,
  subject_id uuid NOT NULL,
  idempotency_key varchar(180) NOT NULL,
  status public.sla_instance_status NOT NULL DEFAULT 'ACTIVE',
  owner_user_id uuid,
  owner_team_id uuid,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  warning_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  at_risk_at timestamptz,
  breached_at timestamptz,
  satisfied_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason varchar(1000),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_sla_instances_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sla_instances_policy
    FOREIGN KEY (sla_policy_id, organisation_id)
    REFERENCES public.sla_policies(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sla_instances_run
    FOREIGN KEY (workflow_run_id, organisation_id)
    REFERENCES public.workflow_runs(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sla_instances_action
    FOREIGN KEY (workflow_action_id, organisation_id)
    REFERENCES public.workflow_actions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_sla_instances_owner_user
    FOREIGN KEY (owner_user_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sla_instances_owner_team
    FOREIGN KEY (owner_team_id, organisation_id)
    REFERENCES public.teams(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_sla_instances_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_sla_instances_org_idempotency
    UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT ck_sla_instances_order
    CHECK (started_at <= warning_at AND warning_at <= due_at),
  CONSTRAINT ck_sla_instances_version CHECK (version >= 1),
  CONSTRAINT ck_sla_instances_state_evidence
    CHECK (
      (status = 'AT_RISK' AND at_risk_at IS NOT NULL)
      OR (status = 'BREACHED' AND breached_at IS NOT NULL)
      OR (status = 'SATISFIED' AND satisfied_at IS NOT NULL)
      OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL
        AND btrim(cancellation_reason) <> '')
      OR status = 'ACTIVE'
    )
);

CREATE TABLE public.escalation_events (
  id uuid CONSTRAINT pk_escalation_events PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  sla_instance_id uuid NOT NULL,
  escalation_rule_id uuid NOT NULL,
  level smallint NOT NULL,
  action_key varchar(160) NOT NULL,
  status public.escalation_event_status NOT NULL DEFAULT 'RECORDED',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_profile_id uuid,
  resolved_at timestamptz,
  resolved_by_user_profile_id uuid,
  resolution varchar(1000),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_escalation_events_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_escalation_events_instance
    FOREIGN KEY (sla_instance_id, organisation_id)
    REFERENCES public.sla_instances(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_escalation_events_rule
    FOREIGN KEY (escalation_rule_id, organisation_id)
    REFERENCES public.escalation_rules(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_escalation_events_acknowledged_by
    FOREIGN KEY (acknowledged_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_escalation_events_resolved_by
    FOREIGN KEY (resolved_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT uq_escalation_events_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_escalation_events_instance_rule
    UNIQUE (sla_instance_id, escalation_rule_id),
  CONSTRAINT ck_escalation_events_level CHECK (level BETWEEN 1 AND 10),
  CONSTRAINT ck_escalation_events_details
    CHECK (pg_catalog.jsonb_typeof(details) = 'object'),
  CONSTRAINT ck_escalation_events_version CHECK (version >= 1),
  CONSTRAINT ck_escalation_events_evidence
    CHECK (
      (status = 'RECORDED' AND acknowledged_at IS NULL AND resolved_at IS NULL)
      OR (status = 'ACKNOWLEDGED' AND acknowledged_at IS NOT NULL
        AND acknowledged_by_user_profile_id IS NOT NULL AND resolved_at IS NULL)
      OR (status = 'RESOLVED' AND resolved_at IS NOT NULL
        AND resolved_by_user_profile_id IS NOT NULL AND btrim(resolution) <> '')
    )
);

CREATE TABLE public.approval_requests (
  id uuid CONSTRAINT pk_approval_requests PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  workflow_run_id uuid,
  workflow_action_id uuid,
  subject_type public.automation_subject_type NOT NULL,
  subject_id uuid NOT NULL,
  title varchar(240) NOT NULL,
  summary text NOT NULL,
  action_key varchar(160) NOT NULL,
  risk_level public.approval_risk_level NOT NULL DEFAULT 'MEDIUM',
  proposed_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.approval_request_status NOT NULL DEFAULT 'PENDING',
  requested_by_actor_type public.audit_actor_type NOT NULL DEFAULT 'USER',
  requested_by_user_profile_id uuid,
  approver_user_id uuid,
  approver_team_id uuid,
  allow_self_approval boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason varchar(1000),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_approval_requests_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_approval_requests_run
    FOREIGN KEY (workflow_run_id, organisation_id)
    REFERENCES public.workflow_runs(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_approval_requests_action
    FOREIGN KEY (workflow_action_id, organisation_id)
    REFERENCES public.workflow_actions(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_approval_requests_requested_by
    FOREIGN KEY (requested_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_approval_requests_approver_user
    FOREIGN KEY (approver_user_id) REFERENCES public.user_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_approval_requests_approver_team
    FOREIGN KEY (approver_team_id, organisation_id)
    REFERENCES public.teams(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_approval_requests_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_approval_requests_title CHECK (btrim(title) <> ''),
  CONSTRAINT ck_approval_requests_summary CHECK (btrim(summary) <> ''),
  CONSTRAINT ck_approval_requests_action
    CHECK (action_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  CONSTRAINT ck_approval_requests_payload
    CHECK (pg_catalog.jsonb_typeof(proposed_payload) = 'object'),
  CONSTRAINT ck_approval_requests_actor
    CHECK (
      (requested_by_actor_type IN ('USER', 'SUPPORT')
        AND requested_by_user_profile_id IS NOT NULL)
      OR requested_by_actor_type NOT IN ('USER', 'SUPPORT')
    ),
  CONSTRAINT ck_approval_requests_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_approval_requests_approver
    CHECK (approver_user_id IS NOT NULL OR approver_team_id IS NOT NULL),
  CONSTRAINT ck_approval_requests_action_run
    CHECK (workflow_action_id IS NULL OR workflow_run_id IS NOT NULL),
  CONSTRAINT ck_approval_requests_self_approval
    CHECK (
      NOT allow_self_approval
      OR risk_level IN ('LOW', 'MEDIUM')
    ),
  CONSTRAINT ck_approval_requests_version CHECK (version >= 1),
  CONSTRAINT ck_approval_requests_state_evidence
    CHECK (
      (status IN ('APPROVED', 'REJECTED') AND decided_at IS NOT NULL)
      OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL
        AND btrim(cancellation_reason) <> '')
      OR status IN ('PENDING', 'EXPIRED')
    )
);

CREATE TABLE public.approval_decisions (
  id uuid CONSTRAINT pk_approval_decisions PRIMARY KEY
    DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  approval_request_id uuid NOT NULL,
  decision public.approval_decision_type NOT NULL,
  reason varchar(2000) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by_user_profile_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT fk_approval_decisions_organisation
    FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_approval_decisions_request
    FOREIGN KEY (approval_request_id, organisation_id)
    REFERENCES public.approval_requests(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_approval_decisions_decided_by
    FOREIGN KEY (decided_by_user_profile_id) REFERENCES public.user_profiles(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_approval_decisions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_approval_decisions_request
    UNIQUE (approval_request_id, organisation_id),
  CONSTRAINT ck_approval_decisions_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_approval_decisions_evidence
    CHECK (pg_catalog.jsonb_typeof(evidence) = 'object')
);

CREATE INDEX ix_workflow_definitions_org_trigger
  ON public.workflow_definitions (
    organisation_id, status, trigger_event, deleted_at
  );
CREATE INDEX ix_workflow_versions_org_definition
  ON public.workflow_versions (
    organisation_id, workflow_definition_id, version DESC
  );
CREATE INDEX ix_workflow_runs_org_subject
  ON public.workflow_runs (
    organisation_id, subject_type, subject_id, created_at DESC
  );
CREATE INDEX ix_workflow_runs_org_status_next
  ON public.workflow_runs (organisation_id, status, next_action_at);
CREATE INDEX ix_workflow_actions_org_status_due
  ON public.workflow_actions (organisation_id, status, due_at);
CREATE INDEX ix_workflow_actions_org_owner_due
  ON public.workflow_actions (
    organisation_id, owner_user_id, status, due_at
  );
CREATE INDEX ix_sla_policies_org_subject
  ON public.sla_policies (
    organisation_id, subject_type, is_active, deleted_at
  );
CREATE INDEX ix_sla_instances_org_status_due
  ON public.sla_instances (
    organisation_id, status, warning_at, due_at
  );
CREATE INDEX ix_sla_instances_org_subject
  ON public.sla_instances (
    organisation_id, subject_type, subject_id, created_at DESC
  );
CREATE INDEX ix_escalation_rules_org_policy
  ON public.escalation_rules (
    organisation_id, sla_policy_id, is_active, after_breach_seconds
  );
CREATE INDEX ix_escalation_events_org_status
  ON public.escalation_events (
    organisation_id, status, occurred_at DESC
  );
CREATE INDEX ix_approval_requests_org_status_expiry
  ON public.approval_requests (
    organisation_id, status, expires_at
  );
CREATE INDEX ix_approval_requests_org_subject
  ON public.approval_requests (
    organisation_id, subject_type, subject_id, created_at DESC
  );
CREATE INDEX ix_approval_decisions_org_request
  ON public.approval_decisions (
    organisation_id, approval_request_id, occurred_at DESC
  );

-- Policy helpers can inspect the existing tenant records without recursively
-- invoking their application-facing policies.
GRANT SELECT ON public.enquiries TO businessos_policy_reader;
CREATE POLICY policy_reader_automation_enquiries ON public.enquiries
  FOR SELECT TO businessos_policy_reader USING (true);

GRANT SELECT ON public.workflow_definitions, public.workflow_versions,
  public.workflow_runs, public.workflow_actions, public.sla_policies,
  public.sla_instances, public.escalation_rules, public.escalation_events,
  public.approval_requests, public.approval_decisions
TO businessos_policy_reader;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.automation_subject_exists(
  p_organisation_id uuid,
  p_subject_type public.automation_subject_type,
  p_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT CASE p_subject_type
    WHEN 'ENQUIRY' THEN EXISTS (
      SELECT 1 FROM public.enquiries AS enquiry
      WHERE enquiry.id = p_subject_id
        AND enquiry.organisation_id = p_organisation_id
        AND enquiry.deleted_at IS NULL
    )
    WHEN 'CLIENT' THEN EXISTS (
      SELECT 1 FROM public.clients AS client
      WHERE client.id = p_subject_id
        AND client.organisation_id = p_organisation_id
        AND client.deleted_at IS NULL
    )
    WHEN 'MATTER' THEN EXISTS (
      SELECT 1 FROM public.matters AS matter
      WHERE matter.id = p_subject_id
        AND matter.organisation_id = p_organisation_id
        AND matter.deleted_at IS NULL
    )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION private.can_read_automation_subject(
  p_organisation_id uuid,
  p_subject_type public.automation_subject_type,
  p_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT CASE p_subject_type
    WHEN 'ENQUIRY' THEN EXISTS (
      SELECT 1
      FROM public.enquiries AS enquiry
      WHERE enquiry.id = p_subject_id
        AND enquiry.organisation_id = p_organisation_id
        AND enquiry.deleted_at IS NULL
        AND (
          private.has_organisation_permission(
            p_organisation_id,
            'enquiries.read_all'
          )
          OR (
            private.has_organisation_permission(
              p_organisation_id,
              'enquiries.read'
            )
            AND (
              enquiry.assigned_to_user_id = private.current_user_id()
              OR enquiry.created_by_user_id = private.current_user_id()
            )
          )
        )
    )
    WHEN 'CLIENT' THEN private.can_read_client(
      p_organisation_id,
      p_subject_id
    )
    WHEN 'MATTER' THEN private.can_read_matter(
      p_organisation_id,
      p_subject_id
    )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION private.automation_user_is_active(
  p_organisation_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_user_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS membership
    JOIN public.user_profiles AS profile
      ON profile.id = membership.user_profile_id
    WHERE membership.organisation_id = p_organisation_id
      AND membership.user_profile_id = p_user_id
      AND membership.status = 'ACTIVE'
      AND membership.deleted_at IS NULL
      AND profile.status = 'ACTIVE'
      AND profile.deleted_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION private.automation_team_is_active(
  p_organisation_id uuid,
  p_team_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_team_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.teams AS team
    WHERE team.id = p_team_id
      AND team.organisation_id = p_organisation_id
      AND team.is_active
      AND team.deleted_at IS NULL
  );
$function$;

ALTER FUNCTION private.automation_subject_exists(
  uuid, public.automation_subject_type, uuid
) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.can_read_automation_subject(
  uuid, public.automation_subject_type, uuid
) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.automation_user_is_active(uuid, uuid)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.automation_team_is_active(uuid, uuid)
  OWNER TO businessos_policy_reader;

REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.automation_subject_exists(
  uuid, public.automation_subject_type, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_automation_subject(
  uuid, public.automation_subject_type, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.automation_user_is_active(uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.automation_team_is_active(uuid, uuid)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.validate_workflow_definition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF private.current_organisation_id() IS NOT NULL
     AND NEW.organisation_id IS DISTINCT FROM private.current_organisation_id() THEN
    RAISE EXCEPTION 'workflow definition organisation differs from transaction context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF private.current_user_id() IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       AND NEW.created_by_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
      RAISE EXCEPTION 'workflow definition creator must match authenticated actor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.updated_by_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
      RAISE EXCEPTION 'workflow definition updater must match authenticated actor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_workflow_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
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
     AND NEW.started_by_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'workflow actor must match authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'UPDATE' THEN
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

CREATE OR REPLACE FUNCTION private.validate_sla_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF private.current_organisation_id() IS NOT NULL
     AND NEW.organisation_id IS DISTINCT FROM private.current_organisation_id() THEN
    RAISE EXCEPTION 'SLA policy organisation differs from transaction context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF private.current_user_id() IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       AND NEW.created_by_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
      RAISE EXCEPTION 'SLA policy creator must match authenticated actor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.updated_by_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
      RAISE EXCEPTION 'SLA policy updater must match authenticated actor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'SLA policy version must increment exactly once'
      USING ERRCODE = 'serialization_failure';
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

  IF TG_OP = 'UPDATE' THEN
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

CREATE OR REPLACE FUNCTION private.validate_escalation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  expected_policy_id uuid;
  rule_policy_id uuid;
  expected_level smallint;
  expected_action_key text;
BEGIN
  SELECT instance.sla_policy_id
    INTO expected_policy_id
  FROM public.sla_instances AS instance
  WHERE instance.id = NEW.sla_instance_id
    AND instance.organisation_id = NEW.organisation_id;

  SELECT rule.sla_policy_id, rule.level, rule.action_key
    INTO rule_policy_id, expected_level, expected_action_key
  FROM public.escalation_rules AS rule
  WHERE rule.id = NEW.escalation_rule_id
    AND rule.organisation_id = NEW.organisation_id;

  IF expected_policy_id IS DISTINCT FROM rule_policy_id
     OR NEW.level IS DISTINCT FROM expected_level
     OR NEW.action_key IS DISTINCT FROM expected_action_key THEN
    RAISE EXCEPTION 'escalation evidence does not match its rule and SLA'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'RESOLVED' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'resolved escalation cannot transition'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'escalation version must increment exactly once'
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
     AND NEW.requested_by_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'approval requester must match authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'new approval requests must start pending'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
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

CREATE OR REPLACE FUNCTION private.reject_automation_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'automation evidence is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END
$function$;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

ALTER FUNCTION private.validate_workflow_definition()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_workflow_run()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_workflow_action()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_sla_policy()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_sla_instance()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_escalation_event()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_approval_request()
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.reject_automation_evidence_mutation()
  OWNER TO businessos_policy_reader;

REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;

REVOKE ALL ON FUNCTION private.validate_workflow_definition() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_workflow_run() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_workflow_action() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_sla_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_sla_instance() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_escalation_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_approval_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reject_automation_evidence_mutation()
  FROM PUBLIC;

CREATE TRIGGER workflow_definitions_immutable
  BEFORE UPDATE ON public.workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'key', 'subject_type', 'trigger_event',
    'created_by_user_profile_id', 'created_at'
  );
CREATE TRIGGER workflow_definitions_validate
  BEFORE INSERT OR UPDATE ON public.workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION private.validate_workflow_definition();

CREATE TRIGGER workflow_versions_append_only
  BEFORE UPDATE OR DELETE ON public.workflow_versions
  FOR EACH ROW EXECUTE FUNCTION private.reject_automation_evidence_mutation();

CREATE TRIGGER workflow_runs_immutable
  BEFORE UPDATE ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'workflow_definition_id',
    'workflow_version_id', 'subject_type', 'subject_id', 'trigger_event',
    'idempotency_key', 'started_by_actor_type',
    'started_by_user_profile_id', 'started_at', 'created_at'
  );
CREATE TRIGGER workflow_runs_validate
  BEFORE INSERT OR UPDATE ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION private.validate_workflow_run();

CREATE TRIGGER workflow_actions_immutable
  BEFORE UPDATE ON public.workflow_actions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'workflow_run_id', 'step_key',
    'action_type', 'action_key', 'idempotency_key', 'created_at'
  );
CREATE TRIGGER workflow_actions_validate
  BEFORE INSERT OR UPDATE ON public.workflow_actions
  FOR EACH ROW EXECUTE FUNCTION private.validate_workflow_action();

CREATE TRIGGER sla_policies_immutable
  BEFORE UPDATE ON public.sla_policies
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'key', 'subject_type', 'start_event',
    'stop_event', 'created_by_user_profile_id', 'created_at'
  );
CREATE TRIGGER sla_policies_validate
  BEFORE INSERT OR UPDATE ON public.sla_policies
  FOR EACH ROW EXECUTE FUNCTION private.validate_sla_policy();

CREATE TRIGGER escalation_rules_immutable
  BEFORE UPDATE ON public.escalation_rules
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'sla_policy_id', 'level', 'created_at'
  );

CREATE TRIGGER sla_instances_immutable
  BEFORE UPDATE ON public.sla_instances
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'sla_policy_id', 'workflow_run_id',
    'workflow_action_id', 'subject_type', 'subject_id',
    'idempotency_key', 'started_at', 'warning_at', 'due_at', 'created_at'
  );
CREATE TRIGGER sla_instances_validate
  BEFORE INSERT OR UPDATE ON public.sla_instances
  FOR EACH ROW EXECUTE FUNCTION private.validate_sla_instance();

CREATE TRIGGER escalation_events_immutable
  BEFORE UPDATE ON public.escalation_events
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'sla_instance_id', 'escalation_rule_id',
    'level', 'action_key', 'details', 'occurred_at', 'created_at'
  );
CREATE TRIGGER escalation_events_validate
  BEFORE INSERT OR UPDATE ON public.escalation_events
  FOR EACH ROW EXECUTE FUNCTION private.validate_escalation_event();

CREATE TRIGGER approval_requests_immutable
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'workflow_run_id', 'workflow_action_id',
    'subject_type', 'subject_id', 'title', 'summary', 'action_key',
    'risk_level', 'proposed_payload', 'requested_by_actor_type',
    'requested_by_user_profile_id', 'approver_user_id', 'approver_team_id',
    'allow_self_approval', 'expires_at', 'created_at'
  );
CREATE TRIGGER approval_requests_validate
  BEFORE INSERT OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION private.validate_approval_request();

CREATE TRIGGER approval_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_automation_evidence_mutation();

CREATE OR REPLACE FUNCTION private.seed_default_automation_configuration(
  p_organisation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  definition_id uuid;
  policy_id uuid;
  actor_id uuid := private.current_user_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organisations AS organisation
    WHERE organisation.id = p_organisation_id
      AND organisation.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'automation organisation is unavailable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO public.workflow_definitions (
    organisation_id, key, name, description, subject_type,
    trigger_event, status, created_by_user_profile_id,
    updated_by_user_profile_id
  )
  VALUES (
    p_organisation_id,
    'enquiry.initial-response',
    'New enquiry initial response',
    'Creates an owned contact task and response SLA for every new enquiry.',
    'ENQUIRY',
    'enquiry.created',
    'ACTIVE',
    actor_id,
    actor_id
  )
  ON CONFLICT (organisation_id, key) DO NOTHING;

  SELECT definition.id
    INTO definition_id
  FROM public.workflow_definitions AS definition
  WHERE definition.organisation_id = p_organisation_id
    AND definition.key = 'enquiry.initial-response'
    AND definition.deleted_at IS NULL;

  IF definition_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.workflow_versions (
    organisation_id, workflow_definition_id, version, configuration,
    checksum_sha256, published_at, published_by_user_profile_id
  )
  VALUES (
    p_organisation_id,
    definition_id,
    1,
    '{
      "completionEvent": "enquiry.contacted",
      "steps": [
        {
          "actionKey": "enquiry.initial-contact",
          "slaKey": "enquiry.initial-response",
          "stepKey": "initial-contact",
          "type": "HUMAN_TASK"
        }
      ],
      "trigger": "enquiry.created"
    }'::jsonb,
    '21b38326e59d51ee558613405bd8b44f2d58f9aaf5008352f64700694875e83f',
    pg_catalog.now(),
    actor_id
  )
  ON CONFLICT (workflow_definition_id, version) DO NOTHING;

  INSERT INTO public.sla_policies (
    organisation_id, key, name, description, subject_type,
    start_event, stop_event, target_seconds, warning_seconds,
    timezone, calendar_configuration, created_by_user_profile_id,
    updated_by_user_profile_id
  )
  SELECT
    p_organisation_id,
    'enquiry.initial-response',
    'New enquiry response SLA',
    'New enquiries should receive a recorded first contact within one hour.',
    'ENQUIRY'::public.automation_subject_type,
    'enquiry.created',
    'enquiry.contacted',
    3600,
    900,
    organisation.timezone,
    jsonb_build_object(
      'mode', 'elapsed',
      'businessCalendar', 'continuous',
      'futureCalendarSupport', true
    ),
    actor_id,
    actor_id
  FROM public.organisations AS organisation
  WHERE organisation.id = p_organisation_id
  ON CONFLICT (organisation_id, key) DO NOTHING;

  SELECT policy.id
    INTO policy_id
  FROM public.sla_policies AS policy
  WHERE policy.organisation_id = p_organisation_id
    AND policy.key = 'enquiry.initial-response'
    AND policy.deleted_at IS NULL;

  IF policy_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.escalation_rules (
    organisation_id, sla_policy_id, level, name,
    after_breach_seconds, action_key, configuration
  )
  VALUES
    (
      p_organisation_id, policy_id, 1, 'Flag response breach for manager',
      0, 'escalation.flag-manager',
      jsonb_build_object('priority', 'URGENT', 'surface', 'control-tower')
    ),
    (
      p_organisation_id, policy_id, 2, 'Escalate unresolved response breach',
      3600, 'escalation.flag-department',
      jsonb_build_object('priority', 'URGENT', 'surface', 'control-tower')
    )
  ON CONFLICT (sla_policy_id, level) DO NOTHING;
END
$function$;

ALTER FUNCTION private.seed_default_automation_configuration(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.seed_default_automation_configuration(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE OR REPLACE FUNCTION private.seed_organisation_automation_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.seed_default_automation_configuration(NEW.id);
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.seed_organisation_automation_trigger()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.seed_organisation_automation_trigger()
  FROM PUBLIC;

CREATE TRIGGER organisations_seed_automation
  AFTER INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION private.seed_organisation_automation_trigger();

DO $seed_existing_organisations$
DECLARE
  organisation_record record;
BEGIN
  FOR organisation_record IN
    SELECT organisation.id
    FROM public.organisations AS organisation
    WHERE organisation.deleted_at IS NULL
  LOOP
    PERFORM private.seed_default_automation_configuration(
      organisation_record.id
    );
  END LOOP;
END
$seed_existing_organisations$;

CREATE OR REPLACE FUNCTION private.start_enquiry_initial_response(
  p_organisation_id uuid,
  p_enquiry_id uuid,
  p_started_at timestamptz,
  p_owner_user_id uuid,
  p_actor_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  definition_id uuid;
  workflow_version_id uuid;
  policy_id uuid;
  run_id uuid;
  action_id uuid;
  effective_owner_id uuid := p_owner_user_id;
  due_at timestamptz;
  warning_at timestamptz;
  target_seconds integer;
  warning_seconds integer;
  actor_type public.audit_actor_type;
BEGIN
  IF NOT private.automation_subject_exists(
    p_organisation_id,
    'ENQUIRY',
    p_enquiry_id
  ) THEN
    RAISE EXCEPTION 'enquiry workflow subject is unavailable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT private.automation_user_is_active(
    p_organisation_id,
    effective_owner_id
  ) THEN
    effective_owner_id := NULL;
  END IF;

  SELECT definition.id, version_record.id
    INTO definition_id, workflow_version_id
  FROM public.workflow_definitions AS definition
  JOIN LATERAL (
    SELECT workflow_version.id
    FROM public.workflow_versions AS workflow_version
    WHERE workflow_version.workflow_definition_id = definition.id
      AND workflow_version.organisation_id = definition.organisation_id
      AND workflow_version.published_at <= pg_catalog.now()
    ORDER BY workflow_version.version DESC
    LIMIT 1
  ) AS version_record ON true
  WHERE definition.organisation_id = p_organisation_id
    AND definition.key = 'enquiry.initial-response'
    AND definition.subject_type = 'ENQUIRY'
    AND definition.trigger_event = 'enquiry.created'
    AND definition.status = 'ACTIVE'
    AND definition.deleted_at IS NULL;

  SELECT policy.id, policy.target_seconds, policy.warning_seconds
    INTO policy_id, target_seconds, warning_seconds
  FROM public.sla_policies AS policy
  WHERE policy.organisation_id = p_organisation_id
    AND policy.key = 'enquiry.initial-response'
    AND policy.subject_type = 'ENQUIRY'
    AND policy.is_active
    AND policy.deleted_at IS NULL;

  IF definition_id IS NULL OR workflow_version_id IS NULL OR policy_id IS NULL THEN
    RETURN NULL;
  END IF;

  due_at := p_started_at + pg_catalog.make_interval(secs => target_seconds);
  warning_at := GREATEST(
    p_started_at,
    due_at - pg_catalog.make_interval(secs => warning_seconds)
  );
  actor_type := CASE
    WHEN p_actor_user_id IS NULL THEN 'SYSTEM'::public.audit_actor_type
    ELSE 'USER'::public.audit_actor_type
  END;

  INSERT INTO public.workflow_runs (
    organisation_id, workflow_definition_id, workflow_version_id,
    subject_type, subject_id, trigger_event, idempotency_key,
    status, current_step_key, owner_user_id,
    next_action_summary, next_action_at,
    started_by_actor_type, started_by_user_profile_id, started_at
  )
  VALUES (
    p_organisation_id, definition_id, workflow_version_id,
    'ENQUIRY', p_enquiry_id, 'enquiry.created',
    'enquiry.initial-response:' || p_enquiry_id::text,
    'WAITING', 'initial-contact', effective_owner_id,
    'Contact the new enquiry and record the outcome.', due_at,
    actor_type, p_actor_user_id, p_started_at
  )
  ON CONFLICT (organisation_id, idempotency_key) DO NOTHING
  RETURNING id INTO run_id;

  IF run_id IS NULL THEN
    SELECT run.id INTO run_id
    FROM public.workflow_runs AS run
    WHERE run.organisation_id = p_organisation_id
      AND run.idempotency_key =
        'enquiry.initial-response:' || p_enquiry_id::text;
    RETURN run_id;
  END IF;

  INSERT INTO public.workflow_actions (
    organisation_id, workflow_run_id, step_key, action_type,
    action_key, title, description, status, priority,
    owner_user_id, due_at, input, idempotency_key
  )
  VALUES (
    p_organisation_id, run_id, 'initial-contact', 'HUMAN_TASK',
    'enquiry.initial-contact', 'Contact new enquiry',
    'Make the first contact and record the outcome in BusinessOS.',
    'READY', 'HIGH', effective_owner_id, due_at,
    jsonb_build_object(
      'subjectType', 'ENQUIRY',
      'subjectId', p_enquiry_id
    ),
    'enquiry.initial-response:' || p_enquiry_id::text || ':initial-contact'
  )
  RETURNING id INTO action_id;

  INSERT INTO public.sla_instances (
    organisation_id, sla_policy_id, workflow_run_id,
    workflow_action_id, subject_type, subject_id, idempotency_key,
    status, owner_user_id, started_at, warning_at, due_at
  )
  VALUES (
    p_organisation_id, policy_id, run_id, action_id,
    'ENQUIRY', p_enquiry_id,
    'enquiry.initial-response:' || p_enquiry_id::text || ':sla',
    'ACTIVE', effective_owner_id, p_started_at, warning_at, due_at
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), p_organisation_id, actor_type,
    p_actor_user_id, 'businessos-workflow-engine', 'workflow.started',
    'workflow_run', run_id::text, 'SUCCESS',
    jsonb_build_object(
      'workflowKey', 'enquiry.initial-response',
      'subjectType', 'ENQUIRY',
      'subjectId', p_enquiry_id,
      'slaPolicyKey', 'enquiry.initial-response'
    )
  );

  RETURN run_id;
END
$function$;

ALTER FUNCTION private.start_enquiry_initial_response(
  uuid, uuid, timestamptz, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.start_enquiry_initial_response(
  uuid, uuid, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE OR REPLACE FUNCTION private.start_enquiry_initial_response_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.status = 'NEW' THEN
    PERFORM private.start_enquiry_initial_response(
      NEW.organisation_id,
      NEW.id,
      NEW.created_at,
      COALESCE(NEW.assigned_to_user_id, NEW.created_by_user_id),
      NEW.created_by_user_id
    );
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.start_enquiry_initial_response_trigger()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.start_enquiry_initial_response_trigger()
  FROM PUBLIC;

CREATE TRIGGER enquiries_start_initial_response_workflow
  AFTER INSERT ON public.enquiries
  FOR EACH ROW EXECUTE FUNCTION private.start_enquiry_initial_response_trigger();

CREATE OR REPLACE FUNCTION private.sync_enquiry_initial_response_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  run_id uuid;
  run_status public.workflow_run_status;
  completion_kind text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('CONTACTED', 'QUALIFIED', 'CONSULTATION_BOOKED', 'CONVERTED') THEN
    completion_kind := 'SATISFIED';
  ELSIF NEW.status IN ('CLOSED', 'SPAM') THEN
    completion_kind := 'CANCELLED';
  ELSE
    RETURN NEW;
  END IF;

  SELECT run.id, run.status INTO run_id, run_status
  FROM public.workflow_runs AS run
  JOIN public.workflow_definitions AS definition
    ON definition.id = run.workflow_definition_id
   AND definition.organisation_id = run.organisation_id
  WHERE run.organisation_id = NEW.organisation_id
    AND run.subject_type = 'ENQUIRY'
    AND run.subject_id = NEW.id
    AND definition.key = 'enquiry.initial-response'
  ORDER BY run.created_at DESC
  LIMIT 1
  FOR UPDATE OF run;

  IF run_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF run_status IN ('COMPLETED', 'CANCELLED', 'DEAD_LETTER') THEN
    RETURN NEW;
  END IF;

  IF completion_kind = 'SATISFIED' THEN
    UPDATE public.workflow_actions
    SET status = 'SUCCEEDED',
        output = jsonb_build_object(
          'completion', 'enquiry-status-change',
          'status', NEW.status
        ),
        completed_at = pg_catalog.now(),
        last_error_code = NULL,
        last_error_detail = NULL,
        next_attempt_at = NULL,
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE workflow_run_id = run_id
      AND organisation_id = NEW.organisation_id
      AND action_key = 'enquiry.initial-contact'
      AND status NOT IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER');

    UPDATE public.sla_instances
    SET status = 'SATISFIED',
        satisfied_at = pg_catalog.now(),
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE workflow_run_id = run_id
      AND organisation_id = NEW.organisation_id
      AND status IN ('ACTIVE', 'AT_RISK', 'BREACHED');

    UPDATE public.workflow_runs
    SET status = 'COMPLETED',
        current_step_key = NULL,
        next_action_summary = NULL,
        next_action_at = NULL,
        last_error_code = NULL,
        last_error_detail = NULL,
        completed_at = pg_catalog.now(),
        failed_at = NULL,
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE id = run_id
      AND organisation_id = NEW.organisation_id
      AND status NOT IN ('COMPLETED', 'CANCELLED', 'DEAD_LETTER');
  ELSE
    UPDATE public.workflow_actions
    SET status = 'CANCELLED',
        output = jsonb_build_object(
          'completion', 'enquiry-closed',
          'status', NEW.status
        ),
        completed_at = pg_catalog.now(),
        last_error_code = NULL,
        last_error_detail = NULL,
        next_attempt_at = NULL,
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE workflow_run_id = run_id
      AND organisation_id = NEW.organisation_id
      AND status NOT IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER');

    UPDATE public.sla_instances
    SET status = 'CANCELLED',
        cancelled_at = pg_catalog.now(),
        cancellation_reason = 'Enquiry closed before initial response completion.',
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE workflow_run_id = run_id
      AND organisation_id = NEW.organisation_id
      AND status IN ('ACTIVE', 'AT_RISK', 'BREACHED');

    UPDATE public.workflow_runs
    SET status = 'CANCELLED',
        current_step_key = NULL,
        next_action_summary = NULL,
        next_action_at = NULL,
        last_error_code = NULL,
        last_error_detail = NULL,
        completed_at = pg_catalog.now(),
        failed_at = NULL,
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE id = run_id
      AND organisation_id = NEW.organisation_id
      AND status NOT IN ('COMPLETED', 'CANCELLED', 'DEAD_LETTER');
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), NEW.organisation_id,
    CASE WHEN NEW.updated_by_user_id IS NULL
      THEN 'SYSTEM'::public.audit_actor_type
      ELSE 'USER'::public.audit_actor_type
    END,
    NEW.updated_by_user_id,
    'businessos-workflow-engine',
    CASE WHEN completion_kind = 'SATISFIED'
      THEN 'workflow.completed'
      ELSE 'workflow.cancelled'
    END,
    'workflow_run', run_id::text, 'SUCCESS',
    jsonb_build_object(
      'workflowKey', 'enquiry.initial-response',
      'subjectType', 'ENQUIRY',
      'subjectId', NEW.id,
      'enquiryStatus', NEW.status
    )
  );

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.sync_enquiry_initial_response_trigger()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.sync_enquiry_initial_response_trigger()
  FROM PUBLIC;

CREATE TRIGGER enquiries_sync_initial_response_workflow
  AFTER UPDATE OF status ON public.enquiries
  FOR EACH ROW EXECUTE FUNCTION private.sync_enquiry_initial_response_trigger();

DO $backfill_existing_enquiries$
DECLARE
  enquiry_record record;
BEGIN
  FOR enquiry_record IN
    SELECT enquiry.organisation_id, enquiry.id, enquiry.created_at,
      COALESCE(
        enquiry.assigned_to_user_id,
        enquiry.created_by_user_id
      ) AS owner_user_id,
      enquiry.created_by_user_id
    FROM public.enquiries AS enquiry
    WHERE enquiry.status = 'NEW'
      AND enquiry.deleted_at IS NULL
  LOOP
    PERFORM private.start_enquiry_initial_response(
      enquiry_record.organisation_id,
      enquiry_record.id,
      enquiry_record.created_at,
      enquiry_record.owner_user_id,
      enquiry_record.created_by_user_id
    );
  END LOOP;
END
$backfill_existing_enquiries$;

CREATE OR REPLACE FUNCTION private.complete_workflow_action(
  p_action_id uuid,
  p_expected_version integer,
  p_completion_note text DEFAULT NULL
)
RETURNS TABLE (
  action_id uuid,
  workflow_run_id uuid,
  action_status public.workflow_action_status,
  run_status public.workflow_run_status,
  action_version integer,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  context_organisation_id uuid := private.current_organisation_id();
  actor_id uuid := private.current_user_id();
  action_record record;
  affected_rows integer;
BEGIN
  IF context_organisation_id IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'authenticated organisation context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT private.has_organisation_permission(
    context_organisation_id,
    'work_items.complete'
  ) THEN
    RAISE EXCEPTION 'workflow action completion is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT
    work_action.id,
    work_action.workflow_run_id,
    work_action.action_key,
    work_action.status,
    work_action.owner_user_id,
    work_action.owner_team_id,
    work_action.version,
    workflow_run.subject_type,
    workflow_run.subject_id
  INTO action_record
  FROM public.workflow_actions AS work_action
  JOIN public.workflow_runs AS workflow_run
    ON workflow_run.id = work_action.workflow_run_id
   AND workflow_run.organisation_id = work_action.organisation_id
  WHERE work_action.id = p_action_id
    AND work_action.organisation_id = context_organisation_id
  FOR UPDATE OF work_action, workflow_run;

  IF NOT FOUND
     OR NOT private.can_read_automation_subject(
       context_organisation_id,
       action_record.subject_type,
       action_record.subject_id
     ) THEN
    RAISE EXCEPTION 'workflow action not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF action_record.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'workflow action changed; refresh and retry'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF action_record.status NOT IN ('READY', 'RUNNING', 'WAITING') THEN
    RAISE EXCEPTION 'workflow action is not available for completion'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF action_record.owner_user_id IS NOT NULL
     AND action_record.owner_user_id IS DISTINCT FROM actor_id
     AND NOT private.has_organisation_permission(
       context_organisation_id,
       'automation.manage'
     ) THEN
    RAISE EXCEPTION 'workflow action belongs to another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF action_record.owner_team_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.team_memberships AS team_membership
       JOIN public.organisation_memberships AS membership
         ON membership.id = team_membership.organisation_membership_id
        AND membership.organisation_id = team_membership.organisation_id
       WHERE team_membership.organisation_id = context_organisation_id
         AND team_membership.team_id = action_record.owner_team_id
         AND membership.user_profile_id = actor_id
         AND membership.status = 'ACTIVE'
         AND membership.deleted_at IS NULL
         AND team_membership.deleted_at IS NULL
         AND team_membership.starts_at <= pg_catalog.now()
         AND (
           team_membership.ends_at IS NULL
           OR team_membership.ends_at > pg_catalog.now()
         )
     )
     AND NOT private.has_organisation_permission(
       context_organisation_id,
       'automation.manage'
     ) THEN
    RAISE EXCEPTION 'workflow action belongs to another team'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF action_record.action_key = 'enquiry.initial-contact'
     AND action_record.subject_type = 'ENQUIRY' THEN
    IF NOT private.has_organisation_permission(
      context_organisation_id,
      'enquiries.update'
    ) THEN
      RAISE EXCEPTION 'enquiry update permission is required'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.enquiries
    SET status = 'CONTACTED',
        last_contacted_at = pg_catalog.now(),
        updated_by_user_id = actor_id,
        updated_at = pg_catalog.now()
    WHERE id = action_record.subject_id
      AND organisation_id = context_organisation_id
      AND status = 'NEW'
      AND deleted_at IS NULL;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'enquiry changed; refresh and retry'
        USING ERRCODE = 'serialization_failure';
    END IF;

    IF NULLIF(pg_catalog.btrim(p_completion_note), '') IS NOT NULL THEN
      UPDATE public.workflow_actions
      SET output = COALESCE(output, '{}'::jsonb)
            || jsonb_build_object(
              'completionNote', pg_catalog.btrim(p_completion_note)
            ),
          updated_at = pg_catalog.now(),
          version = version + 1
      WHERE id = action_record.id
        AND organisation_id = context_organisation_id
        AND status = 'SUCCEEDED';
    END IF;
  ELSE
    UPDATE public.workflow_actions
    SET status = 'SUCCEEDED',
        output = jsonb_build_object(
          'completion', 'manual',
          'note', NULLIF(pg_catalog.btrim(p_completion_note), '')
        ),
        completed_at = pg_catalog.now(),
        last_error_code = NULL,
        last_error_detail = NULL,
        next_attempt_at = NULL,
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE id = action_record.id
      AND organisation_id = context_organisation_id
      AND version = p_expected_version;

    UPDATE public.sla_instances
    SET status = 'SATISFIED',
        satisfied_at = pg_catalog.now(),
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE workflow_action_id = action_record.id
      AND organisation_id = context_organisation_id
      AND status IN ('ACTIVE', 'AT_RISK', 'BREACHED');

    UPDATE public.workflow_runs
    SET status = 'COMPLETED',
        current_step_key = NULL,
        next_action_summary = NULL,
        next_action_at = NULL,
        last_error_code = NULL,
        last_error_detail = NULL,
        completed_at = pg_catalog.now(),
        failed_at = NULL,
        updated_at = pg_catalog.now(),
        version = version + 1
    WHERE id = action_record.workflow_run_id
      AND organisation_id = context_organisation_id
      AND status NOT IN ('COMPLETED', 'CANCELLED', 'DEAD_LETTER');
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), context_organisation_id, 'USER', actor_id,
    'businessos-api', 'workflow.action.completed',
    'workflow_action', action_record.id::text, 'SUCCESS',
    jsonb_build_object(
      'workflowRunId', action_record.workflow_run_id,
      'actionKey', action_record.action_key,
      'subjectType', action_record.subject_type,
      'subjectId', action_record.subject_id,
      'completionNoteRecorded',
        NULLIF(pg_catalog.btrim(p_completion_note), '') IS NOT NULL
    )
  );

  RETURN QUERY
  SELECT
    work_action.id,
    work_action.workflow_run_id,
    work_action.status,
    workflow_run.status,
    work_action.version,
    work_action.completed_at
  FROM public.workflow_actions AS work_action
  JOIN public.workflow_runs AS workflow_run
    ON workflow_run.id = work_action.workflow_run_id
   AND workflow_run.organisation_id = work_action.organisation_id
  WHERE work_action.id = action_record.id
    AND work_action.organisation_id = context_organisation_id;
END
$function$;

ALTER FUNCTION private.complete_workflow_action(uuid, integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.complete_workflow_action(uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.complete_workflow_action(
  uuid, integer, text
) TO businessos_app;

CREATE OR REPLACE FUNCTION private.decide_approval_request(
  p_approval_request_id uuid,
  p_expected_version integer,
  p_decision public.approval_decision_type,
  p_reason text
)
RETURNS TABLE (
  approval_request_id uuid,
  approval_status public.approval_request_status,
  approval_version integer,
  decision_id uuid,
  decided_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  context_organisation_id uuid := private.current_organisation_id();
  actor_id uuid := private.current_user_id();
  approval_record record;
  recorded_decision_id uuid;
  decision_time timestamptz := pg_catalog.now();
BEGIN
  IF context_organisation_id IS NULL OR actor_id IS NULL THEN
    RAISE EXCEPTION 'authenticated organisation context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT private.has_organisation_permission(
    context_organisation_id,
    'approvals.decide'
  ) THEN
    RAISE EXCEPTION 'approval decision is not permitted or MFA is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'approval decision reason is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT approval.*
  INTO approval_record
  FROM public.approval_requests AS approval
  WHERE approval.id = p_approval_request_id
    AND approval.organisation_id = context_organisation_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT private.can_read_automation_subject(
       context_organisation_id,
       approval_record.subject_type,
       approval_record.subject_id
     ) THEN
    RAISE EXCEPTION 'approval request not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF approval_record.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'approval request changed; refresh and retry'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF approval_record.status <> 'PENDING' THEN
    RAISE EXCEPTION 'approval request is no longer pending'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF approval_record.expires_at <= decision_time THEN
    RAISE EXCEPTION 'approval request has expired'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT approval_record.allow_self_approval
     AND approval_record.requested_by_user_profile_id = actor_id THEN
    RAISE EXCEPTION 'self approval is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF approval_record.approver_user_id IS DISTINCT FROM actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.team_memberships AS team_membership
       JOIN public.organisation_memberships AS membership
         ON membership.id = team_membership.organisation_membership_id
        AND membership.organisation_id = team_membership.organisation_id
       WHERE team_membership.organisation_id = context_organisation_id
         AND team_membership.team_id = approval_record.approver_team_id
         AND membership.user_profile_id = actor_id
         AND membership.status = 'ACTIVE'
         AND membership.deleted_at IS NULL
         AND team_membership.deleted_at IS NULL
         AND team_membership.starts_at <= decision_time
         AND (
           team_membership.ends_at IS NULL
           OR team_membership.ends_at > decision_time
         )
     )
     AND NOT private.has_organisation_permission(
       context_organisation_id,
       'automation.manage'
     ) THEN
    RAISE EXCEPTION 'approval request is assigned to another approver'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.approval_decisions (
    organisation_id, approval_request_id, decision, reason,
    evidence, decided_by_user_profile_id, occurred_at
  )
  VALUES (
    context_organisation_id, approval_record.id, p_decision,
    pg_catalog.btrim(p_reason),
    jsonb_build_object(
      'assuranceLevel', private.current_aal(),
      'decisionSource', 'businessos-api',
      'expectedVersion', p_expected_version
    ),
    actor_id, decision_time
  )
  RETURNING id INTO recorded_decision_id;

  UPDATE public.approval_requests
  SET status = p_decision::text::public.approval_request_status,
      decided_at = decision_time,
      updated_at = decision_time,
      version = version + 1
  WHERE id = approval_record.id
    AND organisation_id = context_organisation_id
    AND version = p_expected_version;

  IF approval_record.workflow_action_id IS NOT NULL THEN
    IF p_decision = 'APPROVED' THEN
      UPDATE public.workflow_actions
      SET status = CASE
            WHEN action_type = 'APPROVAL'
              THEN 'SUCCEEDED'::public.workflow_action_status
            ELSE 'READY'::public.workflow_action_status
          END,
          output = COALESCE(output, '{}'::jsonb)
            || jsonb_build_object(
              'approvalRequestId', approval_record.id,
              'approvalDecision', p_decision
            ),
          completed_at = CASE
            WHEN action_type = 'APPROVAL' THEN decision_time
            ELSE NULL
          END,
          last_error_code = NULL,
          last_error_detail = NULL,
          next_attempt_at = NULL,
          updated_at = decision_time,
          version = version + 1
      WHERE id = approval_record.workflow_action_id
        AND organisation_id = context_organisation_id
        AND status NOT IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER');
    ELSE
      UPDATE public.workflow_actions
      SET status = 'CANCELLED',
          output = COALESCE(output, '{}'::jsonb)
            || jsonb_build_object(
              'approvalRequestId', approval_record.id,
              'approvalDecision', p_decision
            ),
          completed_at = decision_time,
          updated_at = decision_time,
          version = version + 1
      WHERE id = approval_record.workflow_action_id
        AND organisation_id = context_organisation_id
        AND status NOT IN ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTER');
    END IF;
  END IF;

  IF approval_record.workflow_run_id IS NOT NULL THEN
    IF p_decision = 'APPROVED' THEN
      UPDATE public.workflow_runs
      SET status = 'WAITING',
          next_action_summary = 'Approved action is ready to continue.',
          next_action_at = decision_time,
          last_error_code = NULL,
          last_error_detail = NULL,
          failed_at = NULL,
          updated_at = decision_time,
          version = version + 1
      WHERE id = approval_record.workflow_run_id
        AND organisation_id = context_organisation_id
        AND status IN ('RUNNING', 'WAITING', 'FAILED');
    ELSE
      UPDATE public.workflow_runs
      SET status = 'CANCELLED',
          current_step_key = NULL,
          next_action_summary = NULL,
          next_action_at = NULL,
          completed_at = decision_time,
          updated_at = decision_time,
          version = version + 1
      WHERE id = approval_record.workflow_run_id
        AND organisation_id = context_organisation_id
        AND status NOT IN ('COMPLETED', 'CANCELLED', 'DEAD_LETTER');
    END IF;
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), context_organisation_id, 'USER', actor_id,
    'businessos-api', 'approval.decided', 'approval_request',
    approval_record.id::text, 'SUCCESS',
    jsonb_build_object(
      'decision', p_decision,
      'riskLevel', approval_record.risk_level,
      'subjectType', approval_record.subject_type,
      'subjectId', approval_record.subject_id,
      'workflowRunId', approval_record.workflow_run_id,
      'workflowActionId', approval_record.workflow_action_id
    )
  );

  RETURN QUERY
  SELECT
    approval.id,
    approval.status,
    approval.version,
    recorded_decision_id,
    approval.decided_at
  FROM public.approval_requests AS approval
  WHERE approval.id = approval_record.id
    AND approval.organisation_id = context_organisation_id;
END
$function$;

ALTER FUNCTION private.decide_approval_request(
  uuid, integer, public.approval_decision_type, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.decide_approval_request(
  uuid, integer, public.approval_decision_type, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.decide_approval_request(
  uuid, integer, public.approval_decision_type, text
) TO businessos_app;

CREATE OR REPLACE FUNCTION private.process_automation_cycle(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  at_risk_count integer,
  breached_count integer,
  escalation_count integer,
  expired_approval_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  cycle_time timestamptz := pg_catalog.clock_timestamp();
  risk_total integer := 0;
  breach_total integer := 0;
  escalation_total integer := 0;
  expiry_total integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'automation cycle limit must be between 1 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH candidates AS (
    SELECT instance.id
    FROM public.sla_instances AS instance
    WHERE instance.status = 'ACTIVE'
      AND instance.warning_at <= cycle_time
      AND instance.due_at > cycle_time
    ORDER BY instance.warning_at, instance.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.sla_instances AS instance
    SET status = 'AT_RISK',
        at_risk_at = cycle_time,
        updated_at = cycle_time,
        version = instance.version + 1
    FROM candidates
    WHERE instance.id = candidates.id
      AND instance.status = 'ACTIVE'
    RETURNING instance.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO risk_total
  FROM updated;

  WITH candidates AS (
    SELECT instance.id
    FROM public.sla_instances AS instance
    WHERE instance.status IN ('ACTIVE', 'AT_RISK')
      AND instance.due_at <= cycle_time
    ORDER BY instance.due_at, instance.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.sla_instances AS instance
    SET status = 'BREACHED',
        breached_at = cycle_time,
        updated_at = cycle_time,
        version = instance.version + 1
    FROM candidates
    WHERE instance.id = candidates.id
      AND instance.status IN ('ACTIVE', 'AT_RISK')
    RETURNING instance.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO breach_total
  FROM updated;

  WITH candidates AS (
    SELECT
      instance.organisation_id,
      instance.id AS sla_instance_id,
      escalation_rule.id AS escalation_rule_id,
      escalation_rule.level,
      escalation_rule.action_key,
      instance.workflow_run_id,
      instance.workflow_action_id,
      instance.subject_type,
      instance.subject_id,
      instance.due_at,
      instance.breached_at
    FROM public.sla_instances AS instance
    JOIN public.escalation_rules AS escalation_rule
      ON escalation_rule.sla_policy_id = instance.sla_policy_id
     AND escalation_rule.organisation_id = instance.organisation_id
    WHERE instance.status = 'BREACHED'
      AND instance.breached_at IS NOT NULL
      AND escalation_rule.is_active
      AND escalation_rule.deleted_at IS NULL
      AND cycle_time >= instance.breached_at
        + pg_catalog.make_interval(
          secs => escalation_rule.after_breach_seconds
        )
      AND NOT EXISTS (
        SELECT 1
        FROM public.escalation_events AS existing_event
        WHERE existing_event.sla_instance_id = instance.id
          AND existing_event.escalation_rule_id = escalation_rule.id
      )
    ORDER BY
      instance.breached_at,
      escalation_rule.level,
      instance.id
    LIMIT p_limit
  ),
  inserted AS (
    INSERT INTO public.escalation_events (
      organisation_id, sla_instance_id, escalation_rule_id,
      level, action_key, status, details, occurred_at
    )
    SELECT
      candidate.organisation_id,
      candidate.sla_instance_id,
      candidate.escalation_rule_id,
      candidate.level,
      candidate.action_key,
      'RECORDED',
      jsonb_build_object(
        'workflowRunId', candidate.workflow_run_id,
        'workflowActionId', candidate.workflow_action_id,
        'subjectType', candidate.subject_type,
        'subjectId', candidate.subject_id,
        'dueAt', candidate.due_at,
        'breachedAt', candidate.breached_at
      ),
      cycle_time
    FROM candidates AS candidate
    ON CONFLICT (sla_instance_id, escalation_rule_id) DO NOTHING
    RETURNING id
  )
  SELECT pg_catalog.count(*)::integer
    INTO escalation_total
  FROM inserted;

  UPDATE public.workflow_actions AS work_action
  SET priority = 'URGENT',
      updated_at = cycle_time,
      version = work_action.version + 1
  WHERE work_action.id IN (
    SELECT DISTINCT instance.workflow_action_id
    FROM public.escalation_events AS escalation_event
    JOIN public.sla_instances AS instance
      ON instance.id = escalation_event.sla_instance_id
     AND instance.organisation_id = escalation_event.organisation_id
    WHERE escalation_event.occurred_at = cycle_time
      AND instance.workflow_action_id IS NOT NULL
  )
    AND work_action.priority <> 'URGENT'
    AND work_action.status NOT IN (
      'SUCCEEDED', 'CANCELLED', 'DEAD_LETTER'
    );

  UPDATE public.workflow_runs AS workflow_run
  SET next_action_summary =
        'SLA breached: manager attention is required.',
      next_action_at = cycle_time,
      updated_at = cycle_time,
      version = workflow_run.version + 1
  WHERE workflow_run.id IN (
    SELECT DISTINCT instance.workflow_run_id
    FROM public.escalation_events AS escalation_event
    JOIN public.sla_instances AS instance
      ON instance.id = escalation_event.sla_instance_id
     AND instance.organisation_id = escalation_event.organisation_id
    WHERE escalation_event.occurred_at = cycle_time
      AND instance.workflow_run_id IS NOT NULL
  )
    AND workflow_run.status IN ('RUNNING', 'WAITING')
    AND (
      workflow_run.next_action_summary IS DISTINCT FROM
        'SLA breached: manager attention is required.'
      OR workflow_run.next_action_at IS DISTINCT FROM cycle_time
    );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    escalation_event.organisation_id,
    'SYSTEM',
    NULL,
    'businessos-automation-worker',
    'sla.escalated',
    'escalation_event',
    escalation_event.id::text,
    'SUCCESS',
    jsonb_build_object(
      'slaInstanceId', escalation_event.sla_instance_id,
      'level', escalation_event.level,
      'actionKey', escalation_event.action_key
    )
  FROM public.escalation_events AS escalation_event
  WHERE escalation_event.occurred_at = cycle_time;

  WITH candidates AS (
    SELECT approval.id
    FROM public.approval_requests AS approval
    WHERE approval.status = 'PENDING'
      AND approval.expires_at <= cycle_time
    ORDER BY approval.expires_at, approval.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.approval_requests AS approval
    SET status = 'EXPIRED',
        updated_at = cycle_time,
        version = approval.version + 1
    FROM candidates
    WHERE approval.id = candidates.id
      AND approval.status = 'PENDING'
    RETURNING approval.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO expiry_total
  FROM updated;

  UPDATE public.workflow_actions AS work_action
  SET status = 'FAILED',
      last_error_code = 'APPROVAL_EXPIRED',
      last_error_detail =
        'The linked approval request expired before a decision.',
      updated_at = cycle_time,
      version = work_action.version + 1
  WHERE work_action.id IN (
    SELECT approval.workflow_action_id
    FROM public.approval_requests AS approval
    WHERE approval.status = 'EXPIRED'
      AND approval.updated_at = cycle_time
      AND approval.workflow_action_id IS NOT NULL
  )
    AND work_action.status NOT IN (
      'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'
    );

  UPDATE public.workflow_runs AS workflow_run
  SET status = 'FAILED',
      last_error_code = 'APPROVAL_EXPIRED',
      last_error_detail =
        'A linked approval request expired before a decision.',
      failed_at = cycle_time,
      updated_at = cycle_time,
      version = workflow_run.version + 1
  WHERE workflow_run.id IN (
    SELECT approval.workflow_run_id
    FROM public.approval_requests AS approval
    WHERE approval.status = 'EXPIRED'
      AND approval.updated_at = cycle_time
      AND approval.workflow_run_id IS NOT NULL
  )
    AND workflow_run.status NOT IN (
      'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'
    );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    approval.organisation_id,
    'SYSTEM',
    NULL,
    'businessos-automation-worker',
    'approval.expired',
    'approval_request',
    approval.id::text,
    'SUCCESS',
    jsonb_build_object(
      'subjectType', approval.subject_type,
      'subjectId', approval.subject_id,
      'riskLevel', approval.risk_level
    )
  FROM public.approval_requests AS approval
  WHERE approval.status = 'EXPIRED'
    AND approval.updated_at = cycle_time;

  RETURN QUERY SELECT
    risk_total,
    breach_total,
    escalation_total,
    expiry_total;
END
$function$;

ALTER FUNCTION private.process_automation_cycle(integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.process_automation_cycle(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.process_automation_cycle(integer)
  TO businessos_app;

WITH permission_seed (
  permission_key, permission_name, permission_description,
  resource_name, action_name, is_sensitive, requires_mfa
) AS (
  VALUES
    (
      'automation.read',
      'View workflow operations',
      'View authorised workflow definitions, runs and owned next actions.',
      'automation', 'read', true, false
    ),
    (
      'automation.manage',
      'Manage workflow operations',
      'Manage organisation workflow configuration and cross-owner work.',
      'automation', 'manage', true, true
    ),
    (
      'work_items.complete',
      'Complete workflow work items',
      'Complete owned workflow work items with recorded evidence.',
      'work_items', 'complete', true, false
    ),
    (
      'sla.read',
      'View SLA controls',
      'View authorised SLA policies, active timers and breach state.',
      'sla', 'read', true, false
    ),
    (
      'sla.manage',
      'Manage SLA controls',
      'Change controlled organisation SLA target configuration.',
      'sla', 'manage', true, true
    ),
    (
      'approvals.read',
      'View approval requests',
      'View approval requests for authorised business records.',
      'approvals', 'read', true, false
    ),
    (
      'approvals.request',
      'Request approval',
      'Create approval requests for controlled business actions.',
      'approvals', 'request', true, false
    ),
    (
      'approvals.decide',
      'Decide approval requests',
      'Approve or reject assigned requests with an auditable decision.',
      'approvals', 'decide', true, true
    ),
    (
      'escalations.read',
      'View operational escalations',
      'View authorised SLA breach and escalation evidence.',
      'escalations', 'read', true, false
    )
)
INSERT INTO public.permissions (
  id, key, name, description, resource, action, data_scope,
  is_sensitive, requires_mfa, allows_ai_use, is_active,
  metadata, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  permission_key,
  permission_name,
  permission_description,
  resource_name,
  action_name,
  'ORGANISATION'::public.permission_data_scope,
  is_sensitive,
  requires_mfa,
  false,
  true,
  jsonb_build_object(
    'classification', 'personal-confidential',
    'contains_pii', true,
    'ai_default', 'deny',
    'control_family', 'workflow-sla-approval'
  ),
  pg_catalog.now(),
  pg_catalog.now()
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

INSERT INTO public.role_permissions (
  id, role_id, permission_id, created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  role_record.id,
  permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN (
    'organisation_owner',
    'system_administrator'
  )
  AND role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.resource IN (
    'automation', 'work_items', 'sla', 'approvals', 'escalations'
  )
  AND permission_record.is_active
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

REVOKE ALL PRIVILEGES ON
  public.workflow_definitions,
  public.workflow_versions,
  public.workflow_runs,
  public.workflow_actions,
  public.sla_policies,
  public.sla_instances,
  public.escalation_rules,
  public.escalation_events,
  public.approval_requests,
  public.approval_decisions
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON TYPE
  public.automation_subject_type,
  public.workflow_definition_status,
  public.workflow_run_status,
  public.workflow_action_type,
  public.workflow_action_status,
  public.work_priority,
  public.sla_instance_status,
  public.escalation_event_status,
  public.approval_request_status,
  public.approval_decision_type,
  public.approval_risk_level
TO businessos_app, businessos_policy_reader;

GRANT SELECT ON
  public.workflow_definitions,
  public.workflow_versions,
  public.workflow_runs,
  public.workflow_actions,
  public.sla_policies,
  public.sla_instances,
  public.escalation_rules,
  public.escalation_events,
  public.approval_requests,
  public.approval_decisions
TO businessos_app;

GRANT INSERT ON public.approval_requests TO businessos_app;
GRANT UPDATE ON public.sla_policies TO businessos_app;

ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sla_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY policy_reader_workflow_definitions
  ON public.workflow_definitions
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_workflow_versions
  ON public.workflow_versions
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_workflow_runs
  ON public.workflow_runs
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_workflow_actions
  ON public.workflow_actions
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_sla_policies
  ON public.sla_policies
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_sla_instances
  ON public.sla_instances
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_escalation_rules
  ON public.escalation_rules
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_escalation_events
  ON public.escalation_events
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_approval_requests
  ON public.approval_requests
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_approval_decisions
  ON public.approval_decisions
  FOR SELECT TO businessos_policy_reader USING (true);

CREATE POLICY workflow_definitions_select
  ON public.workflow_definitions
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(
      organisation_id,
      'automation.read'
    )
  );

CREATE POLICY workflow_versions_select
  ON public.workflow_versions
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'automation.read'
    )
  );

CREATE POLICY workflow_runs_select
  ON public.workflow_runs
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'automation.read'
    )
    AND private.can_read_automation_subject(
      organisation_id,
      subject_type,
      subject_id
    )
  );

CREATE POLICY workflow_actions_select
  ON public.workflow_actions
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'automation.read'
    )
    AND EXISTS (
      SELECT 1
      FROM public.workflow_runs AS workflow_run
      WHERE workflow_run.id = workflow_actions.workflow_run_id
        AND workflow_run.organisation_id =
          workflow_actions.organisation_id
        AND private.can_read_automation_subject(
          workflow_run.organisation_id,
          workflow_run.subject_type,
          workflow_run.subject_id
        )
    )
  );

CREATE POLICY sla_policies_select
  ON public.sla_policies
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(
      organisation_id,
      'sla.read'
    )
  );

CREATE POLICY sla_policies_update
  ON public.sla_policies
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(
      organisation_id,
      'sla.manage'
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND private.has_organisation_permission(
      organisation_id,
      'sla.manage'
    )
    AND updated_by_user_profile_id = private.current_user_id()
  );

CREATE POLICY sla_instances_select
  ON public.sla_instances
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'sla.read'
    )
    AND private.can_read_automation_subject(
      organisation_id,
      subject_type,
      subject_id
    )
  );

CREATE POLICY escalation_rules_select
  ON public.escalation_rules
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(
      organisation_id,
      'sla.read'
    )
  );

CREATE POLICY escalation_events_select
  ON public.escalation_events
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'escalations.read'
    )
    AND EXISTS (
      SELECT 1
      FROM public.sla_instances AS instance
      WHERE instance.id = escalation_events.sla_instance_id
        AND instance.organisation_id =
          escalation_events.organisation_id
        AND private.can_read_automation_subject(
          instance.organisation_id,
          instance.subject_type,
          instance.subject_id
        )
    )
  );

CREATE POLICY approval_requests_select
  ON public.approval_requests
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'approvals.read'
    )
    AND private.can_read_automation_subject(
      organisation_id,
      subject_type,
      subject_id
    )
  );

CREATE POLICY approval_requests_insert
  ON public.approval_requests
  FOR INSERT TO businessos_app
  WITH CHECK (
    status = 'PENDING'
    AND requested_by_actor_type = 'USER'
    AND requested_by_user_profile_id = private.current_user_id()
    AND private.has_organisation_permission(
      organisation_id,
      'approvals.request'
    )
    AND private.can_read_automation_subject(
      organisation_id,
      subject_type,
      subject_id
    )
  );

CREATE POLICY approval_decisions_select
  ON public.approval_decisions
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id,
      'approvals.read'
    )
    AND EXISTS (
      SELECT 1
      FROM public.approval_requests AS approval
      WHERE approval.id = approval_decisions.approval_request_id
        AND approval.organisation_id =
          approval_decisions.organisation_id
        AND private.can_read_automation_subject(
          approval.organisation_id,
          approval.subject_type,
          approval.subject_id
        )
    )
  );

COMMENT ON TABLE public.workflow_runs IS
  'Versioned, idempotent workflow executions over existing BusinessOS records.';
COMMENT ON TABLE public.workflow_actions IS
  'Permission-scoped human or system work items with retry and evidence state.';
COMMENT ON TABLE public.sla_instances IS
  'Deterministic warning, due, breach and satisfaction timers.';
COMMENT ON TABLE public.approval_decisions IS
  'Append-only approval evidence; decisions are committed atomically.';

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('compliance_manager', 'automation.read'),
    ('compliance_manager', 'sla.read'),
    ('compliance_manager', 'sla.manage'),
    ('compliance_manager', 'approvals.read'),
    ('compliance_manager', 'approvals.decide'),
    ('compliance_manager', 'escalations.read'),
    ('solicitor', 'automation.read'),
    ('solicitor', 'work_items.complete'),
    ('solicitor', 'sla.read'),
    ('solicitor', 'approvals.read'),
    ('solicitor', 'approvals.request'),
    ('solicitor', 'approvals.decide'),
    ('solicitor', 'escalations.read'),
    ('sales_manager', 'automation.read'),
    ('sales_manager', 'automation.manage'),
    ('sales_manager', 'work_items.complete'),
    ('sales_manager', 'sla.read'),
    ('sales_manager', 'sla.manage'),
    ('sales_manager', 'approvals.read'),
    ('sales_manager', 'approvals.request'),
    ('sales_manager', 'approvals.decide'),
    ('sales_manager', 'escalations.read'),
    ('sales_agent', 'automation.read'),
    ('sales_agent', 'work_items.complete'),
    ('sales_agent', 'sla.read'),
    ('sales_agent', 'approvals.read'),
    ('sales_agent', 'approvals.request'),
    ('sales_agent', 'escalations.read'),
    ('case_manager', 'automation.read'),
    ('case_manager', 'automation.manage'),
    ('case_manager', 'work_items.complete'),
    ('case_manager', 'sla.read'),
    ('case_manager', 'sla.manage'),
    ('case_manager', 'approvals.read'),
    ('case_manager', 'approvals.request'),
    ('case_manager', 'approvals.decide'),
    ('case_manager', 'escalations.read'),
    ('case_worker', 'automation.read'),
    ('case_worker', 'work_items.complete'),
    ('case_worker', 'sla.read'),
    ('case_worker', 'approvals.read'),
    ('case_worker', 'approvals.request'),
    ('case_worker', 'escalations.read'),
    ('read_only', 'automation.read'),
    ('read_only', 'sla.read'),
    ('read_only', 'approvals.read'),
    ('read_only', 'escalations.read')
)
INSERT INTO public.role_permissions (
  id, role_id, permission_id, created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  role_record.id,
  permission_record.id,
  pg_catalog.now()
FROM role_permission_seed
JOIN public.roles AS role_record
  ON role_record.key = role_permission_seed.role_key
JOIN public.permissions AS permission_record
  ON permission_record.key = role_permission_seed.permission_key
WHERE role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.is_active
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
