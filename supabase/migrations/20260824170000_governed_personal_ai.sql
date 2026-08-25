-- Gate K: governed personal AI runtime integrated with the existing workforce,
-- RBAC, RLS, approval and audit controls.
BEGIN;

CREATE TYPE public.agent_conversation_status AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE public.agent_run_mode AS ENUM ('CHAT', 'DAILY_BRIEF');
CREATE TYPE public.agent_run_status AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE public.agent_message_role AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE public.agent_action_status AS ENUM (
  'PROPOSED', 'PENDING_APPROVAL', 'BLOCKED'
);
CREATE TYPE public.agent_tool_call_status AS ENUM (
  'SUCCEEDED', 'DENIED', 'FAILED'
);

CREATE TABLE public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  agent_profile_id uuid,
  title varchar(160) NOT NULL,
  status public.agent_conversation_status NOT NULL DEFAULT 'ACTIVE',
  last_message_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  archived_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_agent_conversations_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_agent_conversations_owner UNIQUE (
    id, organisation_id, user_profile_id
  ),
  CONSTRAINT fk_agent_conversations_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_conversations_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_conversations_profile FOREIGN KEY (
    agent_profile_id, organisation_id
  ) REFERENCES public.agent_profiles(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agent_conversations_title CHECK (
    char_length(pg_catalog.btrim(title)) BETWEEN 1 AND 160
  ),
  CONSTRAINT ck_agent_conversations_archive CHECK (
    (status = 'ACTIVE' AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT ck_agent_conversations_version CHECK (version > 0)
);

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  agent_profile_id uuid,
  client_request_id uuid NOT NULL,
  mode public.agent_run_mode NOT NULL,
  status public.agent_run_status NOT NULL DEFAULT 'RUNNING',
  model varchar(120) NOT NULL,
  provider_response_id varchar(240),
  provider_request_id varchar(240),
  request_sha256 char(64) NOT NULL,
  latency_ms integer,
  error_code varchar(80),
  error_detail varchar(500),
  started_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz(6),
  failed_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_agent_runs_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_agent_runs_owner UNIQUE (id, organisation_id, user_profile_id),
  CONSTRAINT uq_agent_runs_client_request UNIQUE (
    organisation_id, user_profile_id, client_request_id
  ),
  CONSTRAINT fk_agent_runs_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_runs_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_runs_conversation FOREIGN KEY (
    conversation_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_conversations(
    id, organisation_id, user_profile_id
  )
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_runs_profile FOREIGN KEY (
    agent_profile_id, organisation_id
  ) REFERENCES public.agent_profiles(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agent_runs_model CHECK (
    char_length(pg_catalog.btrim(model)) BETWEEN 1 AND 120
  ),
  CONSTRAINT ck_agent_runs_request_sha CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_agent_runs_latency CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT ck_agent_runs_version CHECK (version > 0),
  CONSTRAINT ck_agent_runs_lifecycle CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND failed_at IS NULL
      AND error_code IS NULL AND error_detail IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND failed_at IS NULL
      AND error_code IS NULL AND error_detail IS NULL)
    OR (status = 'FAILED' AND completed_at IS NULL AND failed_at IS NOT NULL
      AND error_code IS NOT NULL)
  )
);

CREATE TABLE public.agent_messages (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  run_id uuid NOT NULL,
  role public.agent_message_role NOT NULL,
  content text NOT NULL,
  structured_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_agent_messages_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_agent_messages_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_messages_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_messages_conversation FOREIGN KEY (
    conversation_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_conversations(
    id, organisation_id, user_profile_id
  )
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_messages_run FOREIGN KEY (
    run_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_runs(id, organisation_id, user_profile_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agent_messages_content CHECK (
    char_length(pg_catalog.btrim(content)) BETWEEN 1 AND 12000
  ),
  CONSTRAINT ck_agent_messages_structured CHECK (
    pg_catalog.jsonb_typeof(structured_content) = 'object'
  )
);

CREATE TABLE public.agent_actions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  run_id uuid NOT NULL,
  approval_request_id uuid,
  tool_key varchar(160) NOT NULL,
  required_permission_key varchar(180) NOT NULL,
  subject_type public.automation_subject_type NOT NULL,
  subject_id uuid NOT NULL,
  title varchar(240) NOT NULL,
  summary varchar(4000) NOT NULL,
  risk_level public.approval_risk_level NOT NULL,
  proposed_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.agent_action_status NOT NULL DEFAULT 'PROPOSED',
  blocked_reason varchar(500),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_agent_actions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_agent_actions_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_actions_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_actions_conversation FOREIGN KEY (
    conversation_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_conversations(
    id, organisation_id, user_profile_id
  )
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_actions_run FOREIGN KEY (
    run_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_runs(id, organisation_id, user_profile_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_actions_approval FOREIGN KEY (
    approval_request_id, organisation_id
  ) REFERENCES public.approval_requests(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_actions_permission FOREIGN KEY (required_permission_key)
    REFERENCES public.permissions(key) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agent_actions_tool CHECK (
    tool_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_agent_actions_text CHECK (
    char_length(pg_catalog.btrim(title)) BETWEEN 3 AND 240
    AND char_length(pg_catalog.btrim(summary)) BETWEEN 3 AND 4000
  ),
  CONSTRAINT ck_agent_actions_payload CHECK (
    pg_catalog.jsonb_typeof(proposed_payload) = 'object'
  ),
  CONSTRAINT ck_agent_actions_status CHECK (
    (status = 'PENDING_APPROVAL' AND approval_request_id IS NOT NULL
      AND blocked_reason IS NULL)
    OR (status = 'BLOCKED' AND approval_request_id IS NULL
      AND blocked_reason IS NOT NULL)
    OR (status = 'PROPOSED' AND approval_request_id IS NULL
      AND blocked_reason IS NULL)
  ),
  CONSTRAINT ck_agent_actions_version CHECK (version > 0)
);

CREATE TABLE public.agent_tool_calls (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  tool_key varchar(160) NOT NULL,
  status public.agent_tool_call_status NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(80),
  started_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_agent_tool_calls_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_agent_tool_calls_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_tool_calls_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_tool_calls_run FOREIGN KEY (
    run_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_runs(id, organisation_id, user_profile_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agent_tool_calls_tool CHECK (
    tool_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_agent_tool_calls_json CHECK (
    pg_catalog.jsonb_typeof(arguments) = 'object'
    AND pg_catalog.jsonb_typeof(result_summary) = 'object'
  ),
  CONSTRAINT ck_agent_tool_calls_error CHECK (
    (status = 'SUCCEEDED' AND error_code IS NULL)
    OR (status IN ('DENIED', 'FAILED') AND error_code IS NOT NULL)
  ),
  CONSTRAINT ck_agent_tool_calls_time CHECK (completed_at >= started_at)
);

CREATE TABLE public.agent_usage (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  run_id uuid NOT NULL,
  model varchar(120) NOT NULL,
  input_tokens integer NOT NULL,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  estimated_cost_minor numeric(18,6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT uq_agent_usage_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_agent_usage_run UNIQUE (
    run_id, organisation_id, user_profile_id
  ),
  CONSTRAINT fk_agent_usage_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_usage_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_usage_run FOREIGN KEY (
    run_id, organisation_id, user_profile_id
  ) REFERENCES public.agent_runs(id, organisation_id, user_profile_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agent_usage_tokens CHECK (
    input_tokens >= 0 AND cached_input_tokens >= 0 AND output_tokens >= 0
    AND total_tokens >= input_tokens + output_tokens
    AND cached_input_tokens <= input_tokens
  ),
  CONSTRAINT ck_agent_usage_cost CHECK (
    estimated_cost_minor IS NULL OR estimated_cost_minor >= 0
  )
);

CREATE INDEX ix_agent_conversations_owner_recent
  ON public.agent_conversations(
    organisation_id, user_profile_id, last_message_at DESC
  );
CREATE INDEX ix_agent_runs_owner_recent
  ON public.agent_runs(organisation_id, user_profile_id, created_at DESC);
CREATE INDEX ix_agent_runs_status
  ON public.agent_runs(organisation_id, status, started_at);
CREATE INDEX ix_agent_messages_conversation_recent
  ON public.agent_messages(
    organisation_id, conversation_id, created_at DESC
  );
CREATE INDEX ix_agent_actions_owner_status
  ON public.agent_actions(
    organisation_id, user_profile_id, status, created_at DESC
  );
CREATE INDEX ix_agent_actions_approval
  ON public.agent_actions(organisation_id, approval_request_id)
  WHERE approval_request_id IS NOT NULL;
CREATE INDEX ix_agent_tool_calls_run
  ON public.agent_tool_calls(organisation_id, run_id, created_at);

WITH permission_seed(
  permission_key, permission_name, permission_description,
  resource_name, action_name, data_scope, is_sensitive, requires_mfa
) AS (
  VALUES (
    'ai.workspace.access',
    'Use personal AI workspace',
    'Use the governed personal AI workspace within the employee''s existing permissions.',
    'ai_workspace', 'access', 'OWN'::public.permission_data_scope, true, false
  )
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
  jsonb_build_object(
    'classification', 'personal-confidential',
    'contains_pii', true,
    'ai_default', 'workspace-gate',
    'control_family', 'gate-k-governed-personal-ai'
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

INSERT INTO public.role_permissions(id, role_id, permission_id, created_at)
SELECT pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
JOIN public.permissions AS permission_record
  ON permission_record.key = 'ai.workspace.access'
 AND permission_record.is_active = true
 AND permission_record.deleted_at IS NULL
WHERE role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.key IN (
    'organisation_owner', 'system_administrator', 'compliance_manager',
    'solicitor', 'sales_manager', 'sales_agent', 'finance', 'read_only',
    'case_manager', 'case_worker'
  )
  AND role_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Gate K authorised AI permission allow-list evolution.
-- Runtime writes remain prohibited. This schema migration holds the table lock
-- and restores the identical immutable trigger before the transaction commits.
DROP TRIGGER permissions_immutable ON public.permissions;

UPDATE public.permissions
SET allows_ai_use = true,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'ai_governance', 'gate-k-safe-context-or-proposal',
      'ai_execution', 'denied'
    ),
    updated_at = pg_catalog.now()
WHERE key IN (
  'organisation.read',
  'enquiries.read', 'enquiries.read_all',
  'clients.read', 'clients.read_all',
  'matters.read', 'matters.read_all',
  'tasks.read', 'tasks.create',
  'deadlines.read',
  'document_requests.read', 'document_requests.create',
  'communications.read', 'communications.send',
  'finance.read', 'approvals.read', 'approvals.request',
  'command_centre.read'
)
  AND is_active = true
  AND deleted_at IS NULL;

CREATE TRIGGER permissions_immutable
  BEFORE UPDATE ON public.permissions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'key', 'resource', 'action', 'data_scope', 'is_sensitive',
    'requires_mfa', 'allows_ai_use');

WITH profile_actor AS (
  SELECT DISTINCT ON (membership.organisation_id)
    membership.organisation_id,
    membership.user_profile_id
  FROM public.organisation_memberships AS membership
  LEFT JOIN public.role_assignments AS assignment
    ON assignment.organisation_membership_id = membership.id
   AND assignment.organisation_id = membership.organisation_id
   AND assignment.revoked_at IS NULL
   AND assignment.deleted_at IS NULL
  LEFT JOIN public.roles AS role_record
    ON role_record.id = assignment.role_id
  WHERE membership.status = 'ACTIVE'
    AND membership.deleted_at IS NULL
  ORDER BY membership.organisation_id,
    CASE role_record.key
      WHEN 'organisation_owner' THEN 0
      WHEN 'system_administrator' THEN 1
      ELSE 2
    END,
    membership.joined_at NULLS LAST,
    membership.created_at
)
INSERT INTO public.agent_profiles(
  id, organisation_id, department_id, key, name, description,
  behaviour_instructions, authority_ceiling, requires_human_review,
  version, is_active, created_by_user_profile_id,
  updated_by_user_profile_id, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), profile_actor.organisation_id, NULL,
  'personal-ai-default', 'BusinessOS Personal AI',
  'Safe default personal assistant for authorised employees.',
  'Use only records visible to the current employee. Never invent facts, execute actions, provide final legal or regulated advice, or bypass human approval. Draft and propose concise next steps with clear evidence.',
  'PROPOSE'::public.agent_authority_level, true, 1, true,
  profile_actor.user_profile_id, profile_actor.user_profile_id,
  pg_catalog.now(), pg_catalog.now()
FROM profile_actor
ON CONFLICT (organisation_id, key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  behaviour_instructions = EXCLUDED.behaviour_instructions,
  authority_ceiling = 'PROPOSE',
  requires_human_review = true,
  is_active = true,
  updated_by_user_profile_id = EXCLUDED.updated_by_user_profile_id,
  deleted_at = NULL,
  version = public.agent_profiles.version + 1,
  updated_at = pg_catalog.now();

WITH policy_seed(
  tool_key, permission_key, authority_level, maximum_data_scope,
  requires_approval, max_actions_per_run, configuration
) AS (
  VALUES
    ('workload.read', 'tasks.read', 'READ'::public.agent_authority_level,
      'OWN'::public.permission_data_scope, false, 25,
      '{"purpose":"personal workload and daily brief"}'::jsonb),
    ('record.search', 'matters.read', 'READ'::public.agent_authority_level,
      'OWN'::public.permission_data_scope, false, 25,
      '{"purpose":"permission-filtered record context"}'::jsonb),
    ('matter.task.propose', 'tasks.create', 'PROPOSE'::public.agent_authority_level,
      'OWN'::public.permission_data_scope, true, 5,
      '{"execution":"disabled","approval":"required"}'::jsonb),
    ('matter.document-request.propose', 'document_requests.create',
      'PROPOSE'::public.agent_authority_level,
      'OWN'::public.permission_data_scope, true, 5,
      '{"execution":"disabled","approval":"required"}'::jsonb),
    ('communication.draft', 'communications.send',
      'DRAFT'::public.agent_authority_level,
      'OWN'::public.permission_data_scope, true, 5,
      '{"execution":"disabled","approval":"required"}'::jsonb),
    ('record.escalate', 'approvals.request',
      'PROPOSE'::public.agent_authority_level,
      'OWN'::public.permission_data_scope, true, 5,
      '{"execution":"disabled","approval":"required"}'::jsonb)
)
INSERT INTO public.agent_policies(
  id, organisation_id, agent_profile_id, tool_key,
  required_permission_key, authority_level, maximum_data_scope,
  requires_approval, requires_mfa, max_actions_per_run,
  configuration, is_active, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), profile.organisation_id, profile.id,
  policy_seed.tool_key, policy_seed.permission_key,
  policy_seed.authority_level, policy_seed.maximum_data_scope,
  policy_seed.requires_approval, permission.requires_mfa,
  policy_seed.max_actions_per_run, policy_seed.configuration,
  true, pg_catalog.now(), pg_catalog.now()
FROM public.agent_profiles AS profile
CROSS JOIN policy_seed
JOIN public.permissions AS permission
  ON permission.key = policy_seed.permission_key
 AND permission.allows_ai_use = true
 AND permission.is_active = true
 AND permission.deleted_at IS NULL
WHERE profile.key = 'personal-ai-default'
  AND profile.is_active = true
  AND profile.deleted_at IS NULL
ON CONFLICT (agent_profile_id, tool_key) DO UPDATE SET
  required_permission_key = EXCLUDED.required_permission_key,
  authority_level = EXCLUDED.authority_level,
  maximum_data_scope = EXCLUDED.maximum_data_scope,
  requires_approval = EXCLUDED.requires_approval,
  requires_mfa = EXCLUDED.requires_mfa,
  max_actions_per_run = EXCLUDED.max_actions_per_run,
  configuration = EXCLUDED.configuration,
  is_active = true,
  deleted_at = NULL,
  updated_at = pg_catalog.now();

-- Keep Gate K available for organisations and employees created after this
-- migration. These triggers extend the existing bootstrap/onboarding flow;
-- they do not create a second tenant or identity system.
CREATE OR REPLACE FUNCTION private.provision_personal_ai_membership_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_agent_profile_id uuid;
BEGIN
  IF NEW.status <> 'ACTIVE' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.id
  INTO v_agent_profile_id
  FROM public.agent_profiles AS profile
  WHERE profile.organisation_id = NEW.organisation_id
    AND profile.key = 'personal-ai-default'
    AND profile.is_active = true
    AND profile.deleted_at IS NULL
  LIMIT 1;

  IF v_agent_profile_id IS NULL THEN
    INSERT INTO public.agent_profiles(
      id, organisation_id, department_id, key, name, description,
      behaviour_instructions, authority_ceiling, requires_human_review,
      version, is_active, created_by_user_profile_id,
      updated_by_user_profile_id, created_at, updated_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), NEW.organisation_id, NULL,
      'personal-ai-default', 'BusinessOS Personal AI',
      'Safe default personal assistant for authorised employees.',
      'Use only records visible to the current employee. Never invent facts, execute actions, provide final legal or regulated advice, or bypass human approval. Draft and propose concise next steps with clear evidence.',
      'PROPOSE', true, 1, true, NEW.user_profile_id,
      NEW.user_profile_id, pg_catalog.now(), pg_catalog.now()
    )
    ON CONFLICT (organisation_id, key) DO NOTHING
    RETURNING id INTO v_agent_profile_id;
  END IF;

  IF v_agent_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.agent_policies(
    id, organisation_id, agent_profile_id, tool_key,
    required_permission_key, authority_level, maximum_data_scope,
    requires_approval, requires_mfa, max_actions_per_run,
    configuration, is_active, created_at, updated_at
  )
  SELECT
    pg_catalog.gen_random_uuid(), NEW.organisation_id, v_agent_profile_id,
    seed.tool_key, seed.permission_key, seed.authority_level,
    'OWN'::public.permission_data_scope, seed.requires_approval,
    permission.requires_mfa, seed.max_actions_per_run,
    seed.configuration, true, pg_catalog.now(), pg_catalog.now()
  FROM (
    VALUES
      ('workload.read', 'tasks.read', 'READ'::public.agent_authority_level,
        false, 25, '{"purpose":"personal workload and daily brief"}'::jsonb),
      ('record.search', 'matters.read', 'READ'::public.agent_authority_level,
        false, 25, '{"purpose":"permission-filtered record context"}'::jsonb),
      ('matter.task.propose', 'tasks.create', 'PROPOSE'::public.agent_authority_level,
        true, 5, '{"execution":"disabled","approval":"required"}'::jsonb),
      ('matter.document-request.propose', 'document_requests.create',
        'PROPOSE'::public.agent_authority_level, true, 5,
        '{"execution":"disabled","approval":"required"}'::jsonb),
      ('communication.draft', 'communications.send',
        'DRAFT'::public.agent_authority_level, true, 5,
        '{"execution":"disabled","approval":"required"}'::jsonb),
      ('record.escalate', 'approvals.request',
        'PROPOSE'::public.agent_authority_level, true, 5,
        '{"execution":"disabled","approval":"required"}'::jsonb)
  ) AS seed(
    tool_key, permission_key, authority_level, requires_approval,
    max_actions_per_run, configuration
  )
  JOIN public.permissions AS permission
    ON permission.key = seed.permission_key
   AND permission.allows_ai_use = true
   AND permission.is_active = true
   AND permission.deleted_at IS NULL
  ON CONFLICT (agent_profile_id, tool_key) DO NOTHING;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.provision_personal_ai_membership_trigger()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.provision_personal_ai_membership_trigger()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE TRIGGER organisation_memberships_provision_personal_ai
  AFTER INSERT OR UPDATE OF status, deleted_at
  ON public.organisation_memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.provision_personal_ai_membership_trigger();

CREATE OR REPLACE FUNCTION private.provision_personal_ai_role_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.scope = 'ORGANISATION'
     AND NEW.organisation_id IS NOT NULL
     AND NEW.deleted_at IS NULL
     AND NEW.key IN (
       'organisation_owner', 'system_administrator', 'compliance_manager',
       'solicitor', 'sales_manager', 'sales_agent', 'finance', 'read_only',
       'case_manager', 'case_worker'
     ) THEN
    INSERT INTO public.role_permissions(id, role_id, permission_id, created_at)
    SELECT pg_catalog.gen_random_uuid(), NEW.id, permission.id,
      pg_catalog.now()
    FROM public.permissions AS permission
    WHERE permission.key = 'ai.workspace.access'
      AND permission.is_active = true
      AND permission.deleted_at IS NULL
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.provision_personal_ai_role_trigger()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.provision_personal_ai_role_trigger()
  FROM PUBLIC, anon, authenticated, service_role, businessos_app;

CREATE TRIGGER roles_provision_personal_ai_access
  AFTER INSERT OR UPDATE OF key, scope, organisation_id, deleted_at
  ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION private.provision_personal_ai_role_trigger();

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.can_access_personal_ai(
  p_organisation_id uuid,
  p_user_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id = private.current_organisation_id()
    AND p_user_profile_id = private.current_user_id()
    AND private.has_organisation_permission(
      p_organisation_id,
      'ai.workspace.access'
    )
$function$;

ALTER FUNCTION private.can_access_personal_ai(uuid, uuid)
  OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.can_access_personal_ai(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_personal_ai(uuid, uuid)
  TO businessos_app;

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_calls FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_conversations_select ON public.agent_conversations
  FOR SELECT TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_conversations_insert ON public.agent_conversations
  FOR INSERT TO businessos_app
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_conversations_update ON public.agent_conversations
  FOR UPDATE TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id))
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));

CREATE POLICY agent_runs_select ON public.agent_runs
  FOR SELECT TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_runs_insert ON public.agent_runs
  FOR INSERT TO businessos_app
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_runs_update ON public.agent_runs
  FOR UPDATE TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id))
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));

CREATE POLICY agent_messages_select ON public.agent_messages
  FOR SELECT TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_messages_insert ON public.agent_messages
  FOR INSERT TO businessos_app
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));

CREATE POLICY agent_actions_select ON public.agent_actions
  FOR SELECT TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_actions_insert ON public.agent_actions
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.can_access_personal_ai(organisation_id, user_profile_id)
    AND private.can_read_automation_subject(
      organisation_id, subject_type, subject_id
    )
  );
CREATE POLICY agent_actions_update ON public.agent_actions
  FOR UPDATE TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id))
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));

CREATE POLICY agent_tool_calls_select ON public.agent_tool_calls
  FOR SELECT TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_tool_calls_insert ON public.agent_tool_calls
  FOR INSERT TO businessos_app
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));

CREATE POLICY agent_usage_select ON public.agent_usage
  FOR SELECT TO businessos_app
  USING (private.can_access_personal_ai(organisation_id, user_profile_id));
CREATE POLICY agent_usage_insert ON public.agent_usage
  FOR INSERT TO businessos_app
  WITH CHECK (private.can_access_personal_ai(organisation_id, user_profile_id));

GRANT SELECT, INSERT, UPDATE ON public.agent_conversations TO businessos_app;
GRANT SELECT, INSERT, UPDATE ON public.agent_runs TO businessos_app;
GRANT SELECT, INSERT ON public.agent_messages TO businessos_app;
GRANT SELECT, INSERT, UPDATE ON public.agent_actions TO businessos_app;
GRANT SELECT, INSERT ON public.agent_tool_calls TO businessos_app;
GRANT SELECT, INSERT ON public.agent_usage TO businessos_app;

CREATE OR REPLACE FUNCTION private.reject_agent_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'AI evidence is append-only'
    USING ERRCODE = 'insufficient_privilege';
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_agent_conversation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.user_profile_id IS DISTINCT FROM OLD.user_profile_id
     OR NEW.agent_profile_id IS DISTINCT FROM OLD.agent_profile_id
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid AI conversation update'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_agent_run_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.user_profile_id IS DISTINCT FROM OLD.user_profile_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.agent_profile_id IS DISTINCT FROM OLD.agent_profile_id
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.status <> 'RUNNING'
     OR NEW.status NOT IN ('COMPLETED', 'FAILED')
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid AI run transition'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_agent_action_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.user_profile_id IS DISTINCT FROM OLD.user_profile_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.tool_key IS DISTINCT FROM OLD.tool_key
     OR NEW.required_permission_key IS DISTINCT FROM OLD.required_permission_key
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.risk_level IS DISTINCT FROM OLD.risk_level
     OR NEW.proposed_payload IS DISTINCT FROM OLD.proposed_payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.status <> 'PROPOSED'
     OR NOT (
       (NEW.status = 'PENDING_APPROVAL'
         AND NEW.approval_request_id IS NOT NULL
         AND NEW.blocked_reason IS NULL)
       OR (NEW.status = 'BLOCKED'
         AND NEW.approval_request_id IS NULL
         AND NEW.blocked_reason IS NOT NULL)
     )
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid AI action transition'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.reject_agent_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_agent_conversation_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_agent_run_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_agent_action_update() FROM PUBLIC;

CREATE TRIGGER agent_messages_append_only
  BEFORE UPDATE OR DELETE ON public.agent_messages
  FOR EACH ROW EXECUTE FUNCTION private.reject_agent_evidence_mutation();
CREATE TRIGGER agent_tool_calls_append_only
  BEFORE UPDATE OR DELETE ON public.agent_tool_calls
  FOR EACH ROW EXECUTE FUNCTION private.reject_agent_evidence_mutation();
CREATE TRIGGER agent_usage_append_only
  BEFORE UPDATE OR DELETE ON public.agent_usage
  FOR EACH ROW EXECUTE FUNCTION private.reject_agent_evidence_mutation();
CREATE TRIGGER agent_conversations_validate_update
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION private.validate_agent_conversation_update();
CREATE TRIGGER agent_runs_validate_update
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION private.validate_agent_run_update();
CREATE TRIGGER agent_actions_validate_update
  BEFORE UPDATE ON public.agent_actions
  FOR EACH ROW EXECUTE FUNCTION private.validate_agent_action_update();

COMMENT ON TABLE public.agent_conversations IS
  'Private per-employee AI conversations; content is never manager-readable by default.';
COMMENT ON TABLE public.agent_actions IS
  'Typed AI proposals only. Approval does not imply operational execution.';
COMMENT ON COLUMN public.agent_usage.estimated_cost_minor IS
  'Optional evidence supplied by a separately governed price catalogue; Gate K leaves it null.';

COMMIT;
