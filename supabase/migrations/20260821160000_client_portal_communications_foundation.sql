-- BusinessOS Gate D: secure client portal and communications foundation.
--
-- Security properties:
--   * portal access is an explicit, revocable user/client/matter grant;
--   * invitation tokens are stored only as keyed hashes;
--   * staff access remains organisation, record-scope, permission and MFA gated;
--   * client identities never receive organisation memberships or staff roles;
--   * message delivery evidence is append-only;
--   * provider secrets are not stored in application tables;
--   * portal document access remains fail-closed until malware scanning succeeds.

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

CREATE TYPE public.business_communication_channel AS ENUM (
  'PORTAL', 'EMAIL', 'WHATSAPP'
);

CREATE TYPE public.communication_direction AS ENUM (
  'INBOUND', 'OUTBOUND', 'INTERNAL'
);

CREATE TYPE public.communication_actor_type AS ENUM (
  'STAFF', 'CLIENT', 'SYSTEM', 'AI_AGENT'
);

CREATE TYPE public.communication_conversation_status AS ENUM (
  'OPEN', 'WAITING_ON_CLIENT', 'WAITING_ON_TEAM', 'RESOLVED', 'ARCHIVED'
);

CREATE TYPE public.communication_message_status AS ENUM (
  'DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SENDING', 'SENT',
  'DELIVERED', 'READ', 'FAILED', 'CANCELLED'
);

CREATE TYPE public.communication_delivery_event_type AS ENUM (
  'QUEUED', 'ACCEPTED', 'DELIVERED', 'READ', 'BOUNCED',
  'COMPLAINED', 'FAILED', 'CANCELLED'
);

CREATE TYPE public.communication_template_status AS ENUM (
  'DRAFT', 'ACTIVE', 'ARCHIVED'
);

CREATE TYPE public.communication_reminder_status AS ENUM (
  'SCHEDULED', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED'
);

CREATE TYPE public.portal_access_status AS ENUM (
  'ACTIVE', 'SUSPENDED', 'REVOKED'
);

CREATE TYPE public.portal_invitation_status AS ENUM (
  'PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'
);

CREATE TABLE public.client_portal_access_grants (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  status public.portal_access_status NOT NULL DEFAULT 'ACTIVE',
  scopes varchar(80)[] NOT NULL DEFAULT ARRAY[
    'MATTER_PROGRESS', 'DOCUMENTS', 'MESSAGES', 'NOTIFICATIONS'
  ]::varchar(80)[],
  starts_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz(6),
  granted_by_user_id uuid NOT NULL,
  grant_reason varchar(1000) NOT NULL,
  suspended_at timestamptz(6),
  suspended_by_user_id uuid,
  suspension_reason varchar(1000),
  revoked_at timestamptz(6),
  revoked_by_user_id uuid,
  revocation_reason varchar(1000),
  last_accessed_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_client_portal_access_grants PRIMARY KEY (id),
  CONSTRAINT fk_portal_access_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_access_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_access_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_access_granted_by FOREIGN KEY (granted_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_access_suspended_by FOREIGN KEY (suspended_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_access_revoked_by FOREIGN KEY (revoked_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_portal_access_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_portal_access_scopes CHECK (
    cardinality(scopes) BETWEEN 1 AND 8
    AND scopes <@ ARRAY[
      'MATTER_PROGRESS', 'DOCUMENTS', 'MESSAGES', 'NOTIFICATIONS'
    ]::varchar(80)[]
  ),
  CONSTRAINT ck_portal_access_time CHECK (
    expires_at IS NULL OR expires_at > starts_at
  ),
  CONSTRAINT ck_portal_access_version CHECK (version > 0),
  CONSTRAINT ck_portal_access_status_evidence CHECK (
    (status = 'ACTIVE' AND suspended_at IS NULL AND suspended_by_user_id IS NULL
      AND suspension_reason IS NULL AND revoked_at IS NULL
      AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'SUSPENDED' AND suspended_at IS NOT NULL
      AND suspended_by_user_id IS NOT NULL AND suspension_reason IS NOT NULL
      AND revoked_at IS NULL AND revoked_by_user_id IS NULL
      AND revocation_reason IS NULL)
    OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL
      AND revoked_by_user_id IS NOT NULL AND revocation_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_portal_access_active_identity_client
  ON public.client_portal_access_grants (
    organisation_id, client_id, user_profile_id
  ) WHERE status = 'ACTIVE';
CREATE INDEX ix_portal_access_user_status
  ON public.client_portal_access_grants (
    user_profile_id, status, expires_at
  );
CREATE INDEX ix_portal_access_org_client_status
  ON public.client_portal_access_grants (
    organisation_id, client_id, status
  );

CREATE TABLE public.client_portal_matter_grants (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  access_grant_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_client_portal_matter_grants PRIMARY KEY (id),
  CONSTRAINT fk_portal_matter_grant_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_matter_grant_access FOREIGN KEY (
    access_grant_id, organisation_id
  ) REFERENCES public.client_portal_access_grants (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_matter_grant_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_portal_matter_grant UNIQUE (access_grant_id, matter_id),
  CONSTRAINT uq_portal_matter_grant_id_org UNIQUE (id, organisation_id)
);

CREATE INDEX ix_portal_matter_grants_org_matter
  ON public.client_portal_matter_grants (organisation_id, matter_id);

CREATE TABLE public.client_portal_invitations (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  email varchar(320) NOT NULL,
  matter_ids uuid[] NOT NULL,
  scopes varchar(80)[] NOT NULL DEFAULT ARRAY[
    'MATTER_PROGRESS', 'DOCUMENTS', 'MESSAGES', 'NOTIFICATIONS'
  ]::varchar(80)[],
  token_hash char(64) NOT NULL,
  status public.portal_invitation_status NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz(6) NOT NULL,
  invited_by_user_id uuid NOT NULL,
  accepted_at timestamptz(6),
  accepted_by_user_id uuid,
  access_grant_id uuid,
  revoked_at timestamptz(6),
  revoked_by_user_id uuid,
  revocation_reason varchar(1000),
  delivery_provider varchar(80),
  delivery_message_id varchar(240),
  delivered_at timestamptz(6),
  delivery_error_code varchar(120),
  delivery_error_detail varchar(1000),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_client_portal_invitations PRIMARY KEY (id),
  CONSTRAINT fk_portal_invitation_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_invitation_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_invitation_inviter FOREIGN KEY (invited_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_invitation_acceptor FOREIGN KEY (accepted_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_invitation_access FOREIGN KEY (
    access_grant_id, organisation_id
  ) REFERENCES public.client_portal_access_grants (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_invitation_revoker FOREIGN KEY (revoked_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_portal_invitation_token_hash UNIQUE (token_hash),
  CONSTRAINT uq_portal_invitation_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_portal_invitation_email CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320
      AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT ck_portal_invitation_hash CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_portal_invitation_matters CHECK (
    cardinality(matter_ids) BETWEEN 1 AND 50
  ),
  CONSTRAINT ck_portal_invitation_scopes CHECK (
    cardinality(scopes) BETWEEN 1 AND 8
    AND scopes <@ ARRAY[
      'MATTER_PROGRESS', 'DOCUMENTS', 'MESSAGES', 'NOTIFICATIONS'
    ]::varchar(80)[]
  ),
  CONSTRAINT ck_portal_invitation_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_portal_invitation_status_evidence CHECK (
    (status = 'PENDING' AND accepted_at IS NULL AND accepted_by_user_id IS NULL
      AND access_grant_id IS NULL AND revoked_at IS NULL
      AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'ACCEPTED' AND accepted_at IS NOT NULL
      AND accepted_by_user_id IS NOT NULL AND access_grant_id IS NOT NULL
      AND revoked_at IS NULL)
    OR
    (status = 'REVOKED' AND accepted_at IS NULL
      AND access_grant_id IS NULL AND revoked_at IS NOT NULL
      AND revoked_by_user_id IS NOT NULL AND revocation_reason IS NOT NULL)
    OR
    (status = 'EXPIRED' AND accepted_at IS NULL
      AND access_grant_id IS NULL AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_portal_invitation_pending_identity
  ON public.client_portal_invitations (organisation_id, client_id, email)
  WHERE status = 'PENDING';
CREATE INDEX ix_portal_invitations_org_status_expiry
  ON public.client_portal_invitations (organisation_id, status, expires_at);

CREATE TABLE public.portal_matter_updates (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  title varchar(240) NOT NULL,
  summary text NOT NULL,
  stage_key varchar(120),
  progress_percent smallint,
  published_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  published_by_user_id uuid NOT NULL,
  superseded_at timestamptz(6),
  superseded_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_portal_matter_updates PRIMARY KEY (id),
  CONSTRAINT fk_portal_update_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_update_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_update_publisher FOREIGN KEY (published_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_portal_update_superseded_by FOREIGN KEY (superseded_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_portal_update_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_portal_update_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_portal_update_summary CHECK (
    summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 10000
  ),
  CONSTRAINT ck_portal_update_progress CHECK (
    progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT ck_portal_update_superseded CHECK (
    (superseded_at IS NULL AND superseded_by_user_id IS NULL)
    OR (superseded_at IS NOT NULL AND superseded_by_user_id IS NOT NULL)
  )
);

CREATE INDEX ix_portal_updates_org_matter_published
  ON public.portal_matter_updates (
    organisation_id, matter_id, published_at DESC
  ) WHERE superseded_at IS NULL;

CREATE TABLE public.communication_conversations (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  matter_id uuid,
  client_id uuid,
  channel public.business_communication_channel NOT NULL,
  subject varchar(240) NOT NULL,
  status public.communication_conversation_status NOT NULL DEFAULT 'OPEN',
  external_thread_id varchar(240),
  assigned_to_user_id uuid,
  created_by_user_id uuid,
  last_message_at timestamptz(6),
  resolved_at timestamptz(6),
  archived_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_communication_conversations PRIMARY KEY (id),
  CONSTRAINT fk_conversation_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_conversation_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_conversation_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_conversation_assignee FOREIGN KEY (assigned_to_user_id)
    REFERENCES public.user_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_conversation_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_conversation_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_conversation_subject CHECK (
    subject = btrim(subject) AND char_length(subject) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_conversation_link CHECK (
    matter_id IS NOT NULL OR client_id IS NOT NULL
  ),
  CONSTRAINT ck_conversation_version CHECK (version > 0),
  CONSTRAINT ck_conversation_status_time CHECK (
    (status = 'RESOLVED' AND resolved_at IS NOT NULL AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status NOT IN ('RESOLVED', 'ARCHIVED')
      AND resolved_at IS NULL AND archived_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_portal_conversation_matter_client
  ON public.communication_conversations (
    organisation_id, matter_id, client_id, channel
  ) WHERE channel = 'PORTAL' AND deleted_at IS NULL;
CREATE INDEX ix_conversations_org_status_last
  ON public.communication_conversations (
    organisation_id, status, last_message_at DESC NULLS LAST, created_at DESC
  ) WHERE deleted_at IS NULL;
CREATE INDEX ix_conversations_org_matter
  ON public.communication_conversations (organisation_id, matter_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE public.communication_messages (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  matter_id uuid,
  client_id uuid,
  channel public.business_communication_channel NOT NULL,
  direction public.communication_direction NOT NULL,
  actor_type public.communication_actor_type NOT NULL,
  author_user_profile_id uuid,
  sender_address varchar(320),
  recipient_addresses varchar(320)[] NOT NULL DEFAULT ARRAY[]::varchar(320)[],
  subject varchar(500),
  body_text text NOT NULL,
  status public.communication_message_status NOT NULL,
  client_visible boolean NOT NULL DEFAULT true,
  approval_request_id uuid,
  idempotency_key varchar(180) NOT NULL,
  provider varchar(80),
  provider_message_id varchar(240),
  scheduled_at timestamptz(6),
  queued_at timestamptz(6),
  sent_at timestamptz(6),
  delivered_at timestamptz(6),
  read_at timestamptz(6),
  failed_at timestamptz(6),
  failure_code varchar(120),
  failure_detail varchar(1000),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  lease_owner varchar(160),
  lease_expires_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_communication_messages PRIMARY KEY (id),
  CONSTRAINT fk_message_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_message_conversation FOREIGN KEY (conversation_id, organisation_id)
    REFERENCES public.communication_conversations (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_message_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_message_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_message_author FOREIGN KEY (author_user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_message_approval FOREIGN KEY (approval_request_id, organisation_id)
    REFERENCES public.approval_requests (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_message_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_message_org_idempotency UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT uq_message_provider_id UNIQUE (provider, provider_message_id),
  CONSTRAINT ck_message_body CHECK (
    body_text = btrim(body_text) AND char_length(body_text) BETWEEN 1 AND 50000
  ),
  CONSTRAINT ck_message_recipients CHECK (
    cardinality(recipient_addresses) <= 20
  ),
  CONSTRAINT ck_message_attempts CHECK (
    attempts BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 10
  ),
  CONSTRAINT ck_message_portal_state CHECK (
    channel <> 'PORTAL'
    OR (
      provider IS NULL AND provider_message_id IS NULL
      AND status IN ('DELIVERED', 'READ')
      AND delivered_at IS NOT NULL
    )
  ),
  CONSTRAINT ck_message_external_recipient CHECK (
    channel = 'PORTAL' OR cardinality(recipient_addresses) BETWEEN 1 AND 20
  ),
  CONSTRAINT ck_message_failure CHECK (
    (status = 'FAILED' AND failed_at IS NOT NULL AND failure_code IS NOT NULL)
    OR status <> 'FAILED'
  )
);

CREATE INDEX ix_messages_org_conversation_created
  ON public.communication_messages (
    organisation_id, conversation_id, created_at DESC
  );
CREATE INDEX ix_messages_delivery_queue
  ON public.communication_messages (
    status, next_attempt_at, scheduled_at, created_at
  ) WHERE channel = 'EMAIL' AND status IN ('QUEUED', 'SENDING');
CREATE INDEX ix_messages_provider_id
  ON public.communication_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE public.communication_attachments (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  client_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_communication_attachments PRIMARY KEY (id),
  CONSTRAINT fk_attachment_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_attachment_message FOREIGN KEY (message_id, organisation_id)
    REFERENCES public.communication_messages (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_attachment_document FOREIGN KEY (document_id, organisation_id)
    REFERENCES public.matter_documents (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_attachment_version FOREIGN KEY (document_version_id, organisation_id)
    REFERENCES public.matter_document_versions (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_attachment_message_version UNIQUE (message_id, document_version_id),
  CONSTRAINT uq_attachment_id_org UNIQUE (id, organisation_id)
);

CREATE TABLE public.communication_delivery_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  event_type public.communication_delivery_event_type NOT NULL,
  provider varchar(80),
  provider_event_id varchar(240),
  occurred_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_communication_delivery_events PRIMARY KEY (id),
  CONSTRAINT fk_delivery_event_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_delivery_event_message FOREIGN KEY (message_id, organisation_id)
    REFERENCES public.communication_messages (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_delivery_event_provider UNIQUE (provider, provider_event_id),
  CONSTRAINT ck_delivery_event_payload CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object'
      AND pg_column_size(payload) <= 32768
  )
);

CREATE INDEX ix_delivery_events_org_message_occurred
  ON public.communication_delivery_events (
    organisation_id, message_id, occurred_at DESC
  );

CREATE TABLE public.communication_templates (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  key varchar(120) NOT NULL,
  name varchar(180) NOT NULL,
  description varchar(1000),
  channel public.business_communication_channel NOT NULL,
  subject_template varchar(500),
  body_template text NOT NULL,
  allowed_variables varchar(120)[] NOT NULL DEFAULT ARRAY[]::varchar(120)[],
  status public.communication_template_status NOT NULL DEFAULT 'DRAFT',
  version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  deleted_at timestamptz(6),
  CONSTRAINT pk_communication_templates PRIMARY KEY (id),
  CONSTRAINT fk_template_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_template_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_template_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_template_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_template_org_key_version UNIQUE (organisation_id, key, version),
  CONSTRAINT ck_template_key CHECK (
    key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  ),
  CONSTRAINT ck_template_body CHECK (
    body_template = btrim(body_template)
      AND char_length(body_template) BETWEEN 1 AND 50000
  ),
  CONSTRAINT ck_template_variables CHECK (cardinality(allowed_variables) <= 50),
  CONSTRAINT ck_template_version CHECK (version > 0)
);

CREATE INDEX ix_templates_org_status_channel
  ON public.communication_templates (
    organisation_id, status, channel, name
  ) WHERE deleted_at IS NULL;

CREATE TABLE public.communication_reminders (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  matter_id uuid,
  client_id uuid,
  channel public.business_communication_channel NOT NULL,
  recipient_address varchar(320),
  subject varchar(500),
  body_text text NOT NULL,
  scheduled_for timestamptz(6) NOT NULL,
  status public.communication_reminder_status NOT NULL DEFAULT 'SCHEDULED',
  idempotency_key varchar(180) NOT NULL,
  message_id uuid,
  created_by_user_id uuid NOT NULL,
  cancelled_at timestamptz(6),
  cancelled_by_user_id uuid,
  cancellation_reason varchar(1000),
  failure_code varchar(120),
  failure_detail varchar(1000),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_communication_reminders PRIMARY KEY (id),
  CONSTRAINT fk_reminder_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reminder_conversation FOREIGN KEY (conversation_id, organisation_id)
    REFERENCES public.communication_conversations (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reminder_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reminder_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reminder_message FOREIGN KEY (message_id, organisation_id)
    REFERENCES public.communication_messages (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reminder_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reminder_cancelled_by FOREIGN KEY (cancelled_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_reminder_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_reminder_org_idempotency UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT ck_reminder_body CHECK (
    body_text = btrim(body_text) AND char_length(body_text) BETWEEN 1 AND 50000
  ),
  CONSTRAINT ck_reminder_channel_recipient CHECK (
    (channel = 'PORTAL' AND recipient_address IS NULL)
    OR (channel <> 'PORTAL' AND recipient_address IS NOT NULL)
  ),
  CONSTRAINT ck_reminder_cancellation CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL
      AND cancelled_by_user_id IS NOT NULL AND cancellation_reason IS NOT NULL)
    OR status <> 'CANCELLED'
  )
);

CREATE INDEX ix_reminders_due
  ON public.communication_reminders (status, scheduled_for)
  WHERE status = 'SCHEDULED';
CREATE INDEX ix_reminders_org_conversation
  ON public.communication_reminders (
    organisation_id, conversation_id, scheduled_for DESC
  );

CREATE TABLE public.client_notifications (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  access_grant_id uuid NOT NULL,
  user_profile_id uuid NOT NULL,
  matter_id uuid,
  notification_type varchar(120) NOT NULL,
  title varchar(240) NOT NULL,
  body varchar(2000) NOT NULL,
  source_type varchar(120),
  source_id uuid,
  read_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_client_notifications PRIMARY KEY (id),
  CONSTRAINT fk_notification_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_notification_access FOREIGN KEY (access_grant_id, organisation_id)
    REFERENCES public.client_portal_access_grants (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_profile_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_notification_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_notification_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_notification_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_notification_body CHECK (
    body = btrim(body) AND char_length(body) BETWEEN 1 AND 2000
  )
);

CREATE INDEX ix_notifications_user_read_created
  ON public.client_notifications (
    user_profile_id, read_at, created_at DESC
  );

WITH permission_seed(
  permission_key, permission_name, permission_description,
  resource_name, action_name, is_sensitive, requires_mfa
) AS (
  VALUES
    ('communications.read', 'View communications',
      'View authorised client conversations, messages and delivery states.',
      'communications', 'read', true, false),
    ('communications.send', 'Send communications',
      'Send client portal and external communications as an identified human actor.',
      'communications', 'send', true, true),
    ('communications.manage', 'Manage communications',
      'Assign, resolve, archive and administer authorised conversations.',
      'communications', 'manage', true, true),
    ('communications.delivery.read', 'View delivery evidence',
      'View provider delivery, bounce and failure evidence.',
      'communications', 'delivery.read', true, false),
    ('communication_templates.read', 'View communication templates',
      'View approved organisation communication templates.',
      'communication_templates', 'read', true, false),
    ('communication_templates.manage', 'Manage communication templates',
      'Create and publish controlled communication templates.',
      'communication_templates', 'manage', true, true),
    ('communication_reminders.manage', 'Manage communication reminders',
      'Schedule and cancel auditable client reminders.',
      'communication_reminders', 'manage', true, true),
    ('portal_access.read', 'View client portal access',
      'View client portal invitations and access state.',
      'portal_access', 'read', true, false),
    ('portal_access.manage', 'Manage client portal access',
      'Invite clients and suspend or revoke portal access.',
      'portal_access', 'manage', true, true),
    ('portal_updates.publish', 'Publish client progress updates',
      'Publish matter progress information visible to authorised clients.',
      'portal_updates', 'publish', true, true)
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
    'ai_default', 'deny',
    'control_family', 'client-portal-communications'
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
    'communications', 'communication_templates',
    'communication_reminders', 'portal_access', 'portal_updates'
  )
  AND permission_record.is_active
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('solicitor', 'communications.read'),
    ('solicitor', 'communications.send'),
    ('solicitor', 'communications.manage'),
    ('solicitor', 'communications.delivery.read'),
    ('solicitor', 'communication_templates.read'),
    ('solicitor', 'communication_reminders.manage'),
    ('solicitor', 'portal_access.read'),
    ('solicitor', 'portal_access.manage'),
    ('solicitor', 'portal_updates.publish'),
    ('case_manager', 'communications.read'),
    ('case_manager', 'communications.send'),
    ('case_manager', 'communications.manage'),
    ('case_manager', 'communications.delivery.read'),
    ('case_manager', 'communication_templates.read'),
    ('case_manager', 'communication_templates.manage'),
    ('case_manager', 'communication_reminders.manage'),
    ('case_manager', 'portal_access.read'),
    ('case_manager', 'portal_access.manage'),
    ('case_manager', 'portal_updates.publish'),
    ('case_worker', 'communications.read'),
    ('case_worker', 'communications.send'),
    ('case_worker', 'communication_templates.read'),
    ('case_worker', 'portal_access.read'),
    ('case_worker', 'portal_updates.publish'),
    ('compliance_manager', 'communications.read'),
    ('compliance_manager', 'communications.delivery.read'),
    ('compliance_manager', 'communication_templates.read'),
    ('compliance_manager', 'portal_access.read'),
    ('sales_manager', 'communications.read'),
    ('sales_manager', 'communications.send'),
    ('sales_manager', 'communications.manage'),
    ('sales_manager', 'communication_templates.read'),
    ('sales_agent', 'communications.read'),
    ('sales_agent', 'communications.send'),
    ('sales_agent', 'communication_templates.read'),
    ('read_only', 'communications.read'),
    ('read_only', 'communication_templates.read'),
    ('read_only', 'portal_access.read')
)
INSERT INTO public.role_permissions (id, role_id, permission_id, created_at)
SELECT
  pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM role_permission_seed
JOIN public.roles AS role_record ON role_record.key = role_permission_seed.role_key
JOIN public.permissions AS permission_record
  ON permission_record.key = role_permission_seed.permission_key
WHERE role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.is_active
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

GRANT SELECT ON
  public.client_portal_access_grants,
  public.client_portal_matter_grants,
  public.client_portal_invitations,
  public.portal_matter_updates,
  public.communication_conversations,
  public.communication_messages,
  public.communication_attachments,
  public.communication_delivery_events,
  public.communication_templates,
  public.communication_reminders,
  public.client_notifications
TO businessos_policy_reader;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;

CREATE OR REPLACE FUNCTION private.portal_access_allows(
  p_organisation_id uuid,
  p_client_id uuid,
  p_matter_id uuid,
  p_scope text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT private.current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.client_portal_access_grants AS access_record
      WHERE access_record.organisation_id = p_organisation_id
        AND access_record.client_id = p_client_id
        AND access_record.user_profile_id = private.current_user_id()
        AND access_record.status = 'ACTIVE'
        AND access_record.starts_at <= pg_catalog.now()
        AND (
          access_record.expires_at IS NULL
          OR access_record.expires_at > pg_catalog.now()
        )
        AND p_scope = ANY(access_record.scopes)
        AND (
          p_matter_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.client_portal_matter_grants AS matter_grant
            JOIN public.matter_parties AS party
              ON party.organisation_id = matter_grant.organisation_id
             AND party.matter_id = matter_grant.matter_id
             AND party.client_id = access_record.client_id
             AND party.deleted_at IS NULL
            WHERE matter_grant.access_grant_id = access_record.id
              AND matter_grant.organisation_id = access_record.organisation_id
              AND matter_grant.matter_id = p_matter_id
          )
        )
    )
$function$;

CREATE OR REPLACE FUNCTION private.auth_portal_access_allows(
  p_organisation_id uuid,
  p_client_id uuid,
  p_matter_id uuid,
  p_scope text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.client_portal_access_grants AS access_record
      WHERE access_record.organisation_id = p_organisation_id
        AND access_record.client_id = p_client_id
        AND access_record.user_profile_id = auth.uid()
        AND access_record.status = 'ACTIVE'
        AND access_record.starts_at <= pg_catalog.now()
        AND (
          access_record.expires_at IS NULL
          OR access_record.expires_at > pg_catalog.now()
        )
        AND p_scope = ANY(access_record.scopes)
        AND EXISTS (
          SELECT 1
          FROM public.client_portal_matter_grants AS matter_grant
          JOIN public.matter_parties AS party
            ON party.organisation_id = matter_grant.organisation_id
           AND party.matter_id = matter_grant.matter_id
           AND party.client_id = access_record.client_id
           AND party.deleted_at IS NULL
          WHERE matter_grant.access_grant_id = access_record.id
            AND matter_grant.organisation_id = access_record.organisation_id
            AND matter_grant.matter_id = p_matter_id
        )
    )
$function$;

CREATE OR REPLACE FUNCTION private.can_read_communication_conversation(
  p_organisation_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.communication_conversations AS conversation_record
    WHERE conversation_record.id = p_conversation_id
      AND conversation_record.organisation_id = p_organisation_id
      AND conversation_record.deleted_at IS NULL
      AND (
        (
          private.has_organisation_permission(
            p_organisation_id, 'communications.read'
          )
          AND (
            conversation_record.matter_id IS NULL
            OR private.can_read_matter(
              p_organisation_id, conversation_record.matter_id
            )
          )
          AND (
            conversation_record.client_id IS NULL
            OR private.can_read_client(
              p_organisation_id, conversation_record.client_id
            )
          )
        )
        OR (
          conversation_record.channel = 'PORTAL'
          AND conversation_record.client_id IS NOT NULL
          AND conversation_record.matter_id IS NOT NULL
          AND private.portal_access_allows(
            p_organisation_id,
            conversation_record.client_id,
            conversation_record.matter_id,
            'MESSAGES'
          )
        )
      )
  )
$function$;

ALTER FUNCTION private.portal_access_allows(uuid, uuid, uuid, text)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.auth_portal_access_allows(uuid, uuid, uuid, text)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.can_read_communication_conversation(uuid, uuid)
  OWNER TO businessos_policy_reader;

REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;

REVOKE ALL ON FUNCTION private.portal_access_allows(uuid, uuid, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_portal_access_allows(uuid, uuid, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_communication_conversation(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.portal_access_allows(uuid, uuid, uuid, text)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.auth_portal_access_allows(uuid, uuid, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_communication_conversation(uuid, uuid)
  TO businessos_app;

REVOKE ALL PRIVILEGES ON
  public.client_portal_access_grants,
  public.client_portal_matter_grants,
  public.client_portal_invitations,
  public.portal_matter_updates,
  public.communication_conversations,
  public.communication_messages,
  public.communication_attachments,
  public.communication_delivery_events,
  public.communication_templates,
  public.communication_reminders,
  public.client_notifications
FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON TYPE
  public.business_communication_channel,
  public.communication_direction,
  public.communication_actor_type,
  public.communication_conversation_status,
  public.communication_message_status,
  public.communication_delivery_event_type,
  public.communication_template_status,
  public.communication_reminder_status,
  public.portal_access_status,
  public.portal_invitation_status
TO businessos_app, businessos_policy_reader;

GRANT SELECT, INSERT, UPDATE ON
  public.client_portal_access_grants,
  public.client_portal_matter_grants,
  public.client_portal_invitations,
  public.portal_matter_updates,
  public.communication_conversations,
  public.communication_messages,
  public.communication_attachments,
  public.communication_templates,
  public.communication_reminders,
  public.client_notifications
TO businessos_app;
GRANT SELECT, INSERT ON public.communication_delivery_events
  TO businessos_app;

ALTER TABLE public.client_portal_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_matter_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_matter_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.portal_matter_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_matter_updates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_delivery_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_reminders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notifications FORCE ROW LEVEL SECURITY;

-- The non-login policy-reader owns boolean RLS helpers. These policies let
-- those helpers inspect only the tables explicitly granted above while the
-- application role remains subject to the tenant and portal policies below.
CREATE POLICY policy_reader_portal_access
  ON public.client_portal_access_grants
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_portal_matter_grants
  ON public.client_portal_matter_grants
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_portal_invitations
  ON public.client_portal_invitations
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_portal_updates
  ON public.portal_matter_updates
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_conversations
  ON public.communication_conversations
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_messages
  ON public.communication_messages
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_attachments
  ON public.communication_attachments
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_delivery_events
  ON public.communication_delivery_events
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_templates
  ON public.communication_templates
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_reminders
  ON public.communication_reminders
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_notifications
  ON public.client_notifications
  FOR SELECT TO businessos_policy_reader USING (true);

CREATE POLICY portal_access_select ON public.client_portal_access_grants
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'portal_access.read')
    OR (
      user_profile_id = private.current_user_id()
      AND status = 'ACTIVE'
      AND starts_at <= pg_catalog.now()
      AND (expires_at IS NULL OR expires_at > pg_catalog.now())
    )
  );
CREATE POLICY portal_access_insert ON public.client_portal_access_grants
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
    AND granted_by_user_id = private.current_user_id()
    AND private.can_read_client(organisation_id, client_id)
  );
CREATE POLICY portal_access_update ON public.client_portal_access_grants
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
  );

CREATE POLICY portal_matter_grants_select ON public.client_portal_matter_grants
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'portal_access.read')
    OR EXISTS (
      SELECT 1
      FROM public.client_portal_access_grants AS access_record
      WHERE access_record.id = client_portal_matter_grants.access_grant_id
        AND access_record.organisation_id = client_portal_matter_grants.organisation_id
        AND access_record.user_profile_id = private.current_user_id()
        AND access_record.status = 'ACTIVE'
        AND access_record.starts_at <= pg_catalog.now()
        AND (access_record.expires_at IS NULL OR access_record.expires_at > pg_catalog.now())
    )
  );
CREATE POLICY portal_matter_grants_insert ON public.client_portal_matter_grants
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
    AND private.can_read_matter(organisation_id, matter_id)
  );

CREATE POLICY portal_invitations_select ON public.client_portal_invitations
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'portal_access.read')
    AND private.can_read_client(organisation_id, client_id)
  );
CREATE POLICY portal_invitations_insert ON public.client_portal_invitations
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
    AND invited_by_user_id = private.current_user_id()
    AND private.can_read_client(organisation_id, client_id)
  );
CREATE POLICY portal_invitations_update ON public.client_portal_invitations
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_access.manage')
  );

CREATE POLICY portal_updates_select ON public.portal_matter_updates
  FOR SELECT TO businessos_app
  USING (
    (
      private.has_organisation_permission(organisation_id, 'communications.read')
      AND private.can_read_matter(organisation_id, matter_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.matter_parties AS party
      WHERE party.organisation_id = portal_matter_updates.organisation_id
        AND party.matter_id = portal_matter_updates.matter_id
        AND party.deleted_at IS NULL
        AND private.portal_access_allows(
          portal_matter_updates.organisation_id,
          party.client_id,
          portal_matter_updates.matter_id,
          'MATTER_PROGRESS'
        )
    )
  );
CREATE POLICY portal_updates_insert ON public.portal_matter_updates
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_updates.publish')
    AND private.can_update_matter(organisation_id, matter_id)
    AND published_by_user_id = private.current_user_id()
  );
CREATE POLICY portal_updates_update ON public.portal_matter_updates
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'portal_updates.publish')
    AND private.can_update_matter(organisation_id, matter_id)
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'portal_updates.publish')
    AND private.can_update_matter(organisation_id, matter_id)
  );

CREATE POLICY conversations_select ON public.communication_conversations
  FOR SELECT TO businessos_app
  USING (private.can_read_communication_conversation(organisation_id, id));
CREATE POLICY conversations_insert ON public.communication_conversations
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.send')
    AND created_by_user_id = private.current_user_id()
    AND (matter_id IS NULL OR private.can_read_matter(organisation_id, matter_id))
    AND (client_id IS NULL OR private.can_read_client(organisation_id, client_id))
  );
CREATE POLICY conversations_update ON public.communication_conversations
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'communications.manage')
    AND private.can_read_communication_conversation(organisation_id, id)
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.manage')
  );

CREATE POLICY messages_select ON public.communication_messages
  FOR SELECT TO businessos_app
  USING (
    private.can_read_communication_conversation(organisation_id, conversation_id)
    AND (
      private.has_organisation_permission(organisation_id, 'communications.read')
      OR client_visible
    )
  );
CREATE POLICY messages_insert ON public.communication_messages
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.send')
    AND private.can_read_communication_conversation(organisation_id, conversation_id)
    AND actor_type = 'STAFF'
    AND author_user_profile_id = private.current_user_id()
  );
CREATE POLICY messages_update ON public.communication_messages
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'communications.manage')
  )
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.manage')
  );

CREATE POLICY attachments_select ON public.communication_attachments
  FOR SELECT TO businessos_app
  USING (
    EXISTS (
      SELECT 1
      FROM public.communication_messages AS message_record
      WHERE message_record.id = communication_attachments.message_id
        AND message_record.organisation_id = communication_attachments.organisation_id
        AND private.can_read_communication_conversation(
          message_record.organisation_id, message_record.conversation_id
        )
        AND (
          private.has_organisation_permission(
            message_record.organisation_id, 'communications.read'
          )
          OR (communication_attachments.client_visible AND message_record.client_visible)
        )
    )
  );
CREATE POLICY attachments_insert ON public.communication_attachments
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.send')
  );

CREATE POLICY delivery_events_select ON public.communication_delivery_events
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id, 'communications.delivery.read'
    )
  );
CREATE POLICY delivery_events_insert ON public.communication_delivery_events
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.send')
  );

CREATE POLICY templates_select ON public.communication_templates
  FOR SELECT TO businessos_app
  USING (
    deleted_at IS NULL
    AND private.has_organisation_permission(
      organisation_id, 'communication_templates.read'
    )
  );
CREATE POLICY templates_insert ON public.communication_templates
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(
      organisation_id, 'communication_templates.manage'
    )
    AND created_by_user_id = private.current_user_id()
    AND updated_by_user_id = private.current_user_id()
  );
CREATE POLICY templates_update ON public.communication_templates
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id, 'communication_templates.manage'
    )
  )
  WITH CHECK (
    private.has_organisation_permission(
      organisation_id, 'communication_templates.manage'
    )
    AND updated_by_user_id = private.current_user_id()
  );

CREATE POLICY reminders_select ON public.communication_reminders
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id, 'communications.read'
    )
    AND private.can_read_communication_conversation(
      organisation_id, conversation_id
    )
  );
CREATE POLICY reminders_insert ON public.communication_reminders
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(
      organisation_id, 'communication_reminders.manage'
    )
    AND created_by_user_id = private.current_user_id()
  );
CREATE POLICY reminders_update ON public.communication_reminders
  FOR UPDATE TO businessos_app
  USING (
    private.has_organisation_permission(
      organisation_id, 'communication_reminders.manage'
    )
  )
  WITH CHECK (
    private.has_organisation_permission(
      organisation_id, 'communication_reminders.manage'
    )
  );

CREATE POLICY notifications_select ON public.client_notifications
  FOR SELECT TO businessos_app
  USING (
    user_profile_id = private.current_user_id()
    AND private.portal_access_allows(
      organisation_id,
      (
        SELECT access_record.client_id
        FROM public.client_portal_access_grants AS access_record
        WHERE access_record.id = client_notifications.access_grant_id
          AND access_record.organisation_id = client_notifications.organisation_id
      ),
      matter_id,
      'NOTIFICATIONS'
    )
  );
CREATE POLICY notifications_update ON public.client_notifications
  FOR UPDATE TO businessos_app
  USING (user_profile_id = private.current_user_id())
  WITH CHECK (user_profile_id = private.current_user_id());
CREATE POLICY notifications_insert ON public.client_notifications
  FOR INSERT TO businessos_app
  WITH CHECK (
    private.has_organisation_permission(organisation_id, 'communications.send')
    OR private.has_organisation_permission(organisation_id, 'portal_updates.publish')
  );

CREATE OR REPLACE FUNCTION private.reject_communication_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'communication delivery evidence is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END
$function$;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;
ALTER FUNCTION private.reject_communication_evidence_mutation()
  OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.reject_communication_evidence_mutation()
  FROM PUBLIC;

CREATE TRIGGER portal_access_immutable
  BEFORE UPDATE ON public.client_portal_access_grants
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'client_id', 'user_profile_id',
    'granted_by_user_id', 'created_at'
  );
CREATE TRIGGER portal_matter_grants_append_only
  BEFORE UPDATE OR DELETE ON public.client_portal_matter_grants
  FOR EACH ROW EXECUTE FUNCTION private.reject_communication_evidence_mutation();
CREATE TRIGGER portal_invitations_immutable
  BEFORE UPDATE ON public.client_portal_invitations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'client_id', 'email', 'matter_ids',
    'scopes', 'token_hash', 'invited_by_user_id', 'created_at'
  );
CREATE TRIGGER portal_updates_append_only
  BEFORE DELETE ON public.portal_matter_updates
  FOR EACH ROW EXECUTE FUNCTION private.reject_communication_evidence_mutation();
CREATE TRIGGER conversations_immutable
  BEFORE UPDATE ON public.communication_conversations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'matter_id', 'client_id', 'channel',
    'created_by_user_id', 'created_at'
  );
CREATE TRIGGER messages_immutable
  BEFORE UPDATE ON public.communication_messages
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'conversation_id', 'matter_id', 'client_id',
    'channel', 'direction', 'actor_type', 'author_user_profile_id',
    'sender_address', 'recipient_addresses', 'subject', 'body_text',
    'client_visible', 'approval_request_id', 'idempotency_key', 'created_at'
  );
CREATE TRIGGER attachments_append_only
  BEFORE UPDATE OR DELETE ON public.communication_attachments
  FOR EACH ROW EXECUTE FUNCTION private.reject_communication_evidence_mutation();
CREATE TRIGGER delivery_events_append_only
  BEFORE UPDATE OR DELETE ON public.communication_delivery_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_communication_evidence_mutation();
CREATE TRIGGER templates_immutable_identity
  BEFORE UPDATE ON public.communication_templates
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'key', 'version', 'created_by_user_id', 'created_at'
  );
CREATE TRIGGER reminders_immutable_content
  BEFORE UPDATE ON public.communication_reminders
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'conversation_id', 'matter_id', 'client_id',
    'channel', 'recipient_address', 'subject', 'body_text', 'scheduled_for',
    'idempotency_key', 'created_by_user_id', 'created_at'
  );
CREATE TRIGGER notifications_immutable
  BEFORE UPDATE ON public.client_notifications
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'access_grant_id', 'user_profile_id',
    'matter_id', 'notification_type', 'title', 'body', 'source_type',
    'source_id', 'created_at'
  );

COMMENT ON TABLE public.client_portal_access_grants IS
  'Explicit, time-bound and revocable client identity access; never a staff membership.';
COMMENT ON TABLE public.communication_messages IS
  'Unified portal and external communication ledger with durable delivery state.';
COMMENT ON TABLE public.communication_delivery_events IS
  'Append-only provider delivery and failure evidence with payloads capped at 32 KiB.';
COMMENT ON TABLE public.portal_matter_updates IS
  'Human-published client-visible case progress updates; internal notes remain separate.';

COMMIT;
