-- BusinessOS Clients + Matters foundation.
--
-- Security properties:
--   * every business record is organisation-bound and protected by forced RLS;
--   * browser-facing Supabase roles receive no table access;
--   * assignment, department, team and actor references are validated server-side;
--   * enquiry conversion is atomic and idempotent;
--   * status history and conversion ledgers are append-only;
--   * archive, compliance and broad-scope operations are permission/MFA gated;
--   * audit payloads are written by the API and deliberately exclude raw PII.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

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

CREATE TYPE public.client_kind AS ENUM (
  'INDIVIDUAL', 'ORGANISATION'
);

CREATE TYPE public.client_status AS ENUM (
  'ONBOARDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED'
);

CREATE TYPE public.client_risk_rating AS ENUM (
  'NOT_ASSESSED', 'LOW', 'MEDIUM', 'HIGH'
);

CREATE TYPE public.identity_verification_status AS ENUM (
  'NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED', 'EXPIRED'
);

CREATE TYPE public.processing_lawful_basis AS ENUM (
  'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST',
  'CONSENT', 'VITAL_INTEREST', 'PUBLIC_TASK'
);

CREATE TYPE public.communication_channel AS ENUM (
  'EMAIL', 'PHONE', 'SMS', 'WHATSAPP', 'POST', 'NONE'
);

CREATE TYPE public.matter_status AS ENUM (
  'INTAKE', 'CONFLICT_CHECK', 'CLIENT_CARE', 'AWAITING_DOCUMENTS',
  'ACTIVE', 'SUBMITTED', 'DECISION_RECEIVED', 'ON_HOLD', 'CLOSED',
  'CANCELLED', 'ARCHIVED'
);

CREATE TYPE public.matter_priority AS ENUM (
  'LOW', 'NORMAL', 'HIGH', 'URGENT'
);

CREATE TYPE public.matter_party_role AS ENUM (
  'PRIMARY_CLIENT', 'DEPENDANT', 'SPONSOR', 'EMPLOYER',
  'REPRESENTATIVE', 'OTHER'
);

CREATE TYPE public.conflict_check_status AS ENUM (
  'NOT_STARTED', 'PENDING', 'CLEARED', 'FLAGGED', 'WAIVED'
);

CREATE TYPE public.aml_check_status AS ENUM (
  'NOT_REQUIRED', 'NOT_STARTED', 'PENDING', 'VERIFIED',
  'FAILED', 'EXPIRED'
);

CREATE TYPE public.client_care_status AS ENUM (
  'NOT_SENT', 'SENT', 'ACCEPTED', 'DECLINED'
);

ALTER TABLE public.enquiries
  ADD CONSTRAINT uq_enquiries_id_org UNIQUE (id, organisation_id);

CREATE TABLE public.organisation_number_sequences (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  key varchar(40) NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_organisation_number_sequences PRIMARY KEY (id),
  CONSTRAINT fk_org_number_sequences_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_org_number_sequences_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_org_number_sequences_key CHECK (
    key = upper(key) AND key ~ '^[A-Z][A-Z0-9_]{1,39}$'
  ),
  CONSTRAINT ck_org_number_sequences_value CHECK (next_value > 0),
  CONSTRAINT ck_org_number_sequences_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  client_number varchar(40) NOT NULL,
  source_enquiry_id uuid,
  kind public.client_kind NOT NULL,
  status public.client_status NOT NULL DEFAULT 'ONBOARDING',
  display_name varchar(240) NOT NULL,
  first_name varchar(100),
  last_name varchar(100),
  organisation_name varchar(240),
  email varchar(320),
  phone varchar(50),
  date_of_birth date,
  nationality varchar(100),
  country_of_residence_code char(2),
  address_line_1 varchar(240),
  address_line_2 varchar(240),
  city varchar(120),
  region varchar(120),
  postal_code varchar(30),
  address_country_code char(2),
  preferred_language varchar(16) NOT NULL DEFAULT 'en-GB',
  preferred_communication public.communication_channel NOT NULL DEFAULT 'EMAIL',
  processing_lawful_basis public.processing_lawful_basis NOT NULL DEFAULT 'CONTRACT',
  privacy_notice_version varchar(40),
  privacy_notice_acknowledged_at timestamptz(6),
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz(6),
  marketing_consent_source varchar(120),
  risk_rating public.client_risk_rating NOT NULL DEFAULT 'NOT_ASSESSED',
  identity_verification_status public.identity_verification_status NOT NULL DEFAULT 'NOT_STARTED',
  identity_verified_at timestamptz(6),
  identity_verification_expires_at timestamptz(6),
  assigned_to_user_id uuid,
  last_contacted_at timestamptz(6),
  retention_review_at timestamptz(6),
  archived_at timestamptz(6),
  archive_reason text,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_clients PRIMARY KEY (id),
  CONSTRAINT fk_clients_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_clients_source_enquiry FOREIGN KEY (source_enquiry_id, organisation_id)
    REFERENCES public.enquiries (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_clients_assigned_to FOREIGN KEY (assigned_to_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_clients_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_clients_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_clients_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_clients_org_number UNIQUE (organisation_id, client_number),
  CONSTRAINT uq_clients_org_source_enquiry UNIQUE (organisation_id, source_enquiry_id),
  CONSTRAINT ck_clients_number CHECK (
    client_number = upper(client_number)
    AND client_number ~ '^CLI-[0-9]{6,12}$'
  ),
  CONSTRAINT ck_clients_display_name CHECK (
    display_name = btrim(display_name) AND char_length(display_name) > 0
  ),
  CONSTRAINT ck_clients_kind_identity CHECK (
    (kind = 'INDIVIDUAL' AND first_name IS NOT NULL
      AND char_length(btrim(first_name)) > 0 AND organisation_name IS NULL)
    OR
    (kind = 'ORGANISATION' AND organisation_name IS NOT NULL
      AND char_length(btrim(organisation_name)) > 0
      AND first_name IS NULL AND last_name IS NULL AND date_of_birth IS NULL)
  ),
  CONSTRAINT ck_clients_contact CHECK (
    (email IS NOT NULL AND char_length(btrim(email)) > 0)
    OR (phone IS NOT NULL AND char_length(btrim(phone)) > 0)
  ),
  CONSTRAINT ck_clients_email_normalised CHECK (
    email IS NULL OR email = lower(btrim(email))
  ),
  CONSTRAINT ck_clients_country_codes CHECK (
    (country_of_residence_code IS NULL OR country_of_residence_code ~ '^[A-Z]{2}$')
    AND (address_country_code IS NULL OR address_country_code ~ '^[A-Z]{2}$')
  ),
  CONSTRAINT ck_clients_date_of_birth CHECK (
    date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01'
  ),
  CONSTRAINT ck_clients_privacy_notice CHECK (
    (privacy_notice_version IS NULL AND privacy_notice_acknowledged_at IS NULL)
    OR (privacy_notice_version IS NOT NULL AND privacy_notice_acknowledged_at IS NOT NULL)
  ),
  CONSTRAINT ck_clients_marketing_consent CHECK (
    NOT marketing_consent
    OR (marketing_consent_at IS NOT NULL AND marketing_consent_source IS NOT NULL)
  ),
  CONSTRAINT ck_clients_identity_verification CHECK (
    identity_verification_status <> 'VERIFIED' OR identity_verified_at IS NOT NULL
  ),
  CONSTRAINT ck_clients_identity_expiry CHECK (
    identity_verification_expires_at IS NULL
    OR identity_verified_at IS NULL
    OR identity_verification_expires_at > identity_verified_at
  ),
  CONSTRAINT ck_clients_archive CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL
      AND archive_reason IS NOT NULL AND char_length(btrim(archive_reason)) > 0)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL AND archive_reason IS NULL)
  ),
  CONSTRAINT ck_clients_version CHECK (version > 0),
  CONSTRAINT ck_clients_lifecycle CHECK (
    updated_at >= created_at
    AND (archived_at IS NULL OR archived_at >= created_at)
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  )
);

CREATE TABLE public.matters (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_number varchar(40) NOT NULL,
  source_enquiry_id uuid,
  department_id uuid,
  team_id uuid,
  assigned_to_user_id uuid,
  supervisor_user_id uuid,
  title varchar(240) NOT NULL,
  description text,
  service_type varchar(160) NOT NULL,
  jurisdiction_country_code char(2),
  external_reference varchar(120),
  status public.matter_status NOT NULL DEFAULT 'INTAKE',
  priority public.matter_priority NOT NULL DEFAULT 'NORMAL',
  next_action_summary varchar(500),
  next_action_at timestamptz(6),
  critical_deadline_at timestamptz(6),
  target_completion_at timestamptz(6),
  opened_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  closed_at timestamptz(6),
  closure_reason text,
  outcome varchar(500),
  archived_at timestamptz(6),
  archive_reason text,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_matters PRIMARY KEY (id),
  CONSTRAINT fk_matters_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matters_source_enquiry FOREIGN KEY (source_enquiry_id, organisation_id)
    REFERENCES public.enquiries (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matters_department FOREIGN KEY (department_id, organisation_id)
    REFERENCES public.departments (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matters_team FOREIGN KEY (team_id, organisation_id)
    REFERENCES public.teams (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matters_assigned_to FOREIGN KEY (assigned_to_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matters_supervisor FOREIGN KEY (supervisor_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matters_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matters_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matters_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_matters_org_number UNIQUE (organisation_id, matter_number),
  CONSTRAINT uq_matters_org_source_enquiry UNIQUE (organisation_id, source_enquiry_id),
  CONSTRAINT ck_matters_number CHECK (
    matter_number = upper(matter_number)
    AND matter_number ~ '^MAT-[0-9]{6,12}$'
  ),
  CONSTRAINT ck_matters_title CHECK (
    title = btrim(title) AND char_length(title) > 0
  ),
  CONSTRAINT ck_matters_service_type CHECK (
    service_type = btrim(service_type) AND char_length(service_type) > 0
  ),
  CONSTRAINT ck_matters_jurisdiction CHECK (
    jurisdiction_country_code IS NULL OR jurisdiction_country_code ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT ck_matters_next_action CHECK (
    (next_action_summary IS NULL AND next_action_at IS NULL)
    OR (next_action_summary IS NOT NULL AND next_action_at IS NOT NULL)
  ),
  CONSTRAINT ck_matters_closed CHECK (
    (status IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
      AND closed_at IS NOT NULL AND closure_reason IS NOT NULL
      AND char_length(btrim(closure_reason)) > 0)
    OR (status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
      AND closed_at IS NULL AND closure_reason IS NULL)
  ),
  CONSTRAINT ck_matters_archived CHECK (
    (status = 'ARCHIVED' AND archived_at IS NOT NULL
      AND archive_reason IS NOT NULL AND char_length(btrim(archive_reason)) > 0)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL AND archive_reason IS NULL)
  ),
  CONSTRAINT ck_matters_dates CHECK (
    (target_completion_at IS NULL OR target_completion_at >= opened_at)
    AND (closed_at IS NULL OR closed_at >= opened_at)
    AND (archived_at IS NULL OR archived_at >= opened_at)
  ),
  CONSTRAINT ck_matters_assignment CHECK (
    supervisor_user_id IS NULL OR supervisor_user_id IS DISTINCT FROM assigned_to_user_id
  ),
  CONSTRAINT ck_matters_version CHECK (version > 0),
  CONSTRAINT ck_matters_lifecycle CHECK (
    updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at)
  )
);

CREATE TABLE public.matter_parties (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  client_id uuid NOT NULL,
  role public.matter_party_role NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  role_description varchar(240),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_matter_parties PRIMARY KEY (id),
  CONSTRAINT fk_matter_parties_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_parties_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_parties_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matter_parties_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_matter_parties_matter_client_role UNIQUE (matter_id, client_id, role),
  CONSTRAINT ck_matter_parties_primary_role CHECK (
    (is_primary AND role = 'PRIMARY_CLIENT')
    OR (NOT is_primary AND role <> 'PRIMARY_CLIENT')
  ),
  CONSTRAINT ck_matter_parties_role_description CHECK (
    role <> 'OTHER' OR (
      role_description IS NOT NULL AND char_length(btrim(role_description)) > 0
    )
  ),
  CONSTRAINT ck_matter_parties_lifecycle CHECK (
    updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at)
  )
);

CREATE TABLE public.matter_compliance (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  conflict_status public.conflict_check_status NOT NULL DEFAULT 'NOT_STARTED',
  conflict_reference varchar(160),
  conflict_checked_at timestamptz(6),
  conflict_checked_by_user_id uuid,
  aml_status public.aml_check_status NOT NULL DEFAULT 'NOT_STARTED',
  aml_reference varchar(160),
  aml_checked_at timestamptz(6),
  aml_checked_by_user_id uuid,
  client_care_status public.client_care_status NOT NULL DEFAULT 'NOT_SENT',
  client_care_sent_at timestamptz(6),
  client_care_responded_at timestamptz(6),
  risk_rating public.client_risk_rating NOT NULL DEFAULT 'NOT_ASSESSED',
  risk_reason text,
  risk_reviewed_at timestamptz(6),
  risk_reviewed_by_user_id uuid,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_matter_compliance PRIMARY KEY (id),
  CONSTRAINT fk_matter_compliance_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_compliance_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_compliance_conflict_checked_by FOREIGN KEY (conflict_checked_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matter_compliance_aml_checked_by FOREIGN KEY (aml_checked_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matter_compliance_risk_reviewed_by FOREIGN KEY (risk_reviewed_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_matter_compliance_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_compliance_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_matter_compliance_matter_org UNIQUE (matter_id, organisation_id),
  CONSTRAINT ck_matter_compliance_conflict CHECK (
    conflict_status NOT IN ('CLEARED', 'FLAGGED', 'WAIVED')
    OR (conflict_checked_at IS NOT NULL AND conflict_checked_by_user_id IS NOT NULL)
  ),
  CONSTRAINT ck_matter_compliance_aml CHECK (
    aml_status NOT IN ('NOT_REQUIRED', 'VERIFIED', 'FAILED', 'EXPIRED')
    OR (aml_checked_at IS NOT NULL AND aml_checked_by_user_id IS NOT NULL)
  ),
  CONSTRAINT ck_matter_compliance_client_care CHECK (
    (client_care_status = 'NOT_SENT'
      AND client_care_sent_at IS NULL AND client_care_responded_at IS NULL)
    OR (client_care_status = 'SENT'
      AND client_care_sent_at IS NOT NULL AND client_care_responded_at IS NULL)
    OR (client_care_status IN ('ACCEPTED', 'DECLINED')
      AND client_care_sent_at IS NOT NULL AND client_care_responded_at IS NOT NULL)
  ),
  CONSTRAINT ck_matter_compliance_risk CHECK (
    risk_rating = 'NOT_ASSESSED'
    OR (risk_reviewed_at IS NOT NULL AND risk_reviewed_by_user_id IS NOT NULL)
  ),
  CONSTRAINT ck_matter_compliance_version CHECK (version > 0),
  CONSTRAINT ck_matter_compliance_lifecycle CHECK (updated_at >= created_at)
);

CREATE TABLE public.matter_status_history (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  from_status public.matter_status,
  to_status public.matter_status NOT NULL,
  reason varchar(1000) NOT NULL,
  changed_by_user_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_matter_status_history PRIMARY KEY (id),
  CONSTRAINT fk_matter_status_history_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_status_history_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_matter_status_history_changed_by FOREIGN KEY (changed_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_matter_status_history_reason CHECK (
    reason = btrim(reason) AND char_length(reason) > 0
  ),
  CONSTRAINT ck_matter_status_history_change CHECK (
    from_status IS NULL OR from_status IS DISTINCT FROM to_status
  )
);

CREATE TABLE public.enquiry_conversions (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  enquiry_id uuid NOT NULL,
  client_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  converted_by_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_enquiry_conversions PRIMARY KEY (id),
  CONSTRAINT fk_enquiry_conversions_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_enquiry_conversions_enquiry FOREIGN KEY (enquiry_id, organisation_id)
    REFERENCES public.enquiries (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_enquiry_conversions_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_enquiry_conversions_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_enquiry_conversions_converted_by FOREIGN KEY (converted_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_enquiry_conversions_enquiry_org UNIQUE (enquiry_id, organisation_id),
  CONSTRAINT uq_enquiry_conversions_matter_org UNIQUE (matter_id, organisation_id),
  CONSTRAINT uq_enquiry_conversions_org_idempotency UNIQUE (organisation_id, idempotency_key)
);

CREATE UNIQUE INDEX uq_matter_parties_one_primary
  ON public.matter_parties (organisation_id, matter_id)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX ix_clients_org_status_created
  ON public.clients (organisation_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_clients_org_assigned_status
  ON public.clients (organisation_id, assigned_to_user_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_clients_org_email
  ON public.clients (organisation_id, email)
  WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX ix_clients_org_phone
  ON public.clients (organisation_id, phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE INDEX ix_clients_org_retention_review
  ON public.clients (organisation_id, retention_review_at)
  WHERE deleted_at IS NULL AND retention_review_at IS NOT NULL;

CREATE INDEX ix_matters_org_status_created
  ON public.matters (organisation_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_matters_org_assigned_status
  ON public.matters (organisation_id, assigned_to_user_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_matters_org_workforce_status
  ON public.matters (organisation_id, department_id, team_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_matters_org_critical_deadline
  ON public.matters (organisation_id, critical_deadline_at)
  WHERE deleted_at IS NULL AND critical_deadline_at IS NOT NULL;
CREATE INDEX ix_matters_org_next_action
  ON public.matters (organisation_id, next_action_at)
  WHERE deleted_at IS NULL AND next_action_at IS NOT NULL;

CREATE INDEX ix_matter_parties_org_client
  ON public.matter_parties (organisation_id, client_id, deleted_at);
CREATE INDEX ix_matter_parties_org_matter_primary
  ON public.matter_parties (organisation_id, matter_id, is_primary, deleted_at);
CREATE INDEX ix_matter_compliance_org_checks
  ON public.matter_compliance (organisation_id, conflict_status, aml_status);
CREATE INDEX ix_matter_compliance_org_risk
  ON public.matter_compliance (organisation_id, risk_rating);
CREATE INDEX ix_matter_status_history_org_matter
  ON public.matter_status_history (organisation_id, matter_id, occurred_at DESC);
CREATE INDEX ix_matter_status_history_org_status
  ON public.matter_status_history (organisation_id, to_status, occurred_at DESC);
CREATE INDEX ix_enquiry_conversions_org_client
  ON public.enquiry_conversions (organisation_id, client_id, created_at DESC);

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

-- Replace the earlier helper with a stricter tenant, lifecycle and MFA-aware check.
CREATE OR REPLACE FUNCTION private.has_organisation_permission(
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
    AND p_organisation_id = private.current_organisation_id()
    AND private.current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organisation_memberships AS membership
      JOIN public.organisations AS organisation
        ON organisation.id = membership.organisation_id
      JOIN public.user_profiles AS profile
        ON profile.id = membership.user_profile_id
      JOIN public.role_assignments AS assignment
        ON assignment.user_profile_id = membership.user_profile_id
       AND assignment.organisation_id = membership.organisation_id
       AND assignment.organisation_membership_id = membership.id
      JOIN public.roles AS role_record
        ON role_record.id = assignment.role_id
       AND role_record.organisation_id = membership.organisation_id
      JOIN public.role_permissions AS role_permission
        ON role_permission.role_id = role_record.id
      JOIN public.permissions AS permission
        ON permission.id = role_permission.permission_id
      WHERE membership.organisation_id = p_organisation_id
        AND membership.user_profile_id = private.current_user_id()
        AND membership.status = 'ACTIVE'
        AND membership.deleted_at IS NULL
        AND organisation.status IN ('PROVISIONING', 'ACTIVE')
        AND organisation.deleted_at IS NULL
        AND profile.status = 'ACTIVE'
        AND profile.deleted_at IS NULL
        AND assignment.scope = 'ORGANISATION'
        AND assignment.revoked_at IS NULL
        AND assignment.deleted_at IS NULL
        AND assignment.valid_from <= pg_catalog.now()
        AND (assignment.valid_until IS NULL OR assignment.valid_until > pg_catalog.now())
        AND role_record.scope = 'ORGANISATION'
        AND role_record.deleted_at IS NULL
        AND permission.key = p_permission_key
        AND permission.is_active = true
        AND permission.deleted_at IS NULL
        AND (NOT permission.requires_mfa OR private.current_aal() = 'AAL2')
    )
$function$;

ALTER FUNCTION private.has_organisation_permission(uuid, text)
  OWNER TO businessos_policy_reader;
REVOKE ALL ON FUNCTION private.has_organisation_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_organisation_permission(uuid, text)
  TO businessos_app;

GRANT SELECT ON public.clients, public.matters, public.matter_parties,
  public.matter_compliance, public.matter_status_history,
  public.departments, public.teams
  TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.can_read_client(
  p_organisation_id uuid,
  p_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id = private.current_organisation_id()
    AND (
      private.has_organisation_permission(p_organisation_id, 'clients.read_all')
      OR (
        private.has_organisation_permission(p_organisation_id, 'clients.read')
        AND EXISTS (
          SELECT 1
          FROM public.clients AS client
          WHERE client.id = p_client_id
            AND client.organisation_id = p_organisation_id
            AND client.deleted_at IS NULL
            AND (
              client.assigned_to_user_id = private.current_user_id()
              OR client.created_by_user_id = private.current_user_id()
              OR EXISTS (
                SELECT 1
                FROM public.matter_parties AS party
                JOIN public.matters AS matter
                  ON matter.id = party.matter_id
                 AND matter.organisation_id = party.organisation_id
                WHERE party.organisation_id = p_organisation_id
                  AND party.client_id = client.id
                  AND party.deleted_at IS NULL
                  AND matter.deleted_at IS NULL
                  AND (
                    matter.assigned_to_user_id = private.current_user_id()
                    OR matter.supervisor_user_id = private.current_user_id()
                    OR matter.created_by_user_id = private.current_user_id()
                  )
              )
            )
        )
      )
    )
$function$;

CREATE OR REPLACE FUNCTION private.can_update_client(
  p_organisation_id uuid,
  p_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT private.has_organisation_permission(p_organisation_id, 'clients.update_all')
    OR (
      private.has_organisation_permission(p_organisation_id, 'clients.update')
      AND private.can_read_client(p_organisation_id, p_client_id)
    )
$function$;

CREATE OR REPLACE FUNCTION private.can_read_matter(
  p_organisation_id uuid,
  p_matter_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id = private.current_organisation_id()
    AND (
      private.has_organisation_permission(p_organisation_id, 'matters.read_all')
      OR (
        private.has_organisation_permission(p_organisation_id, 'matters.read')
        AND EXISTS (
          SELECT 1
          FROM public.matters AS matter
          WHERE matter.id = p_matter_id
            AND matter.organisation_id = p_organisation_id
            AND matter.deleted_at IS NULL
            AND (
              matter.assigned_to_user_id = private.current_user_id()
              OR matter.supervisor_user_id = private.current_user_id()
              OR matter.created_by_user_id = private.current_user_id()
            )
        )
      )
    )
$function$;

CREATE OR REPLACE FUNCTION private.can_update_matter(
  p_organisation_id uuid,
  p_matter_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT private.has_organisation_permission(p_organisation_id, 'matters.update_all')
    OR (
      private.has_organisation_permission(p_organisation_id, 'matters.update')
      AND private.can_read_matter(p_organisation_id, p_matter_id)
    )
$function$;

ALTER FUNCTION private.can_read_client(uuid, uuid) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.can_update_client(uuid, uuid) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.can_read_matter(uuid, uuid) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.can_update_matter(uuid, uuid) OWNER TO businessos_policy_reader;
REVOKE ALL ON FUNCTION private.can_read_client(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_update_client(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_matter(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_update_matter(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_read_client(uuid, uuid),
  private.can_update_client(uuid, uuid),
  private.can_read_matter(uuid, uuid),
  private.can_update_matter(uuid, uuid)
TO businessos_app;

CREATE OR REPLACE FUNCTION private.assert_active_organisation_user(
  p_organisation_id uuid,
  p_user_id uuid,
  p_field_name text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organisation_memberships AS membership
    JOIN public.user_profiles AS profile ON profile.id = membership.user_profile_id
    WHERE membership.organisation_id = p_organisation_id
      AND membership.user_profile_id = p_user_id
      AND membership.status = 'ACTIVE'
      AND membership.deleted_at IS NULL
      AND profile.status = 'ACTIVE'
      AND profile.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '% must be an active organisation member', p_field_name
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_client_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > CURRENT_DATE THEN
    RAISE EXCEPTION 'date_of_birth cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.created_by_user_id, 'created_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.updated_by_user_id, 'updated_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.assigned_to_user_id, 'assigned_to_user_id'
  );

  IF NEW.updated_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'updated_by_user_id must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.created_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'created_by_user_id must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'ONBOARDING'::public.client_status THEN
    RAISE EXCEPTION 'new clients must begin in onboarding'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'client version must increment exactly once'
        USING ERRCODE = 'serialization_failure';
    END IF;

    IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED'
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'clients.archive') THEN
      RAISE EXCEPTION 'clients.archive permission is required'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF OLD.status = 'ARCHIVED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'archived clients are immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED' AND EXISTS (
      SELECT 1
      FROM public.matter_parties AS party
      JOIN public.matters AS matter
        ON matter.id = party.matter_id
       AND matter.organisation_id = party.organisation_id
      WHERE party.organisation_id = NEW.organisation_id
        AND party.client_id = NEW.id
        AND party.deleted_at IS NULL
        AND matter.deleted_at IS NULL
        AND matter.status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')
    ) THEN
      RAISE EXCEPTION 'clients with open matters cannot be archived'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_matter_primary_party()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_matter_id uuid;
  target_organisation_id uuid;
  live_primary_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'matters' THEN
    target_matter_id := NEW.id;
    target_organisation_id := NEW.organisation_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_matter_id := OLD.matter_id;
    target_organisation_id := OLD.organisation_id;
  ELSE
    target_matter_id := NEW.matter_id;
    target_organisation_id := NEW.organisation_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.matters AS matter
    WHERE matter.id = target_matter_id
      AND matter.organisation_id = target_organisation_id
      AND matter.deleted_at IS NULL
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    RETURN NEW;
  END IF;

  SELECT pg_catalog.count(*) INTO live_primary_count
  FROM public.matter_parties AS party
  WHERE party.matter_id = target_matter_id
    AND party.organisation_id = target_organisation_id
    AND party.is_primary = true
    AND party.deleted_at IS NULL;

  IF live_primary_count <> 1 THEN
    RAISE EXCEPTION 'matter must have exactly one live primary client'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_matter_status_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE latest_status public.matter_status;
BEGIN
  SELECT history.to_status INTO latest_status
  FROM public.matter_status_history AS history
  WHERE history.matter_id = NEW.id
    AND history.organisation_id = NEW.organisation_id
  ORDER BY history.occurred_at DESC, history.id DESC
  LIMIT 1;

  IF latest_status IS NULL OR latest_status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'matter status must have matching append-only evidence'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_matter_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE team_department_id uuid;
BEGIN
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.created_by_user_id, 'created_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.updated_by_user_id, 'updated_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.assigned_to_user_id, 'assigned_to_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.supervisor_user_id, 'supervisor_user_id'
  );

  IF NEW.updated_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'updated_by_user_id must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.created_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'created_by_user_id must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'INTAKE'::public.matter_status THEN
    RAISE EXCEPTION 'new matters must begin in intake'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.departments AS department
    WHERE department.id = NEW.department_id
      AND department.organisation_id = NEW.organisation_id
      AND department.is_active = true
      AND department.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'department must be active in the organisation'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    SELECT team.department_id INTO team_department_id
    FROM public.teams AS team
    WHERE team.id = NEW.team_id
      AND team.organisation_id = NEW.organisation_id
      AND team.is_active = true
      AND team.deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'team must be active in the organisation'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF team_department_id IS DISTINCT FROM NEW.department_id THEN
      RAISE EXCEPTION 'team must belong to the selected department'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'matter version must increment exactly once'
        USING ERRCODE = 'serialization_failure';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'matters.status.manage') THEN
      RAISE EXCEPTION 'matters.status.manage permission is required'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF OLD.status = 'ARCHIVED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'archived matters are immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF (
      NEW.department_id IS DISTINCT FROM OLD.department_id
      OR NEW.team_id IS DISTINCT FROM OLD.team_id
      OR NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id
      OR NEW.supervisor_user_id IS DISTINCT FROM OLD.supervisor_user_id
    ) AND NOT private.has_organisation_permission(
      NEW.organisation_id, 'matters.assign'
    ) THEN
      RAISE EXCEPTION 'matters.assign permission is required'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'INTAKE' AND NEW.status IN ('CONFLICT_CHECK', 'ON_HOLD', 'CANCELLED'))
      OR (OLD.status = 'CONFLICT_CHECK' AND NEW.status IN ('CLIENT_CARE', 'ON_HOLD', 'CANCELLED'))
      OR (OLD.status = 'CLIENT_CARE' AND NEW.status IN ('AWAITING_DOCUMENTS', 'ACTIVE', 'ON_HOLD', 'CANCELLED'))
      OR (OLD.status = 'AWAITING_DOCUMENTS' AND NEW.status IN ('ACTIVE', 'ON_HOLD', 'CANCELLED'))
      OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUBMITTED', 'DECISION_RECEIVED', 'ON_HOLD', 'CLOSED', 'CANCELLED'))
      OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('DECISION_RECEIVED', 'ON_HOLD', 'CANCELLED'))
      OR (OLD.status = 'DECISION_RECEIVED' AND NEW.status IN ('ACTIVE', 'ON_HOLD', 'CLOSED', 'CANCELLED'))
      OR (OLD.status = 'ON_HOLD' AND NEW.status IN (
        'CONFLICT_CHECK', 'CLIENT_CARE', 'AWAITING_DOCUMENTS', 'ACTIVE',
        'SUBMITTED', 'DECISION_RECEIVED', 'CANCELLED'
      ))
      OR (OLD.status IN ('CLOSED', 'CANCELLED') AND NEW.status = 'ARCHIVED')
    ) THEN
      RAISE EXCEPTION 'invalid matter status transition'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IN ('CLIENT_CARE', 'ACTIVE', 'SUBMITTED')
      AND NEW.status IS DISTINCT FROM OLD.status
      AND NOT EXISTS (
        SELECT 1
        FROM public.matter_compliance AS compliance
        WHERE compliance.matter_id = NEW.id
          AND compliance.organisation_id = NEW.organisation_id
          AND compliance.conflict_status IN ('CLEARED', 'WAIVED')
          AND (
            NEW.status = 'CLIENT_CARE'
            OR (
              compliance.aml_status IN ('NOT_REQUIRED', 'VERIFIED')
              AND compliance.client_care_status = 'ACCEPTED'
            )
          )
      ) THEN
      RAISE EXCEPTION 'matter compliance gates are incomplete'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED'
      AND NOT private.has_organisation_permission(NEW.organisation_id, 'matters.archive') THEN
      RAISE EXCEPTION 'matters.archive permission is required'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_matter_compliance_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.created_by_user_id, 'created_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.updated_by_user_id, 'updated_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.conflict_checked_by_user_id, 'conflict_checked_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.aml_checked_by_user_id, 'aml_checked_by_user_id'
  );
  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, NEW.risk_reviewed_by_user_id, 'risk_reviewed_by_user_id'
  );

  IF NEW.updated_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'updated_by_user_id must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.created_by_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'created_by_user_id must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'matter compliance version must increment exactly once'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matters AS matter
    WHERE matter.id = NEW.matter_id
      AND matter.organisation_id = NEW.organisation_id
      AND matter.status IN ('ACTIVE', 'SUBMITTED')
  ) AND NOT (
    NEW.conflict_status IN ('CLEARED', 'WAIVED')
    AND NEW.aml_status IN ('NOT_REQUIRED', 'VERIFIED')
    AND NEW.client_care_status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'active matter compliance controls cannot be weakened'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_case_ledger_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid;
BEGIN
  actor_id := CASE
    WHEN TG_TABLE_NAME = 'matter_status_history' THEN NEW.changed_by_user_id
    ELSE NEW.converted_by_user_id
  END;

  PERFORM private.assert_active_organisation_user(
    NEW.organisation_id, actor_id, 'ledger actor'
  );

  IF actor_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'ledger actor must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.reject_case_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$function$;

ALTER FUNCTION private.assert_active_organisation_user(uuid, uuid, text)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_client_row() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_matter_row() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_matter_compliance_row() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_matter_primary_party() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_matter_status_evidence() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.validate_case_ledger_actor() OWNER TO businessos_policy_reader;
ALTER FUNCTION private.reject_case_ledger_mutation() OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.assert_active_organisation_user(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_client_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_matter_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_matter_compliance_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_matter_primary_party() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_matter_status_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_case_ledger_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reject_case_ledger_mutation() FROM PUBLIC;

CREATE TRIGGER clients_immutable
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'client_number', 'source_enquiry_id',
    'created_by_user_id', 'created_at', 'deleted_at'
  );
CREATE TRIGGER clients_validate
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION private.validate_client_row();

CREATE TRIGGER organisation_number_sequences_immutable
  BEFORE UPDATE ON public.organisation_number_sequences
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'key', 'created_at'
  );

CREATE TRIGGER matters_immutable
  BEFORE UPDATE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_number', 'source_enquiry_id',
    'created_by_user_id', 'created_at', 'deleted_at'
  );
CREATE TRIGGER matters_validate
  BEFORE INSERT OR UPDATE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION private.validate_matter_row();

CREATE TRIGGER matter_parties_immutable
  BEFORE UPDATE ON public.matter_parties
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'client_id', 'role', 'is_primary',
    'created_at'
  );

CREATE CONSTRAINT TRIGGER matters_require_primary_party
  AFTER INSERT OR UPDATE ON public.matters
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.validate_matter_primary_party();

CREATE CONSTRAINT TRIGGER matters_require_status_evidence
  AFTER INSERT OR UPDATE ON public.matters
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.validate_matter_status_evidence();

CREATE CONSTRAINT TRIGGER matter_parties_require_primary_party
  AFTER INSERT OR UPDATE OR DELETE ON public.matter_parties
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.validate_matter_primary_party();

CREATE TRIGGER matter_compliance_immutable
  BEFORE UPDATE ON public.matter_compliance
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'created_by_user_id', 'created_at'
  );
CREATE TRIGGER matter_compliance_validate
  BEFORE INSERT OR UPDATE ON public.matter_compliance
  FOR EACH ROW EXECUTE FUNCTION private.validate_matter_compliance_row();

CREATE TRIGGER matter_status_history_validate_actor
  BEFORE INSERT ON public.matter_status_history
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_ledger_actor();
CREATE TRIGGER matter_status_history_append_only
  BEFORE UPDATE OR DELETE ON public.matter_status_history
  FOR EACH ROW EXECUTE FUNCTION private.reject_case_ledger_mutation();

CREATE TRIGGER enquiry_conversions_validate_actor
  BEFORE INSERT ON public.enquiry_conversions
  FOR EACH ROW EXECUTE FUNCTION private.validate_case_ledger_actor();
CREATE TRIGGER enquiry_conversions_append_only
  BEFORE UPDATE OR DELETE ON public.enquiry_conversions
  FOR EACH ROW EXECUTE FUNCTION private.reject_case_ledger_mutation();

WITH permission_seed (
  permission_key, permission_name, permission_description,
  resource_name, action_name, is_sensitive, requires_mfa
) AS (
  VALUES
    ('clients.create', 'Create clients', 'Create a client record inside the authorised organisation.', 'clients', 'create', true, false),
    ('clients.read', 'View assigned clients', 'View clients assigned to or linked with the authorised user.', 'clients', 'read', true, false),
    ('clients.read_all', 'View all organisation clients', 'View all clients inside the authorised organisation.', 'clients', 'read_all', true, false),
    ('clients.update', 'Update assigned clients', 'Update clients assigned to or linked with the authorised user.', 'clients', 'update', true, false),
    ('clients.update_all', 'Update all organisation clients', 'Update all clients inside the authorised organisation.', 'clients', 'update_all', true, true),
    ('clients.archive', 'Archive clients', 'Archive a client after dependency and retention checks.', 'clients', 'archive', true, true),
    ('matters.create', 'Create matters', 'Open a matter for an authorised client.', 'matters', 'create', true, false),
    ('matters.read', 'View assigned matters', 'View matters assigned to or supervised by the authorised user.', 'matters', 'read', true, false),
    ('matters.read_all', 'View all organisation matters', 'View all matters inside the authorised organisation.', 'matters', 'read_all', true, false),
    ('matters.update', 'Update assigned matters', 'Update matters assigned to or supervised by the authorised user.', 'matters', 'update', true, false),
    ('matters.update_all', 'Update all organisation matters', 'Update all matters inside the authorised organisation.', 'matters', 'update_all', true, true),
    ('matters.assign', 'Assign matters', 'Assign matters to active organisation workers and teams.', 'matters', 'assign', true, false),
    ('matters.status.manage', 'Progress matter status', 'Progress a matter through its controlled lifecycle.', 'matters', 'status_manage', true, false),
    ('matters.compliance.manage', 'Manage matter compliance', 'Record conflict, AML, client-care and risk checks.', 'matters', 'compliance_manage', true, true),
    ('matters.parties.manage', 'Manage matter parties', 'Add, change or remove authorised parties from a matter.', 'matters', 'parties_manage', true, false),
    ('matters.archive', 'Archive matters', 'Archive a closed or cancelled matter after retention checks.', 'matters', 'archive', true, true)
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

INSERT INTO public.roles (
  id, organisation_id, key, name, description, scope,
  is_system, is_assignable, created_at, updated_at
)
SELECT
  pg_catalog.gen_random_uuid(), organisation.id, role_seed.key,
  role_seed.name, role_seed.description,
  'ORGANISATION'::public.role_scope, true, true,
  pg_catalog.now(), pg_catalog.now()
FROM public.organisations AS organisation
CROSS JOIN (
  VALUES
    ('case_manager', 'Case Manager', 'Supervises client onboarding, matter allocation, progress and compliance.'),
    ('case_worker', 'Case Worker', 'Manages assigned clients and progresses assigned matters under supervision.')
) AS role_seed(key, name, description)
WHERE organisation.deleted_at IS NULL
ON CONFLICT (organisation_id, key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_assignable = true,
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
  AND permission_record.resource IN ('clients', 'matters')
  AND permission_record.is_active = true
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('case_manager', 'clients.create'),
    ('case_manager', 'clients.read'),
    ('case_manager', 'clients.read_all'),
    ('case_manager', 'clients.update'),
    ('case_manager', 'clients.update_all'),
    ('case_manager', 'clients.archive'),
    ('case_manager', 'matters.create'),
    ('case_manager', 'matters.read'),
    ('case_manager', 'matters.read_all'),
    ('case_manager', 'matters.update'),
    ('case_manager', 'matters.update_all'),
    ('case_manager', 'matters.assign'),
    ('case_manager', 'matters.status.manage'),
    ('case_manager', 'matters.compliance.manage'),
    ('case_manager', 'matters.parties.manage'),
    ('case_manager', 'matters.archive'),
    ('case_manager', 'enquiries.read_all'),
    ('case_manager', 'enquiries.update'),
    ('case_manager', 'enquiries.convert'),
    ('case_worker', 'clients.create'),
    ('case_worker', 'clients.read'),
    ('case_worker', 'clients.update'),
    ('case_worker', 'matters.create'),
    ('case_worker', 'matters.read'),
    ('case_worker', 'matters.update'),
    ('case_worker', 'matters.status.manage'),
    ('case_worker', 'matters.compliance.manage'),
    ('case_worker', 'matters.parties.manage'),
    ('case_worker', 'enquiries.read'),
    ('case_worker', 'enquiries.update'),
    ('case_worker', 'enquiries.convert'),
    ('solicitor', 'clients.create'),
    ('solicitor', 'clients.read'),
    ('solicitor', 'clients.update'),
    ('solicitor', 'matters.create'),
    ('solicitor', 'matters.read'),
    ('solicitor', 'matters.update'),
    ('solicitor', 'matters.status.manage'),
    ('solicitor', 'matters.compliance.manage'),
    ('solicitor', 'matters.parties.manage'),
    ('sales_manager', 'clients.create'),
    ('sales_manager', 'clients.read_all'),
    ('sales_manager', 'clients.update'),
    ('sales_manager', 'clients.update_all'),
    ('sales_manager', 'matters.create'),
    ('sales_manager', 'matters.read'),
    ('sales_manager', 'matters.read_all'),
    ('sales_manager', 'matters.update'),
    ('sales_manager', 'matters.update_all'),
    ('sales_manager', 'matters.assign'),
    ('sales_manager', 'matters.status.manage'),
    ('sales_manager', 'matters.parties.manage'),
    ('sales_agent', 'clients.create'),
    ('sales_agent', 'clients.read'),
    ('sales_agent', 'clients.update'),
    ('sales_agent', 'matters.create'),
    ('sales_agent', 'matters.read'),
    ('sales_agent', 'matters.update'),
    ('sales_agent', 'matters.status.manage'),
    ('sales_agent', 'matters.parties.manage'),
    ('compliance_manager', 'clients.read_all'),
    ('compliance_manager', 'clients.read'),
    ('compliance_manager', 'matters.read_all'),
    ('compliance_manager', 'matters.read'),
    ('compliance_manager', 'matters.update_all'),
    ('compliance_manager', 'matters.status.manage'),
    ('compliance_manager', 'matters.compliance.manage'),
    ('finance', 'clients.read_all'),
    ('finance', 'clients.read'),
    ('finance', 'matters.read_all'),
    ('finance', 'matters.read'),
    ('read_only', 'clients.read_all'),
    ('read_only', 'clients.read'),
    ('read_only', 'matters.read_all'),
    ('read_only', 'matters.read')
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

REVOKE ALL PRIVILEGES ON public.organisation_number_sequences,
  public.clients, public.matters, public.matter_parties,
  public.matter_compliance, public.matter_status_history,
  public.enquiry_conversions
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON TYPE public.client_kind, public.client_status,
  public.client_risk_rating, public.identity_verification_status,
  public.processing_lawful_basis, public.communication_channel,
  public.matter_status, public.matter_priority, public.matter_party_role,
  public.conflict_check_status, public.aml_check_status,
  public.client_care_status
TO businessos_app, businessos_policy_reader;

GRANT SELECT, INSERT, UPDATE ON public.organisation_number_sequences,
  public.clients, public.matters, public.matter_parties,
  public.matter_compliance
TO businessos_app;

GRANT SELECT, INSERT ON public.matter_status_history,
  public.enquiry_conversions
TO businessos_app;

ALTER TABLE public.organisation_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_number_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_parties FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_compliance FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enquiry_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiry_conversions FORCE ROW LEVEL SECURITY;

-- SECURITY DEFINER authorization helpers are owned by this NOBYPASSRLS role.
-- These narrowly scoped read policies prevent recursive RLS while keeping the
-- application role subject to the tenant and assignment policies below.
CREATE POLICY policy_reader_case_clients ON public.clients
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_matters ON public.matters
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_parties ON public.matter_parties
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_compliance ON public.matter_compliance
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_status_history ON public.matter_status_history
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_departments ON public.departments
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_case_teams ON public.teams
  FOR SELECT TO businessos_policy_reader USING (true);

CREATE POLICY org_number_sequences_select ON public.organisation_number_sequences
  FOR SELECT TO businessos_app
  USING (private.is_current_org_member(organisation_id));
CREATE POLICY org_number_sequences_insert ON public.organisation_number_sequences
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'clients.create')
    OR private.has_organisation_permission(organisation_id, 'matters.create')
  );
CREATE POLICY org_number_sequences_update ON public.organisation_number_sequences
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'clients.create')
    OR private.has_organisation_permission(organisation_id, 'matters.create')
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'clients.create')
    OR private.has_organisation_permission(organisation_id, 'matters.create')
  );

CREATE POLICY clients_select ON public.clients
  FOR SELECT TO businessos_app
  USING (deleted_at IS NULL AND private.can_read_client(organisation_id, id));
CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'clients.create')
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
    AND deleted_at IS NULL
  );
CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO businessos_app
  USING (deleted_at IS NULL AND private.can_update_client(organisation_id, id))
  WITH CHECK (
    deleted_at IS NULL
    AND private.can_update_client(organisation_id, id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY matters_select ON public.matters
  FOR SELECT TO businessos_app
  USING (deleted_at IS NULL AND private.can_read_matter(organisation_id, id));
CREATE POLICY matters_insert ON public.matters
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'matters.create')
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
    AND deleted_at IS NULL
  );
CREATE POLICY matters_update ON public.matters
  FOR UPDATE TO businessos_app
  USING (deleted_at IS NULL AND private.can_update_matter(organisation_id, id))
  WITH CHECK (
    deleted_at IS NULL
    AND private.can_update_matter(organisation_id, id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY matter_parties_select ON public.matter_parties
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY matter_parties_insert ON public.matter_parties
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'matters.parties.manage')
    AND private.can_update_matter(organisation_id, matter_id)
    AND deleted_at IS NULL
  );
CREATE POLICY matter_parties_update ON public.matter_parties
  FOR UPDATE TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(organisation_id, 'matters.parties.manage')
    AND private.can_update_matter(organisation_id, matter_id)
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'matters.parties.manage')
    AND private.can_update_matter(organisation_id, matter_id)
  );

CREATE POLICY matter_compliance_select ON public.matter_compliance
  FOR SELECT TO businessos_app
  USING (private.can_read_matter(organisation_id, matter_id));
CREATE POLICY matter_compliance_insert ON public.matter_compliance
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'matters.create')
    AND private.can_update_matter(organisation_id, matter_id)
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
  );
CREATE POLICY matter_compliance_update ON public.matter_compliance
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'matters.compliance.manage')
    AND private.can_update_matter(organisation_id, matter_id)
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'matters.compliance.manage')
    AND private.can_update_matter(organisation_id, matter_id)
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY matter_status_history_select ON public.matter_status_history
  FOR SELECT TO businessos_app
  USING (private.can_read_matter(organisation_id, matter_id));
CREATE POLICY matter_status_history_insert ON public.matter_status_history
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'matters.status.manage')
    AND private.can_update_matter(organisation_id, matter_id)
    AND changed_by_user_id = private.current_user_id()
  );

CREATE POLICY enquiry_conversions_select ON public.enquiry_conversions
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'enquiries.convert')
    OR private.can_read_matter(organisation_id, matter_id)
  );
CREATE POLICY enquiry_conversions_insert ON public.enquiry_conversions
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'enquiries.convert')
    AND private.has_organisation_permission(organisation_id, 'clients.create')
    AND private.has_organisation_permission(organisation_id, 'matters.create')
    AND converted_by_user_id = private.current_user_id()
  );

COMMENT ON TABLE public.clients IS
  'Organisation-isolated clients with lawful-basis, consent, identity and retention controls.';
COMMENT ON TABLE public.matters IS
  'Organisation-isolated matters with controlled assignments, deadlines and lifecycle.';
COMMENT ON TABLE public.matter_parties IS
  'Authorised clients participating in a matter; exactly one live primary client is enforced.';
COMMENT ON TABLE public.matter_compliance IS
  'Matter-level conflict, AML, client-care and risk state; updates require MFA.';
COMMENT ON TABLE public.matter_status_history IS
  'Append-only matter lifecycle evidence.';
COMMENT ON TABLE public.enquiry_conversions IS
  'Append-only, idempotent enquiry-to-client-and-matter conversion ledger.';

COMMIT;