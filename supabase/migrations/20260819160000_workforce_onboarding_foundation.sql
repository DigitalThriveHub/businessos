-- BusinessOS workforce onboarding foundation.
--
-- This migration is deliberately additive. It does not replace the already
-- deployed private.accept_organisation_invitation function. A following
-- migration will extend that function after the API contract is updated.
--
-- Security model:
--   * every business row is tenant-bound by organisation_id;
--   * cross-tenant references use composite foreign keys;
--   * RLS is enabled and forced on every new table;
--   * browser Supabase roles receive no access;
--   * NestJS remains the only normal data-access path;
--   * role permissions, job duties, KPI targets and AI authority are distinct;
--   * an invitation captures an immutable onboarding plan.

BEGIN;

CREATE TYPE public.workforce_assignment_status AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'ENDED'
);

CREATE TYPE public.kpi_value_type AS ENUM (
  'NUMBER',
  'PERCENTAGE',
  'CURRENCY',
  'DURATION_SECONDS',
  'RATING'
);

CREATE TYPE public.kpi_direction AS ENUM (
  'HIGHER_IS_BETTER',
  'LOWER_IS_BETTER',
  'TARGET_RANGE'
);

CREATE TYPE public.kpi_frequency AS ENUM (
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUALLY',
  'CASE_BASED'
);

CREATE TYPE public.agent_authority_level AS ENUM (
  'DISABLED',
  'READ',
  'DRAFT',
  'PROPOSE',
  'EXECUTE_WITH_APPROVAL',
  'EXECUTE_AUTOMATIC'
);

CREATE TYPE public.onboarding_plan_status AS ENUM (
  'PENDING',
  'PROVISIONED',
  'CANCELLED'
);

-- Composite keys are required so all new foreign keys prove tenant equality.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_id_org
  ON public.invitations (id, organisation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_id_org
  ON public.roles (id, organisation_id);

CREATE TABLE public.job_profiles (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  department_id uuid,
  key varchar(120) NOT NULL,
  name varchar(160) NOT NULL,
  description text,
  purpose text,
  version integer NOT NULL DEFAULT 1,
  is_managerial boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_job_profiles PRIMARY KEY (id),
  CONSTRAINT uq_job_profiles_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_job_profiles_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_job_profiles_key CHECK (
    key = lower(btrim(key))
    AND key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_job_profiles_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT ck_job_profiles_version CHECK (version > 0),
  CONSTRAINT ck_job_profiles_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_job_profiles_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_job_profiles_department FOREIGN KEY (department_id, organisation_id)
    REFERENCES public.departments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_job_profiles_created_by FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_job_profiles_updated_by FOREIGN KEY (updated_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX ix_job_profiles_org_active
  ON public.job_profiles (organisation_id, is_active, deleted_at);
CREATE INDEX ix_job_profiles_org_department
  ON public.job_profiles (organisation_id, department_id, is_active, deleted_at);

CREATE TABLE public.job_profile_duties (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  job_profile_id uuid NOT NULL,
  code varchar(120) NOT NULL,
  title varchar(200) NOT NULL,
  description text NOT NULL,
  position smallint NOT NULL DEFAULT 1,
  is_critical boolean NOT NULL DEFAULT false,
  requires_evidence boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_job_profile_duties PRIMARY KEY (id),
  CONSTRAINT uq_job_profile_duties_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_job_profile_duties_profile_code UNIQUE (job_profile_id, code),
  CONSTRAINT ck_job_profile_duties_code CHECK (
    code = lower(btrim(code))
    AND code ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_job_profile_duties_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT ck_job_profile_duties_description CHECK (char_length(btrim(description)) > 0),
  CONSTRAINT ck_job_profile_duties_position CHECK (position > 0),
  CONSTRAINT ck_job_profile_duties_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_job_profile_duties_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_job_profile_duties_profile FOREIGN KEY (job_profile_id, organisation_id)
    REFERENCES public.job_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX ix_job_profile_duties_profile_active
  ON public.job_profile_duties (organisation_id, job_profile_id, is_active, position, deleted_at);

CREATE TABLE public.kpi_definitions (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  department_id uuid,
  key varchar(120) NOT NULL,
  name varchar(180) NOT NULL,
  description text NOT NULL,
  value_type public.kpi_value_type NOT NULL,
  direction public.kpi_direction NOT NULL,
  frequency public.kpi_frequency NOT NULL,
  unit_label varchar(40),
  currency_code char(3),
  measurement_source varchar(120) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_kpi_definitions PRIMARY KEY (id),
  CONSTRAINT uq_kpi_definitions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_kpi_definitions_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_kpi_definitions_key CHECK (
    key = lower(btrim(key))
    AND key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_kpi_definitions_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 180),
  CONSTRAINT ck_kpi_definitions_description CHECK (char_length(btrim(description)) > 0),
  CONSTRAINT ck_kpi_definitions_source CHECK (
    char_length(btrim(measurement_source)) BETWEEN 1 AND 120
  ),
  CONSTRAINT ck_kpi_definitions_currency CHECK (
    (value_type = 'CURRENCY' AND currency_code IS NOT NULL)
    OR (value_type <> 'CURRENCY' AND currency_code IS NULL)
  ),
  CONSTRAINT ck_kpi_definitions_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_kpi_definitions_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_kpi_definitions_department FOREIGN KEY (department_id, organisation_id)
    REFERENCES public.departments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_kpi_definitions_created_by FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_kpi_definitions_updated_by FOREIGN KEY (updated_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX ix_kpi_definitions_org_active
  ON public.kpi_definitions (organisation_id, is_active, deleted_at);
CREATE INDEX ix_kpi_definitions_org_department
  ON public.kpi_definitions (organisation_id, department_id, is_active, deleted_at);

CREATE TABLE public.job_profile_kpis (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  job_profile_id uuid NOT NULL,
  kpi_definition_id uuid NOT NULL,
  target_value numeric(18,4),
  minimum_value numeric(18,4),
  maximum_value numeric(18,4),
  weight_percent numeric(5,2) NOT NULL DEFAULT 0,
  starts_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  ends_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_job_profile_kpis PRIMARY KEY (id),
  CONSTRAINT uq_job_profile_kpis_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_job_profile_kpis_profile_definition UNIQUE (
    job_profile_id,
    kpi_definition_id,
    starts_at
  ),
  CONSTRAINT ck_job_profile_kpis_weight CHECK (weight_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_job_profile_kpis_range CHECK (
    minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value
  ),
  CONSTRAINT ck_job_profile_kpis_target_range CHECK (
    target_value IS NULL
    OR (
      (minimum_value IS NULL OR target_value >= minimum_value)
      AND (maximum_value IS NULL OR target_value <= maximum_value)
    )
  ),
  CONSTRAINT ck_job_profile_kpis_time CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT ck_job_profile_kpis_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_job_profile_kpis_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_job_profile_kpis_profile FOREIGN KEY (job_profile_id, organisation_id)
    REFERENCES public.job_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_job_profile_kpis_definition FOREIGN KEY (kpi_definition_id, organisation_id)
    REFERENCES public.kpi_definitions (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX ix_job_profile_kpis_profile_effective
  ON public.job_profile_kpis (
    organisation_id,
    job_profile_id,
    starts_at,
    ends_at,
    deleted_at
  );

CREATE UNIQUE INDEX uq_job_profile_kpis_current
  ON public.job_profile_kpis (job_profile_id, kpi_definition_id)
  WHERE ends_at IS NULL AND deleted_at IS NULL;

CREATE TABLE public.agent_profiles (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  department_id uuid,
  key varchar(120) NOT NULL,
  name varchar(160) NOT NULL,
  description text NOT NULL,
  behaviour_instructions text NOT NULL,
  authority_ceiling public.agent_authority_level NOT NULL DEFAULT 'PROPOSE',
  requires_human_review boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_agent_profiles PRIMARY KEY (id),
  CONSTRAINT uq_agent_profiles_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_agent_profiles_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_agent_profiles_key CHECK (
    key = lower(btrim(key))
    AND key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_agent_profiles_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT ck_agent_profiles_description CHECK (char_length(btrim(description)) > 0),
  CONSTRAINT ck_agent_profiles_instructions CHECK (char_length(btrim(behaviour_instructions)) > 0),
  CONSTRAINT ck_agent_profiles_version CHECK (version > 0),
  CONSTRAINT ck_agent_profiles_review_ceiling CHECK (
    authority_ceiling <> 'EXECUTE_AUTOMATIC' OR requires_human_review = false
  ),
  CONSTRAINT ck_agent_profiles_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_agent_profiles_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_profiles_department FOREIGN KEY (department_id, organisation_id)
    REFERENCES public.departments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_profiles_created_by FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_profiles_updated_by FOREIGN KEY (updated_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX ix_agent_profiles_org_active
  ON public.agent_profiles (organisation_id, is_active, deleted_at);
CREATE INDEX ix_agent_profiles_org_department
  ON public.agent_profiles (organisation_id, department_id, is_active, deleted_at);

CREATE TABLE public.agent_policies (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  agent_profile_id uuid NOT NULL,
  tool_key varchar(160) NOT NULL,
  required_permission_key varchar(180) NOT NULL,
  authority_level public.agent_authority_level NOT NULL,
  maximum_data_scope public.permission_data_scope NOT NULL,
  requires_approval boolean NOT NULL DEFAULT true,
  requires_mfa boolean NOT NULL DEFAULT false,
  max_actions_per_run integer NOT NULL DEFAULT 25,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_agent_policies PRIMARY KEY (id),
  CONSTRAINT uq_agent_policies_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_agent_policies_profile_tool UNIQUE (agent_profile_id, tool_key),
  CONSTRAINT ck_agent_policies_tool_key CHECK (
    tool_key = lower(btrim(tool_key))
    AND tool_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_agent_policies_authority CHECK (
    (authority_level = 'EXECUTE_WITH_APPROVAL' AND requires_approval = true)
    OR (authority_level = 'EXECUTE_AUTOMATIC' AND requires_approval = false)
    OR authority_level IN ('DISABLED', 'READ', 'DRAFT', 'PROPOSE')
  ),
  CONSTRAINT ck_agent_policies_max_actions CHECK (max_actions_per_run BETWEEN 1 AND 250),
  CONSTRAINT ck_agent_policies_configuration CHECK (
    jsonb_typeof(configuration) = 'object'
  ),
  CONSTRAINT ck_agent_policies_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_agent_policies_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_policies_profile FOREIGN KEY (agent_profile_id, organisation_id)
    REFERENCES public.agent_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agent_policies_permission FOREIGN KEY (required_permission_key)
    REFERENCES public.permissions (key) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX ix_agent_policies_profile_active
  ON public.agent_policies (organisation_id, agent_profile_id, is_active, deleted_at);
CREATE INDEX ix_agent_policies_permission
  ON public.agent_policies (required_permission_key, is_active, deleted_at);

CREATE TABLE public.workforce_assignments (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  organisation_membership_id uuid NOT NULL,
  job_profile_id uuid NOT NULL,
  department_id uuid,
  team_id uuid,
  manager_organisation_membership_id uuid,
  agent_profile_id uuid,
  job_title varchar(160) NOT NULL,
  status public.workforce_assignment_status NOT NULL DEFAULT 'ACTIVE',
  is_primary boolean NOT NULL DEFAULT true,
  starts_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  ends_at timestamptz(6),
  end_reason text,
  created_by_user_profile_id uuid NOT NULL,
  updated_by_user_profile_id uuid,
  ended_by_user_profile_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_workforce_assignments PRIMARY KEY (id),
  CONSTRAINT uq_workforce_assignments_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_workforce_assignments_title CHECK (
    char_length(btrim(job_title)) BETWEEN 1 AND 160
  ),
  CONSTRAINT ck_workforce_assignments_manager CHECK (
    manager_organisation_membership_id IS NULL
    OR manager_organisation_membership_id <> organisation_membership_id
  ),
  CONSTRAINT ck_workforce_assignments_time CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT ck_workforce_assignments_status CHECK (
    (status IN ('ACTIVE', 'SUSPENDED') AND ends_at IS NULL AND ended_by_user_profile_id IS NULL)
    OR (status = 'ENDED' AND ends_at IS NOT NULL AND ended_by_user_profile_id IS NOT NULL)
  ),
  CONSTRAINT ck_workforce_assignments_end_reason CHECK (
    status <> 'ENDED'
    OR (
      end_reason IS NOT NULL
      AND char_length(btrim(end_reason)) BETWEEN 1 AND 1000
    )
  ),
  CONSTRAINT ck_workforce_assignments_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_workforce_assignments_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_membership FOREIGN KEY (
    organisation_membership_id,
    organisation_id
  ) REFERENCES public.organisation_memberships (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_profile FOREIGN KEY (job_profile_id, organisation_id)
    REFERENCES public.job_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_department FOREIGN KEY (department_id, organisation_id)
    REFERENCES public.departments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_team FOREIGN KEY (team_id, organisation_id)
    REFERENCES public.teams (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_manager FOREIGN KEY (
    manager_organisation_membership_id,
    organisation_id
  ) REFERENCES public.organisation_memberships (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_agent_profile FOREIGN KEY (
    agent_profile_id,
    organisation_id
  ) REFERENCES public.agent_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_created_by FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_updated_by FOREIGN KEY (updated_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignments_ended_by FOREIGN KEY (ended_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX uq_workforce_assignments_primary_active
  ON public.workforce_assignments (organisation_id, organisation_membership_id)
  WHERE is_primary = true AND status IN ('ACTIVE', 'SUSPENDED') AND deleted_at IS NULL;

CREATE INDEX ix_workforce_assignments_org_member_status
  ON public.workforce_assignments (
    organisation_id,
    organisation_membership_id,
    status,
    deleted_at
  );
CREATE INDEX ix_workforce_assignments_org_manager
  ON public.workforce_assignments (
    organisation_id,
    manager_organisation_membership_id,
    status,
    deleted_at
  );
CREATE INDEX ix_workforce_assignments_org_structure
  ON public.workforce_assignments (
    organisation_id,
    department_id,
    team_id,
    status,
    deleted_at
  );

CREATE TABLE public.workforce_assignment_kpis (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  workforce_assignment_id uuid NOT NULL,
  kpi_definition_id uuid NOT NULL,
  source_job_profile_kpi_id uuid,
  target_value numeric(18,4),
  minimum_value numeric(18,4),
  maximum_value numeric(18,4),
  weight_percent numeric(5,2) NOT NULL DEFAULT 0,
  effective_from timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  effective_until timestamptz(6),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_profile_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_workforce_assignment_kpis PRIMARY KEY (id),
  CONSTRAINT uq_workforce_assignment_kpis_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_workforce_assignment_kpis_weight CHECK (weight_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_workforce_assignment_kpis_range CHECK (
    minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value
  ),
  CONSTRAINT ck_workforce_assignment_kpis_target_range CHECK (
    target_value IS NULL
    OR (
      (minimum_value IS NULL OR target_value >= minimum_value)
      AND (maximum_value IS NULL OR target_value <= maximum_value)
    )
  ),
  CONSTRAINT ck_workforce_assignment_kpis_time CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT ck_workforce_assignment_kpis_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_workforce_assignment_kpis_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignment_kpis_assignment FOREIGN KEY (
    workforce_assignment_id,
    organisation_id
  ) REFERENCES public.workforce_assignments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignment_kpis_definition FOREIGN KEY (
    kpi_definition_id,
    organisation_id
  ) REFERENCES public.kpi_definitions (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignment_kpis_source FOREIGN KEY (
    source_job_profile_kpi_id,
    organisation_id
  ) REFERENCES public.job_profile_kpis (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_workforce_assignment_kpis_created_by FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX uq_workforce_assignment_kpis_current
  ON public.workforce_assignment_kpis (workforce_assignment_id, kpi_definition_id)
  WHERE is_active = true AND effective_until IS NULL AND deleted_at IS NULL;

CREATE INDEX ix_workforce_assignment_kpis_effective
  ON public.workforce_assignment_kpis (
    organisation_id,
    workforce_assignment_id,
    is_active,
    effective_from,
    effective_until,
    deleted_at
  );

CREATE TABLE public.invitation_onboarding_plans (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  job_profile_id uuid NOT NULL,
  department_id uuid,
  team_id uuid,
  manager_organisation_membership_id uuid,
  agent_profile_id uuid,
  job_title varchar(160) NOT NULL,
  is_department_manager boolean NOT NULL DEFAULT false,
  is_team_lead boolean NOT NULL DEFAULT false,
  starts_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  status public.onboarding_plan_status NOT NULL DEFAULT 'PENDING',
  version integer NOT NULL DEFAULT 1,
  created_by_user_profile_id uuid NOT NULL,
  provisioned_organisation_membership_id uuid,
  provisioned_workforce_assignment_id uuid,
  provisioned_at timestamptz(6),
  cancelled_at timestamptz(6),
  cancellation_reason text,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_invitation_onboarding_plans PRIMARY KEY (id),
  CONSTRAINT uq_invitation_onboarding_plans_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_invitation_onboarding_plans_invitation UNIQUE (invitation_id),
  CONSTRAINT ck_invitation_onboarding_plans_title CHECK (
    char_length(btrim(job_title)) BETWEEN 1 AND 160
  ),
  CONSTRAINT ck_invitation_onboarding_plans_version CHECK (version > 0),
  CONSTRAINT ck_invitation_onboarding_plans_manager_flags CHECK (
    (is_department_manager = false OR department_id IS NOT NULL)
    AND (is_team_lead = false OR team_id IS NOT NULL)
  ),
  CONSTRAINT ck_invitation_onboarding_plans_status CHECK (
    (
      status = 'PENDING'
      AND provisioned_organisation_membership_id IS NULL
      AND provisioned_workforce_assignment_id IS NULL
      AND provisioned_at IS NULL
      AND cancelled_at IS NULL
      AND cancellation_reason IS NULL
    )
    OR (
      status = 'PROVISIONED'
      AND provisioned_organisation_membership_id IS NOT NULL
      AND provisioned_workforce_assignment_id IS NOT NULL
      AND provisioned_at IS NOT NULL
      AND cancelled_at IS NULL
      AND cancellation_reason IS NULL
    )
    OR (
      status = 'CANCELLED'
      AND provisioned_organisation_membership_id IS NULL
      AND provisioned_workforce_assignment_id IS NULL
      AND provisioned_at IS NULL
      AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND char_length(btrim(cancellation_reason)) BETWEEN 1 AND 1000
    )
  ),
  CONSTRAINT ck_invitation_onboarding_plans_lifecycle CHECK (
    updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT fk_invitation_onboarding_plans_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_invitation FOREIGN KEY (
    invitation_id,
    organisation_id
  ) REFERENCES public.invitations (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_profile FOREIGN KEY (
    job_profile_id,
    organisation_id
  ) REFERENCES public.job_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_department FOREIGN KEY (
    department_id,
    organisation_id
  ) REFERENCES public.departments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_team FOREIGN KEY (team_id, organisation_id)
    REFERENCES public.teams (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_manager FOREIGN KEY (
    manager_organisation_membership_id,
    organisation_id
  ) REFERENCES public.organisation_memberships (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_agent FOREIGN KEY (
    agent_profile_id,
    organisation_id
  ) REFERENCES public.agent_profiles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_created_by FOREIGN KEY (created_by_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_provisioned_member FOREIGN KEY (
    provisioned_organisation_membership_id,
    organisation_id
  ) REFERENCES public.organisation_memberships (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_plans_provisioned_assignment FOREIGN KEY (
    provisioned_workforce_assignment_id,
    organisation_id
  ) REFERENCES public.workforce_assignments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX ix_invitation_onboarding_plans_org_status
  ON public.invitation_onboarding_plans (organisation_id, status, created_at DESC);

CREATE TABLE public.invitation_onboarding_roles (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  onboarding_plan_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope public.assignment_scope NOT NULL,
  department_id uuid,
  team_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_invitation_onboarding_roles PRIMARY KEY (id),
  CONSTRAINT uq_invitation_onboarding_roles_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_invitation_onboarding_roles_plan_role UNIQUE (onboarding_plan_id, role_id),
  CONSTRAINT ck_invitation_onboarding_roles_scope CHECK (
    (scope = 'ORGANISATION' AND department_id IS NULL AND team_id IS NULL)
    OR (scope = 'DEPARTMENT' AND department_id IS NOT NULL AND team_id IS NULL)
    OR (scope = 'TEAM' AND department_id IS NULL AND team_id IS NOT NULL)
  ),
  CONSTRAINT fk_invitation_onboarding_roles_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_roles_plan FOREIGN KEY (
    onboarding_plan_id,
    organisation_id
  ) REFERENCES public.invitation_onboarding_plans (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_roles_role FOREIGN KEY (role_id, organisation_id)
    REFERENCES public.roles (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_roles_department FOREIGN KEY (
    department_id,
    organisation_id
  ) REFERENCES public.departments (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_roles_team FOREIGN KEY (team_id, organisation_id)
    REFERENCES public.teams (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX ix_invitation_onboarding_roles_plan
  ON public.invitation_onboarding_roles (organisation_id, onboarding_plan_id);

CREATE TABLE public.invitation_onboarding_kpis (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  onboarding_plan_id uuid NOT NULL,
  kpi_definition_id uuid NOT NULL,
  source_job_profile_kpi_id uuid,
  target_value numeric(18,4),
  minimum_value numeric(18,4),
  maximum_value numeric(18,4),
  weight_percent numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_invitation_onboarding_kpis PRIMARY KEY (id),
  CONSTRAINT uq_invitation_onboarding_kpis_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_invitation_onboarding_kpis_plan_definition UNIQUE (
    onboarding_plan_id,
    kpi_definition_id
  ),
  CONSTRAINT ck_invitation_onboarding_kpis_weight CHECK (weight_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_invitation_onboarding_kpis_range CHECK (
    minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value
  ),
  CONSTRAINT ck_invitation_onboarding_kpis_target_range CHECK (
    target_value IS NULL
    OR (
      (minimum_value IS NULL OR target_value >= minimum_value)
      AND (maximum_value IS NULL OR target_value <= maximum_value)
    )
  ),
  CONSTRAINT fk_invitation_onboarding_kpis_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_kpis_plan FOREIGN KEY (
    onboarding_plan_id,
    organisation_id
  ) REFERENCES public.invitation_onboarding_plans (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_kpis_definition FOREIGN KEY (
    kpi_definition_id,
    organisation_id
  ) REFERENCES public.kpi_definitions (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invitation_onboarding_kpis_source FOREIGN KEY (
    source_job_profile_kpi_id,
    organisation_id
  ) REFERENCES public.job_profile_kpis (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX ix_invitation_onboarding_kpis_plan
  ON public.invitation_onboarding_kpis (organisation_id, onboarding_plan_id);

-- AI policy validation: an agent cannot be configured above its profile ceiling
-- and cannot use a permission that is not explicitly marked for AI use.
CREATE OR REPLACE FUNCTION private.validate_agent_policy_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  profile_ceiling public.agent_authority_level;
  permission_allows_ai boolean;
  permission_requires_mfa boolean;
BEGIN
  SELECT profile.authority_ceiling
    INTO profile_ceiling
  FROM public.agent_profiles AS profile
  WHERE profile.id = NEW.agent_profile_id
    AND profile.organisation_id = NEW.organisation_id
    AND profile.is_active = true
    AND profile.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent policy requires an active profile in the same organisation';
  END IF;

  IF NEW.authority_level > profile_ceiling THEN
    RAISE EXCEPTION 'agent policy exceeds the profile authority ceiling';
  END IF;

  SELECT permission.allows_ai_use, permission.requires_mfa
    INTO permission_allows_ai, permission_requires_mfa
  FROM public.permissions AS permission
  WHERE permission.key = NEW.required_permission_key
    AND permission.is_active = true
    AND permission.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent policy requires an active permission';
  END IF;

  IF NEW.authority_level <> 'DISABLED' AND permission_allows_ai = false THEN
    RAISE EXCEPTION 'the required permission does not allow AI use';
  END IF;

  IF permission_requires_mfa = true AND NEW.requires_mfa = false THEN
    RAISE EXCEPTION 'agent policy cannot weaken the permission MFA requirement';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_workforce_assignment_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  team_department_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS membership
    WHERE membership.id = NEW.organisation_membership_id
      AND membership.organisation_id = NEW.organisation_id
      AND membership.status::text = 'ACTIVE'
      AND membership.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'workforce assignment requires an active organisation membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.job_profiles AS profile
    WHERE profile.id = NEW.job_profile_id
      AND profile.organisation_id = NEW.organisation_id
      AND profile.is_active = true
      AND profile.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'workforce assignment requires an active job profile';
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.departments AS department
    WHERE department.id = NEW.department_id
      AND department.organisation_id = NEW.organisation_id
      AND department.is_active = true
      AND department.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'workforce assignment requires an active department';
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    SELECT team.department_id
      INTO team_department_id
    FROM public.teams AS team
    WHERE team.id = NEW.team_id
      AND team.organisation_id = NEW.organisation_id
      AND team.is_active = true
      AND team.deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'workforce assignment requires an active team';
    END IF;

    IF team_department_id IS NOT NULL
       AND team_department_id IS DISTINCT FROM NEW.department_id THEN
      RAISE EXCEPTION 'workforce assignment team and department do not match';
    END IF;
  END IF;

  IF NEW.manager_organisation_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS manager
    WHERE manager.id = NEW.manager_organisation_membership_id
      AND manager.organisation_id = NEW.organisation_id
      AND manager.status::text = 'ACTIVE'
      AND manager.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'reporting manager must be an active member of the organisation';
  END IF;

  IF NEW.agent_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.agent_profiles AS profile
    WHERE profile.id = NEW.agent_profile_id
      AND profile.organisation_id = NEW.organisation_id
      AND profile.is_active = true
      AND profile.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'workforce assignment requires an active agent profile';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_invitation_onboarding_plan_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  invitation_status text;
  invitation_inviter uuid;
  invitation_expiry timestamptz;
  team_department_id uuid;
BEGIN
  SELECT invitation.status::text,
         invitation.invited_by_user_profile_id,
         invitation.expires_at
    INTO invitation_status, invitation_inviter, invitation_expiry
  FROM public.invitations AS invitation
  WHERE invitation.id = NEW.invitation_id
    AND invitation.organisation_id = NEW.organisation_id
    AND invitation.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'onboarding plan requires an invitation in the same organisation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING'
       OR invitation_status <> 'PENDING'
       OR invitation_expiry <= pg_catalog.now() THEN
      RAISE EXCEPTION 'new onboarding plan requires an active pending invitation';
    END IF;

    IF NEW.created_by_user_profile_id IS DISTINCT FROM invitation_inviter THEN
      RAISE EXCEPTION 'onboarding plan creator must match the invitation issuer';
    END IF;
  ELSIF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a provisioned or cancelled onboarding plan is terminal';
  END IF;

  IF NEW.status = 'PENDING'
     AND (invitation_status <> 'PENDING' OR invitation_expiry <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'pending onboarding plan requires an active pending invitation';
  END IF;

  IF NEW.status = 'PROVISIONED' AND invitation_status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'provisioned onboarding plan requires an accepted invitation';
  END IF;

  -- Active configuration is required while a plan can still be accepted.
  -- Terminal plans remain cancellable/auditable even if a referenced profile
  -- was subsequently retired.
  IF NEW.status = 'PENDING' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.job_profiles AS profile
      WHERE profile.id = NEW.job_profile_id
        AND profile.organisation_id = NEW.organisation_id
        AND profile.is_active = true
        AND profile.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'onboarding plan requires an active job profile';
    END IF;

    IF NEW.department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.departments AS department
      WHERE department.id = NEW.department_id
        AND department.organisation_id = NEW.organisation_id
        AND department.is_active = true
        AND department.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'onboarding plan requires an active department';
    END IF;

    IF NEW.team_id IS NOT NULL THEN
      SELECT team.department_id
        INTO team_department_id
      FROM public.teams AS team
      WHERE team.id = NEW.team_id
        AND team.organisation_id = NEW.organisation_id
        AND team.is_active = true
        AND team.deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'onboarding plan requires an active team';
      END IF;

      IF team_department_id IS NOT NULL
         AND team_department_id IS DISTINCT FROM NEW.department_id THEN
        RAISE EXCEPTION 'onboarding plan team and department do not match';
      END IF;
    END IF;

    IF NEW.manager_organisation_membership_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.organisation_memberships AS manager
      WHERE manager.id = NEW.manager_organisation_membership_id
        AND manager.organisation_id = NEW.organisation_id
        AND manager.status::text = 'ACTIVE'
        AND manager.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'onboarding manager must be an active member of the organisation';
    END IF;

    IF NEW.agent_profile_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.agent_profiles AS profile
      WHERE profile.id = NEW.agent_profile_id
        AND profile.organisation_id = NEW.organisation_id
        AND profile.is_active = true
        AND profile.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'onboarding plan requires an active agent profile';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_invitation_onboarding_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  plan_status text;
  plan_department_id uuid;
  plan_team_id uuid;
  role_scope text;
  role_key text;
BEGIN
  SELECT plan.status::text, plan.department_id, plan.team_id
    INTO plan_status, plan_department_id, plan_team_id
  FROM public.invitation_onboarding_plans AS plan
  WHERE plan.id = NEW.onboarding_plan_id
    AND plan.organisation_id = NEW.organisation_id
    AND plan.deleted_at IS NULL;

  IF NOT FOUND OR plan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'roles can only be added to a pending onboarding plan';
  END IF;

  SELECT role_record.scope::text, role_record.key
    INTO role_scope, role_key
  FROM public.roles AS role_record
  WHERE role_record.id = NEW.role_id
    AND role_record.organisation_id = NEW.organisation_id
    AND role_record.is_assignable = true
    AND role_record.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'onboarding role must be active, assignable and tenant-owned';
  END IF;

  IF role_key = 'organisation_owner' THEN
    RAISE EXCEPTION 'organisation owner cannot be assigned through an invitation';
  END IF;

  IF role_scope <> NEW.scope::text THEN
    RAISE EXCEPTION 'onboarding role scope must equal the configured role scope';
  END IF;

  IF NEW.scope = 'DEPARTMENT'
     AND NEW.department_id IS DISTINCT FROM plan_department_id THEN
    RAISE EXCEPTION 'department-scoped role must use the onboarding department';
  END IF;

  IF NEW.scope = 'TEAM' AND NEW.team_id IS DISTINCT FROM plan_team_id THEN
    RAISE EXCEPTION 'team-scoped role must use the onboarding team';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_invitation_onboarding_kpi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  plan_status text;
  plan_job_profile_id uuid;
BEGIN
  SELECT plan.status::text, plan.job_profile_id
    INTO plan_status, plan_job_profile_id
  FROM public.invitation_onboarding_plans AS plan
  WHERE plan.id = NEW.onboarding_plan_id
    AND plan.organisation_id = NEW.organisation_id
    AND plan.deleted_at IS NULL;

  IF NOT FOUND OR plan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'KPIs can only be added to a pending onboarding plan';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.kpi_definitions AS definition
    WHERE definition.id = NEW.kpi_definition_id
      AND definition.organisation_id = NEW.organisation_id
      AND definition.is_active = true
      AND definition.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'onboarding KPI must be active and tenant-owned';
  END IF;

  IF NEW.source_job_profile_kpi_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.job_profile_kpis AS profile_kpi
    WHERE profile_kpi.id = NEW.source_job_profile_kpi_id
      AND profile_kpi.organisation_id = NEW.organisation_id
      AND profile_kpi.job_profile_id = plan_job_profile_id
      AND profile_kpi.kpi_definition_id = NEW.kpi_definition_id
      AND profile_kpi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'onboarding KPI source does not belong to the selected job profile';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.reject_onboarding_child_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'onboarding plan roles and KPI snapshots are immutable; revoke and reissue the invitation';
END
$function$;

CREATE OR REPLACE FUNCTION private.sync_cancelled_invitation_onboarding_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status::text IN ('REVOKED', 'EXPIRED')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.invitation_onboarding_plans
    SET status = 'CANCELLED',
        cancelled_at = pg_catalog.now(),
        cancellation_reason = CASE
          WHEN NEW.status::text = 'REVOKED' THEN 'Invitation revoked.'
          ELSE 'Invitation expired.'
        END,
        updated_at = pg_catalog.now()
    WHERE invitation_id = NEW.id
      AND organisation_id = NEW.organisation_id
      AND status = 'PENDING'
      AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.validate_agent_policy_boundary() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_workforce_assignment_boundary() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_invitation_onboarding_plan_boundary() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_invitation_onboarding_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_invitation_onboarding_kpi() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reject_onboarding_child_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.sync_cancelled_invitation_onboarding_plan() FROM PUBLIC;

CREATE TRIGGER agent_policies_validate_boundary
  BEFORE INSERT OR UPDATE ON public.agent_policies
  FOR EACH ROW EXECUTE FUNCTION private.validate_agent_policy_boundary();

CREATE TRIGGER workforce_assignments_validate_boundary
  BEFORE INSERT OR UPDATE ON public.workforce_assignments
  FOR EACH ROW EXECUTE FUNCTION private.validate_workforce_assignment_boundary();

CREATE TRIGGER invitation_onboarding_plans_validate_boundary
  BEFORE INSERT OR UPDATE ON public.invitation_onboarding_plans
  FOR EACH ROW EXECUTE FUNCTION private.validate_invitation_onboarding_plan_boundary();

CREATE TRIGGER invitation_onboarding_roles_validate
  BEFORE INSERT ON public.invitation_onboarding_roles
  FOR EACH ROW EXECUTE FUNCTION private.validate_invitation_onboarding_role();

CREATE TRIGGER invitation_onboarding_kpis_validate
  BEFORE INSERT ON public.invitation_onboarding_kpis
  FOR EACH ROW EXECUTE FUNCTION private.validate_invitation_onboarding_kpi();

CREATE TRIGGER invitation_onboarding_roles_immutable
  BEFORE UPDATE OR DELETE ON public.invitation_onboarding_roles
  FOR EACH ROW EXECUTE FUNCTION private.reject_onboarding_child_mutation();

CREATE TRIGGER invitation_onboarding_kpis_immutable
  BEFORE UPDATE OR DELETE ON public.invitation_onboarding_kpis
  FOR EACH ROW EXECUTE FUNCTION private.reject_onboarding_child_mutation();

CREATE TRIGGER invitations_cancel_onboarding_plan
  AFTER UPDATE OF status ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION private.sync_cancelled_invitation_onboarding_plan();

CREATE TRIGGER job_profiles_immutable
  BEFORE UPDATE ON public.job_profiles
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'department_id', 'key', 'created_by_user_profile_id'
  );

CREATE TRIGGER job_profile_duties_immutable
  BEFORE UPDATE ON public.job_profile_duties
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'job_profile_id', 'code'
  );

CREATE TRIGGER kpi_definitions_immutable
  BEFORE UPDATE ON public.kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'department_id', 'key', 'created_by_user_profile_id'
  );

CREATE TRIGGER job_profile_kpis_immutable
  BEFORE UPDATE ON public.job_profile_kpis
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'job_profile_id', 'kpi_definition_id', 'starts_at'
  );

CREATE TRIGGER agent_profiles_immutable
  BEFORE UPDATE ON public.agent_profiles
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'department_id', 'key', 'created_by_user_profile_id'
  );

CREATE TRIGGER agent_policies_immutable
  BEFORE UPDATE ON public.agent_policies
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'agent_profile_id', 'tool_key'
  );

CREATE TRIGGER workforce_assignments_immutable
  BEFORE UPDATE ON public.workforce_assignments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'organisation_membership_id', 'job_profile_id',
    'department_id', 'team_id', 'manager_organisation_membership_id',
    'agent_profile_id', 'job_title', 'is_primary', 'starts_at',
    'created_by_user_profile_id'
  );

CREATE TRIGGER workforce_assignment_kpis_immutable
  BEFORE UPDATE ON public.workforce_assignment_kpis
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'workforce_assignment_id', 'kpi_definition_id',
    'source_job_profile_kpi_id', 'target_value', 'minimum_value',
    'maximum_value', 'weight_percent', 'effective_from',
    'created_by_user_profile_id'
  );

CREATE TRIGGER invitation_onboarding_plans_immutable
  BEFORE UPDATE ON public.invitation_onboarding_plans
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'invitation_id', 'job_profile_id',
    'department_id', 'team_id', 'manager_organisation_membership_id',
    'agent_profile_id', 'job_title', 'is_department_manager', 'is_team_lead',
    'starts_at', 'version', 'created_by_user_profile_id'
  );

-- New administration permissions. AI is not allowed to grant or alter any of
-- these permissions; they remain human/MFA-controlled security operations.
WITH permission_seed (
  permission_key,
  permission_name,
  permission_description,
  resource_name,
  action_name,
  is_sensitive,
  requires_mfa,
  permission_metadata
) AS (
  VALUES
    (
      'workforce.read',
      'View workforce structure',
      'View authorised staff assignments, reporting lines and work context.',
      'workforce',
      'read',
      true,
      false,
      '{"classification":"personal-confidential"}'::jsonb
    ),
    (
      'workforce.manage',
      'Manage workforce structure',
      'Create, suspend or end authorised workforce assignments and reporting lines.',
      'workforce',
      'manage',
      true,
      true,
      '{"classification":"personal-confidential","high_risk":true}'::jsonb
    ),
    (
      'job_profiles.read',
      'View job profiles',
      'View authorised job profiles and duties.',
      'job_profiles',
      'read',
      false,
      false,
      '{"classification":"business-confidential"}'::jsonb
    ),
    (
      'job_profiles.manage',
      'Manage job profiles',
      'Create and maintain authorised job profiles and duties.',
      'job_profiles',
      'manage',
      true,
      true,
      '{"classification":"business-confidential","high_risk":true}'::jsonb
    ),
    (
      'kpis.read',
      'View KPI assignments',
      'View authorised KPI definitions and employee targets.',
      'kpis',
      'read',
      true,
      false,
      '{"classification":"personal-confidential"}'::jsonb
    ),
    (
      'kpis.manage',
      'Manage KPI assignments',
      'Create and maintain authorised KPI definitions and employee targets.',
      'kpis',
      'manage',
      true,
      true,
      '{"classification":"personal-confidential","high_risk":true}'::jsonb
    ),
    (
      'agent_profiles.read',
      'View AI agent profiles',
      'View authorised agent behaviour, tools and approval limits.',
      'agent_profiles',
      'read',
      true,
      false,
      '{"classification":"security-sensitive"}'::jsonb
    ),
    (
      'agent_profiles.manage',
      'Manage AI agent profiles',
      'Create and maintain agent behaviour, tools and approval limits.',
      'agent_profiles',
      'manage',
      true,
      true,
      '{"classification":"security-sensitive","high_risk":true}'::jsonb
    ),
    (
      'agent_assignments.manage',
      'Assign AI agent profiles',
      'Assign or revoke an approved AI agent profile for an organisation member.',
      'agent_assignments',
      'manage',
      true,
      true,
      '{"classification":"security-sensitive","high_risk":true}'::jsonb
    ),
    (
      'onboarding.manage',
      'Manage workforce onboarding',
      'Create immutable employee onboarding plans and provision approved access.',
      'onboarding',
      'manage',
      true,
      true,
      '{"classification":"security-sensitive","high_risk":true}'::jsonb
    )
)
INSERT INTO public.permissions (
  id,
  key,
  name,
  description,
  resource,
  action,
  data_scope,
  is_sensitive,
  requires_mfa,
  allows_ai_use,
  is_active,
  metadata,
  created_at,
  updated_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  permission_seed.permission_key,
  permission_seed.permission_name,
  permission_seed.permission_description,
  permission_seed.resource_name,
  permission_seed.action_name,
  'ORGANISATION'::public.permission_data_scope,
  permission_seed.is_sensitive,
  permission_seed.requires_mfa,
  false,
  true,
  permission_seed.permission_metadata,
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
  id,
  role_id,
  permission_id,
  created_at
)
SELECT
  pg_catalog.gen_random_uuid(),
  role_record.id,
  permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN ('organisation_owner', 'system_administrator')
  AND role_record.scope = 'ORGANISATION'::public.role_scope
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.key IN (
    'workforce.read',
    'workforce.manage',
    'job_profiles.read',
    'job_profiles.manage',
    'kpis.read',
    'kpis.manage',
    'agent_profiles.read',
    'agent_profiles.manage',
    'agent_assignments.manage',
    'onboarding.manage'
  )
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Runtime access remains restricted to the NestJS database role.
REVOKE ALL PRIVILEGES ON public.job_profiles,
  public.job_profile_duties,
  public.kpi_definitions,
  public.job_profile_kpis,
  public.agent_profiles,
  public.agent_policies,
  public.workforce_assignments,
  public.workforce_assignment_kpis,
  public.invitation_onboarding_plans,
  public.invitation_onboarding_roles,
  public.invitation_onboarding_kpis
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON TYPE public.workforce_assignment_status,
  public.kpi_value_type,
  public.kpi_direction,
  public.kpi_frequency,
  public.agent_authority_level,
  public.onboarding_plan_status
TO businessos_app, businessos_policy_reader;

GRANT SELECT, INSERT, UPDATE ON public.job_profiles,
  public.job_profile_duties,
  public.kpi_definitions,
  public.job_profile_kpis,
  public.agent_profiles,
  public.agent_policies,
  public.workforce_assignments,
  public.workforce_assignment_kpis,
  public.invitation_onboarding_plans
TO businessos_app;

GRANT SELECT, INSERT ON public.invitation_onboarding_roles,
  public.invitation_onboarding_kpis
TO businessos_app;

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'job_profiles',
    'job_profile_duties',
    'kpi_definitions',
    'job_profile_kpis',
    'agent_profiles',
    'agent_policies',
    'workforce_assignments',
    'workforce_assignment_kpis',
    'invitation_onboarding_plans',
    'invitation_onboarding_roles',
    'invitation_onboarding_kpis'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$rls$;

CREATE POLICY job_profiles_tenant ON public.job_profiles
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY job_profile_duties_tenant ON public.job_profile_duties
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY kpi_definitions_tenant ON public.kpi_definitions
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY job_profile_kpis_tenant ON public.job_profile_kpis
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY agent_profiles_tenant ON public.agent_profiles
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY agent_policies_tenant ON public.agent_policies
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY workforce_assignments_tenant ON public.workforce_assignments
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY workforce_assignment_kpis_tenant ON public.workforce_assignment_kpis
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY invitation_onboarding_plans_tenant ON public.invitation_onboarding_plans
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY invitation_onboarding_roles_select ON public.invitation_onboarding_roles
  FOR SELECT TO businessos_app
  USING (private.is_current_org_member(organisation_id));

CREATE POLICY invitation_onboarding_roles_insert ON public.invitation_onboarding_roles
  FOR INSERT TO businessos_app
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY invitation_onboarding_kpis_select ON public.invitation_onboarding_kpis
  FOR SELECT TO businessos_app
  USING (private.is_current_org_member(organisation_id));

CREATE POLICY invitation_onboarding_kpis_insert ON public.invitation_onboarding_kpis
  FOR INSERT TO businessos_app
  WITH CHECK (private.is_current_org_member(organisation_id));

COMMENT ON TABLE public.job_profiles IS
  'Tenant-defined jobs. A job profile describes duties and KPI defaults; it does not grant access.';
COMMENT ON TABLE public.workforce_assignments IS
  'A member''s time-bound job, reporting line, department/team context and assigned AI profile.';
COMMENT ON TABLE public.agent_policies IS
  'Maximum AI tool authority. Runtime authority is the intersection of this policy and the human user''s effective permissions.';
COMMENT ON TABLE public.invitation_onboarding_plans IS
  'Immutable security and work-context contract created before an employee invitation is delivered.';

COMMIT;