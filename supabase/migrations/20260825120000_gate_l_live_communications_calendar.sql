-- BusinessOS Gate L: live multi-provider communications and calendar operations.
-- Provider credentials never enter PostgreSQL; only secret-manager references do.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

CREATE TYPE public.provider_connection_state AS ENUM (
  'SETUP_REQUIRED', 'READY', 'DEGRADED', 'DISABLED'
);

CREATE TYPE public.business_calendar_event_status AS ENUM (
  'PENDING_SYNC', 'SCHEDULED', 'CANCELLATION_PENDING', 'CANCELLED',
  'COMPLETED', 'NO_SHOW', 'SYNC_FAILED'
);

ALTER TABLE public.agent_actions
  DROP CONSTRAINT ck_agent_actions_status,
  ADD CONSTRAINT ck_agent_actions_status CHECK (
    (status = 'PROPOSED' AND approval_request_id IS NULL
      AND blocked_reason IS NULL)
    OR (status = 'PENDING_APPROVAL' AND approval_request_id IS NOT NULL
      AND blocked_reason IS NULL)
    OR (status = 'BLOCKED' AND blocked_reason IS NOT NULL)
    OR (status IN ('APPROVED','EXECUTING','EXECUTED')
      AND approval_request_id IS NOT NULL AND blocked_reason IS NULL)
    OR (status = 'FAILED' AND approval_request_id IS NOT NULL
      AND blocked_reason IS NOT NULL)
  );

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
     OR (OLD.status <> 'PROPOSED'
       AND NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id)
     OR NOT (
       (OLD.status = 'PROPOSED' AND NEW.status IN ('PENDING_APPROVAL','BLOCKED'))
       OR (OLD.status = 'PENDING_APPROVAL'
         AND NEW.status IN ('APPROVED','EXECUTED','FAILED','BLOCKED'))
       OR (OLD.status = 'APPROVED'
         AND NEW.status IN ('EXECUTING','EXECUTED','FAILED','BLOCKED'))
       OR (OLD.status = 'EXECUTING' AND NEW.status IN ('EXECUTED','FAILED'))
     )
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid AI action transition'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.communication_conversations
  ADD COLUMN integration_connection_id uuid,
  ADD CONSTRAINT fk_conversation_integration_connection
    FOREIGN KEY (integration_connection_id, organisation_id)
    REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public.communication_messages
  ADD COLUMN integration_connection_id uuid,
  ADD CONSTRAINT fk_message_integration_connection
    FOREIGN KEY (integration_connection_id, organisation_id)
    REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX ix_conversations_org_connection
  ON public.communication_conversations (
    organisation_id, integration_connection_id, last_message_at DESC
  ) WHERE integration_connection_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.provider_connection_configs (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  secret_reference varchar(160) NOT NULL,
  state public.provider_connection_state NOT NULL DEFAULT 'SETUP_REQUIRED',
  capabilities varchar(40)[] NOT NULL DEFAULT ARRAY[]::varchar(40)[],
  mailbox_address varchar(320),
  phone_number varchar(32),
  webhook_public_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  sync_cursor text,
  last_health_checked_at timestamptz(6),
  last_healthy_at timestamptz(6),
  last_sync_at timestamptz(6),
  last_error_code varchar(120),
  last_error_detail varchar(500),
  lease_owner varchar(160),
  lease_expires_at timestamptz(6),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_provider_connection_configs PRIMARY KEY (id),
  CONSTRAINT uq_provider_config_connection UNIQUE (connection_id),
  CONSTRAINT uq_provider_config_webhook_public_id UNIQUE (webhook_public_id),
  CONSTRAINT uq_provider_configs_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_provider_config_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_provider_config_connection FOREIGN KEY (connection_id, organisation_id)
    REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_provider_config_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_provider_config_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_provider_config_secret_reference CHECK (
    secret_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$'
  ),
  CONSTRAINT ck_provider_config_capabilities CHECK (
    cardinality(capabilities) BETWEEN 1 AND 3
    AND capabilities <@ ARRAY['EMAIL','WHATSAPP','CALENDAR']::varchar(40)[]
  ),
  CONSTRAINT ck_provider_config_mailbox CHECK (
    mailbox_address IS NULL OR (
      mailbox_address = lower(btrim(mailbox_address))
      AND mailbox_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  CONSTRAINT ck_provider_config_phone CHECK (
    phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CONSTRAINT ck_provider_config_version CHECK (version > 0),
  CONSTRAINT ck_provider_config_lease CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX ix_provider_configs_org_state
  ON public.provider_connection_configs (organisation_id, state, updated_at DESC);
CREATE INDEX ix_provider_configs_sync_due
  ON public.provider_connection_configs (last_sync_at, updated_at)
  WHERE state IN ('READY','DEGRADED') AND 'EMAIL' = ANY(capabilities);

CREATE TABLE public.business_calendar_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  integration_connection_id uuid NOT NULL,
  client_id uuid,
  matter_id uuid,
  conversation_id uuid,
  title varchar(240) NOT NULL,
  description varchar(4000),
  starts_at timestamptz(6) NOT NULL,
  ends_at timestamptz(6) NOT NULL,
  timezone varchar(80) NOT NULL DEFAULT 'Europe/London',
  location varchar(500),
  attendee_addresses varchar(320)[] NOT NULL DEFAULT ARRAY[]::varchar(320)[],
  status public.business_calendar_event_status NOT NULL DEFAULT 'PENDING_SYNC',
  provider_event_id varchar(512),
  provider_join_url varchar(2048),
  idempotency_key varchar(180) NOT NULL,
  reminder_minutes_before smallint,
  reminder_message_id uuid,
  failure_code varchar(120),
  failure_detail varchar(500),
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_business_calendar_events PRIMARY KEY (id),
  CONSTRAINT uq_calendar_events_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_calendar_events_org_idempotency UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT uq_calendar_events_provider UNIQUE (integration_connection_id, provider_event_id),
  CONSTRAINT fk_calendar_event_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_connection FOREIGN KEY (
    integration_connection_id, organisation_id
  ) REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_client FOREIGN KEY (client_id, organisation_id)
    REFERENCES public.clients (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_matter FOREIGN KEY (matter_id, organisation_id)
    REFERENCES public.matters (id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_conversation FOREIGN KEY (conversation_id, organisation_id)
    REFERENCES public.communication_conversations (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_reminder FOREIGN KEY (reminder_message_id, organisation_id)
    REFERENCES public.communication_messages (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_calendar_event_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_calendar_event_title CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 240
  ),
  CONSTRAINT ck_calendar_event_time CHECK (
    ends_at > starts_at AND ends_at <= starts_at + interval '7 days'
  ),
  CONSTRAINT ck_calendar_event_attendees CHECK (
    cardinality(attendee_addresses) BETWEEN 1 AND 50
  ),
  CONSTRAINT ck_calendar_event_idempotency CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$'
  ),
  CONSTRAINT ck_calendar_event_reminder CHECK (
    reminder_minutes_before IS NULL OR reminder_minutes_before BETWEEN 5 AND 10080
  ),
  CONSTRAINT ck_calendar_event_version CHECK (version > 0)
);

CREATE INDEX ix_calendar_events_org_starts
  ON public.business_calendar_events (organisation_id, starts_at, status);

CREATE TABLE public.provider_webhook_receipts (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider public.integration_provider NOT NULL,
  external_event_id varchar(240) NOT NULL,
  event_type varchar(160) NOT NULL,
  payload_sha256 char(64) NOT NULL,
  status public.integration_event_status NOT NULL DEFAULT 'RECEIVED',
  correlation_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  error_code varchar(120),
  occurred_at timestamptz(6) NOT NULL,
  received_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  processed_at timestamptz(6),
  CONSTRAINT pk_provider_webhook_receipts PRIMARY KEY (id),
  CONSTRAINT uq_provider_webhook_connection_event UNIQUE (connection_id, external_event_id),
  CONSTRAINT fk_provider_webhook_organisation FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_provider_webhook_connection FOREIGN KEY (connection_id, organisation_id)
    REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_provider_webhook_hash CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX ix_provider_webhook_org_status
  ON public.provider_webhook_receipts (organisation_id, status, received_at DESC);

ALTER TABLE public.provider_connection_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_connection_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.business_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_calendar_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.provider_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_webhook_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY provider_configs_read ON public.provider_connection_configs
  FOR SELECT TO businessos_app
  USING (
    private.has_organisation_permission(organisation_id, 'integrations.read')
    OR private.has_organisation_permission(organisation_id, 'communications.read')
  );
CREATE POLICY calendar_events_read ON public.business_calendar_events
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'communications.read'));
CREATE POLICY provider_webhook_receipts_read ON public.provider_webhook_receipts
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'integrations.read'));

REVOKE ALL ON TABLE public.provider_connection_configs,
  public.business_calendar_events, public.provider_webhook_receipts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.provider_connection_configs,
  public.business_calendar_events, public.provider_webhook_receipts
  TO businessos_app;
GRANT USAGE ON TYPE public.provider_connection_state,
  public.business_calendar_event_status TO businessos_app;

CREATE OR REPLACE FUNCTION private.upsert_provider_connection(
  p_connection_id uuid,
  p_provider public.integration_provider,
  p_display_name text,
  p_secret_reference text,
  p_mailbox_address text,
  p_phone_number text,
  p_capabilities text[],
  p_expected_version integer
)
RETURNS TABLE (
  connection_id uuid, provider text, display_name text, state text,
  secret_reference text, mailbox_address text, phone_number text,
  capabilities text[], webhook_public_id uuid, version integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_connection public.integration_connections%ROWTYPE;
  v_config public.provider_connection_configs%ROWTYPE;
  v_capabilities varchar(40)[];
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR NOT private.has_organisation_permission(v_org, 'integrations.manage') THEN
    RAISE EXCEPTION 'integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_provider NOT IN ('MICROSOFT_365','GOOGLE_WORKSPACE','WHATSAPP_BUSINESS')
    OR char_length(btrim(p_display_name)) NOT BETWEEN 2 AND 160
    OR p_secret_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$' THEN
    RAISE EXCEPTION 'provider configuration is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT upper(btrim(value))::varchar(40)
    FROM unnest(COALESCE(p_capabilities, ARRAY[]::text[])) AS supplied(value)
    ORDER BY 1
  ) INTO v_capabilities;

  IF cardinality(v_capabilities) NOT BETWEEN 1 AND 3
    OR NOT v_capabilities <@ ARRAY['EMAIL','WHATSAPP','CALENDAR']::varchar(40)[]
    OR (p_provider = 'WHATSAPP_BUSINESS' AND v_capabilities <> ARRAY['WHATSAPP']::varchar(40)[])
    OR (p_provider <> 'WHATSAPP_BUSINESS' AND 'WHATSAPP' = ANY(v_capabilities))
    OR (p_provider = 'WHATSAPP_BUSINESS' AND COALESCE(p_phone_number, '') !~ '^\+[1-9][0-9]{7,14}$')
    OR (p_provider <> 'WHATSAPP_BUSINESS' AND COALESCE(lower(btrim(p_mailbox_address)), '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'provider capabilities or account address are invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_connection_id IS NULL THEN
    INSERT INTO public.integration_connections (
      organisation_id, provider, display_name, status,
      external_account_reference, created_by_user_id, updated_by_user_id
    ) VALUES (
      v_org, p_provider, btrim(p_display_name), 'ACTIVE',
      CASE WHEN p_provider = 'WHATSAPP_BUSINESS' THEN p_phone_number
           ELSE lower(btrim(p_mailbox_address)) END,
      v_user, v_user
    ) RETURNING * INTO v_connection;
  ELSE
    SELECT * INTO v_connection
    FROM public.integration_connections AS connection_record
    WHERE connection_record.id = p_connection_id
      AND connection_record.organisation_id = v_org
      AND connection_record.provider = p_provider
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider connection is unavailable' USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE public.integration_connections
    SET display_name = btrim(p_display_name),
        external_account_reference = CASE
          WHEN p_provider = 'WHATSAPP_BUSINESS' THEN p_phone_number
          ELSE lower(btrim(p_mailbox_address)) END,
        status = 'ACTIVE', updated_by_user_id = v_user,
        version = version + 1, updated_at = pg_catalog.now()
    WHERE id = v_connection.id RETURNING * INTO v_connection;
  END IF;

  SELECT * INTO v_config FROM public.provider_connection_configs
  WHERE connection_id = v_connection.id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR v_config.version <> p_expected_version THEN
      RAISE EXCEPTION 'provider configuration changed; refresh and retry'
        USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE public.provider_connection_configs
    SET secret_reference = p_secret_reference,
        capabilities = v_capabilities,
        mailbox_address = CASE WHEN p_provider = 'WHATSAPP_BUSINESS' THEN NULL
          ELSE lower(btrim(p_mailbox_address)) END,
        phone_number = CASE WHEN p_provider = 'WHATSAPP_BUSINESS' THEN p_phone_number ELSE NULL END,
        state = 'SETUP_REQUIRED', last_error_code = NULL, last_error_detail = NULL,
        updated_by_user_id = v_user, version = version + 1,
        updated_at = pg_catalog.now()
    WHERE id = v_config.id RETURNING * INTO v_config;
  ELSE
    IF COALESCE(p_expected_version, 0) <> 0 THEN
      RAISE EXCEPTION 'new provider configuration must use version zero'
        USING ERRCODE = 'serialization_failure';
    END IF;
    INSERT INTO public.provider_connection_configs (
      organisation_id, connection_id, secret_reference, capabilities,
      mailbox_address, phone_number, created_by_user_id, updated_by_user_id
    ) VALUES (
      v_org, v_connection.id, p_secret_reference, v_capabilities,
      CASE WHEN p_provider = 'WHATSAPP_BUSINESS' THEN NULL ELSE lower(btrim(p_mailbox_address)) END,
      CASE WHEN p_provider = 'WHATSAPP_BUSINESS' THEN p_phone_number ELSE NULL END,
      v_user, v_user
    ) RETURNING * INTO v_config;
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'provider.connection.configured', 'integration_connection',
    v_connection.id::text, 'SUCCESS',
    jsonb_build_object('provider', p_provider, 'capabilities', v_capabilities,
      'secretReferenceChanged', true)
  );

  RETURN QUERY SELECT v_connection.id, v_connection.provider::text,
    v_connection.display_name::text, v_config.state::text,
    v_config.secret_reference::text, v_config.mailbox_address::text,
    v_config.phone_number::text, v_config.capabilities::text[],
    v_config.webhook_public_id, v_config.version;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_provider_connection_status(
  p_connection_id uuid,
  p_status public.integration_connection_status,
  p_reason text,
  p_expected_version integer
)
RETURNS TABLE (
  connection_id uuid, connection_status text, state text, version integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_config public.provider_connection_configs%ROWTYPE;
  v_connection public.integration_connections%ROWTYPE;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
    OR p_status IS NULL OR p_status NOT IN ('ACTIVE','DISABLED')
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'provider status change is not permitted or invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT config.* INTO v_config
  FROM public.provider_connection_configs AS config
  WHERE config.connection_id = p_connection_id
    AND config.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND OR v_config.version <> p_expected_version THEN
    RAISE EXCEPTION 'provider configuration changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT connection.* INTO v_connection
  FROM public.integration_connections AS connection
  WHERE connection.id = p_connection_id
    AND connection.organisation_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider connection is unavailable'
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.integration_connections
  SET status = p_status, updated_by_user_id = v_user,
      version = version + 1, updated_at = pg_catalog.now()
  WHERE id = v_connection.id
  RETURNING * INTO v_connection;

  UPDATE public.provider_connection_configs
  SET state = CASE WHEN p_status = 'ACTIVE'
      THEN 'SETUP_REQUIRED'::public.provider_connection_state
      ELSE 'DISABLED'::public.provider_connection_state END,
    last_error_code = NULL, last_error_detail = NULL,
    lease_owner = NULL, lease_expires_at = NULL,
    updated_by_user_id = v_user, version = version + 1,
    updated_at = pg_catalog.now()
  WHERE id = v_config.id
  RETURNING * INTO v_config;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'provider.connection.status_changed', 'integration_connection',
    v_connection.id::text, 'SUCCESS',
    jsonb_build_object('status', p_status, 'reason', btrim(p_reason),
      'previousVersion', p_expected_version)
  );

  RETURN QUERY SELECT v_connection.id, v_connection.status::text,
    v_config.state::text, v_config.version;
END;
$function$;

CREATE OR REPLACE FUNCTION private.get_provider_runtime_context(p_connection_id uuid)
RETURNS TABLE (
  organisation_id uuid, connection_id uuid, provider text,
  secret_reference text, capabilities text[], mailbox_address text,
  phone_number text, sync_cursor text, state text, webhook_public_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  SELECT config.organisation_id, config.connection_id, connection.provider::text,
    config.secret_reference::text, config.capabilities::text[],
    config.mailbox_address::text, config.phone_number::text,
    config.sync_cursor, config.state::text, config.webhook_public_id
  FROM public.provider_connection_configs AS config
  JOIN public.integration_connections AS connection
    ON connection.id = config.connection_id
   AND connection.organisation_id = config.organisation_id
  WHERE config.connection_id = p_connection_id
    AND connection.status = 'ACTIVE'
$function$;

CREATE OR REPLACE FUNCTION private.get_provider_webhook_context(p_webhook_public_id uuid)
RETURNS TABLE (
  organisation_id uuid, connection_id uuid, provider text,
  secret_reference text, capabilities text[], mailbox_address text,
  phone_number text, sync_cursor text, state text, webhook_public_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  SELECT * FROM private.get_provider_runtime_context((
    SELECT config.connection_id FROM public.provider_connection_configs AS config
    WHERE config.webhook_public_id = p_webhook_public_id
  ))
$function$;

CREATE OR REPLACE FUNCTION private.record_provider_health(
  p_connection_id uuid, p_healthy boolean, p_error_code text, p_error_detail text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.provider_connection_configs
  SET state = CASE WHEN p_healthy THEN 'READY'::public.provider_connection_state
                   ELSE 'DEGRADED'::public.provider_connection_state END,
      last_health_checked_at = pg_catalog.now(),
      last_healthy_at = CASE WHEN p_healthy THEN pg_catalog.now() ELSE last_healthy_at END,
      last_error_code = CASE WHEN p_healthy THEN NULL ELSE left(btrim(p_error_code), 120) END,
      last_error_detail = CASE WHEN p_healthy THEN NULL ELSE left(btrim(p_error_detail), 500) END,
      lease_owner = NULL, lease_expires_at = NULL,
      updated_at = pg_catalog.now()
  WHERE connection_id = p_connection_id
    AND state <> 'DISABLED'
    AND EXISTS (
      SELECT 1 FROM public.integration_connections AS connection
      WHERE connection.id = p_connection_id AND connection.status = 'ACTIVE'
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'provider connection is unavailable' USING ERRCODE = 'no_data_found'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.claim_provider_sync_job(
  p_worker_id text, p_lease_seconds integer, p_minimum_age_seconds integer
)
RETURNS TABLE (connection_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
    OR p_lease_seconds NOT BETWEEN 30 AND 1800
    OR p_minimum_age_seconds NOT BETWEEN 15 AND 3600 THEN
    RAISE EXCEPTION 'provider sync worker input is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY WITH candidate AS (
    SELECT config.id FROM public.provider_connection_configs AS config
    JOIN public.integration_connections AS connection
      ON connection.id = config.connection_id AND connection.organisation_id = config.organisation_id
    WHERE config.state IN ('READY','DEGRADED') AND 'EMAIL' = ANY(config.capabilities)
      AND connection.status = 'ACTIVE'
      AND (config.lease_expires_at IS NULL OR config.lease_expires_at <= v_now)
      AND COALESCE(config.last_sync_at, '-infinity'::timestamptz)
        <= v_now - make_interval(secs => p_minimum_age_seconds)
    ORDER BY config.last_sync_at NULLS FIRST, config.updated_at
    FOR UPDATE OF config SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE public.provider_connection_configs AS config
    SET lease_owner = p_worker_id,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        updated_at = v_now
    FROM candidate WHERE config.id = candidate.id RETURNING config.connection_id
  ) SELECT claimed.connection_id FROM claimed;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_provider_sync(
  p_connection_id uuid, p_sync_cursor text, p_processed_count integer
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_processed_count NOT BETWEEN 0 AND 1000
    OR p_sync_cursor IS NULL OR char_length(p_sync_cursor) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'provider sync result is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.provider_connection_configs
  SET sync_cursor = p_sync_cursor, last_sync_at = pg_catalog.now(),
      state = 'READY', last_healthy_at = pg_catalog.now(),
      last_error_code = NULL, last_error_detail = NULL,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = pg_catalog.now()
  WHERE connection_id = p_connection_id
    AND state <> 'DISABLED'
    AND EXISTS (
      SELECT 1 FROM public.integration_connections AS connection
      WHERE connection.id = p_connection_id AND connection.status = 'ACTIVE'
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'provider connection is unavailable' USING ERRCODE = 'no_data_found'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.attach_provider_communication(
  p_connection_id uuid, p_conversation_id uuid, p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_org uuid;
BEGIN
  SELECT organisation_id INTO v_org FROM public.provider_connection_configs
  WHERE connection_id = p_connection_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'provider connection is unavailable' USING ERRCODE = 'no_data_found'; END IF;
  UPDATE public.communication_conversations SET integration_connection_id = p_connection_id,
    updated_at = pg_catalog.now() WHERE id = p_conversation_id AND organisation_id = v_org;
  UPDATE public.communication_messages SET integration_connection_id = p_connection_id,
    updated_at = pg_catalog.now() WHERE id = p_message_id AND organisation_id = v_org;
END;
$function$;

CREATE OR REPLACE FUNCTION private.create_staff_communication_message(
  p_conversation_id uuid, p_subject text, p_body_text text,
  p_recipient_addresses text[], p_scheduled_at timestamptz,
  p_idempotency_key text
)
RETURNS TABLE (message_id uuid, message_status text, channel text, created_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_conversation public.communication_conversations%ROWTYPE;
  v_message public.communication_messages%ROWTYPE;
  v_recipient text;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR NOT private.has_organisation_permission(v_org, 'communications.send') THEN
    RAISE EXCEPTION 'communication sending is not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$' THEN
    RAISE EXCEPTION 'a valid idempotency key is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_message FROM public.communication_messages
  WHERE organisation_id = v_org AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_message.author_user_profile_id IS DISTINCT FROM v_user
      OR v_message.conversation_id IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'idempotency key belongs to a different operation' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT v_message.id, v_message.status::text,
      v_message.channel::text, v_message.created_at;
    RETURN;
  END IF;
  SELECT * INTO v_conversation FROM public.communication_conversations
  WHERE id = p_conversation_id AND organisation_id = v_org
    AND deleted_at IS NULL AND status <> 'ARCHIVED' FOR UPDATE;
  IF NOT FOUND OR NOT private.can_read_communication_conversation(v_org, p_conversation_id) THEN
    RAISE EXCEPTION 'communication conversation was not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF char_length(btrim(COALESCE(p_body_text, ''))) NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'message body is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_conversation.channel IN ('EMAIL','WHATSAPP') THEN
    IF cardinality(p_recipient_addresses) NOT BETWEEN 1 AND
      (CASE WHEN v_conversation.channel = 'WHATSAPP' THEN 1 ELSE 20 END) THEN
      RAISE EXCEPTION 'recipient addresses are invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOREACH v_recipient IN ARRAY p_recipient_addresses LOOP
      IF (v_conversation.channel = 'EMAIL' AND lower(btrim(v_recipient)) !~
          '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
        OR (v_conversation.channel = 'WHATSAPP' AND btrim(v_recipient) !~ '^\+[1-9][0-9]{7,14}$') THEN
        RAISE EXCEPTION 'a recipient address is invalid' USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END LOOP;
    IF v_conversation.channel = 'WHATSAPP' AND NOT EXISTS (
      SELECT 1 FROM public.provider_connection_configs AS config
      JOIN public.integration_connections AS connection ON connection.id = config.connection_id
        AND connection.organisation_id = config.organisation_id
      WHERE config.connection_id = v_conversation.integration_connection_id
        AND config.organisation_id = v_org AND config.state IN ('READY','DEGRADED')
        AND connection.provider = 'WHATSAPP_BUSINESS' AND connection.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'an active WhatsApp Business connection is required'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  INSERT INTO public.communication_messages (
    organisation_id, conversation_id, matter_id, client_id,
    integration_connection_id, channel, direction, actor_type,
    author_user_profile_id, recipient_addresses, subject, body_text,
    status, client_visible, idempotency_key, scheduled_at, queued_at,
    delivered_at, next_attempt_at, created_at, updated_at
  ) VALUES (
    v_org, v_conversation.id, v_conversation.matter_id, v_conversation.client_id,
    v_conversation.integration_connection_id, v_conversation.channel, 'OUTBOUND', 'STAFF',
    v_user, CASE WHEN v_conversation.channel = 'PORTAL' THEN ARRAY[]::varchar(320)[]
      ELSE ARRAY(SELECT CASE WHEN v_conversation.channel = 'EMAIL' THEN lower(btrim(value))
        ELSE btrim(value) END FROM unnest(p_recipient_addresses) supplied(value)) END,
    NULLIF(btrim(p_subject), ''), btrim(p_body_text),
    CASE WHEN v_conversation.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
    true, p_idempotency_key, p_scheduled_at,
    CASE WHEN v_conversation.channel <> 'PORTAL' THEN v_now ELSE NULL END,
    CASE WHEN v_conversation.channel = 'PORTAL' THEN v_now ELSE NULL END,
    COALESCE(p_scheduled_at, v_now), v_now, v_now
  ) RETURNING * INTO v_message;
  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, occurred_at, payload
  ) VALUES (v_org, v_message.id,
    CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
    v_now, jsonb_build_object('channel', v_message.channel::text,
      'connectionId', v_message.integration_connection_id));
  UPDATE public.communication_conversations SET status = 'WAITING_ON_CLIENT',
    last_message_at = v_now, resolved_at = NULL, version = version + 1,
    updated_at = v_now WHERE id = v_conversation.id;
  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (pg_catalog.gen_random_uuid(), v_org, 'USER', v_user,
    'businessos-api', 'communication.message.created', 'communication_message',
    v_message.id::text, 'SUCCESS', jsonb_build_object('channel', v_message.channel,
      'conversationId', v_conversation.id, 'connectionId', v_message.integration_connection_id));
  RETURN QUERY SELECT v_message.id, v_message.status::text,
    v_message.channel::text, v_message.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION private.claim_gate_l_delivery_job(
  p_worker_id text, p_lease_seconds integer
)
RETURNS TABLE (
  message_id uuid, organisation_id uuid, channel text, connection_id uuid,
  provider text, secret_reference text, mailbox_address text, phone_number text,
  recipient_addresses text[], subject text, body_text text,
  idempotency_key text, attempt integer, max_attempts integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
    OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'delivery worker lease input is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.communication_messages AS message
  SET status = 'FAILED', failed_at = v_now,
      failure_code = 'PROVIDER_CONNECTION_UNAVAILABLE',
      failure_detail = 'The configured delivery connection is unavailable.',
      lease_owner = NULL, lease_expires_at = NULL, updated_at = v_now
  WHERE message.channel = 'WHATSAPP' AND message.status IN ('QUEUED','SENDING')
    AND NOT EXISTS (
      SELECT 1 FROM public.provider_connection_configs AS config
      JOIN public.integration_connections AS connection ON connection.id = config.connection_id
        AND connection.organisation_id = config.organisation_id
      WHERE config.connection_id = message.integration_connection_id
        AND config.state IN ('READY','DEGRADED') AND connection.status = 'ACTIVE'
    );
  RETURN QUERY WITH candidate AS (
    SELECT message.id FROM public.communication_messages AS message
    LEFT JOIN public.provider_connection_configs AS config
      ON config.connection_id = message.integration_connection_id
    LEFT JOIN public.integration_connections AS connection
      ON connection.id = config.connection_id AND connection.organisation_id = config.organisation_id
    WHERE message.channel IN ('EMAIL','WHATSAPP')
      AND (message.status = 'QUEUED' OR (message.status = 'SENDING' AND message.lease_expires_at <= v_now))
      AND message.next_attempt_at <= v_now
      AND (message.scheduled_at IS NULL OR message.scheduled_at <= v_now)
      AND message.attempts < message.max_attempts
      AND (message.channel = 'EMAIL' AND message.integration_connection_id IS NULL
        OR config.state IN ('READY','DEGRADED') AND connection.status = 'ACTIVE')
    ORDER BY message.next_attempt_at, message.created_at FOR UPDATE OF message SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE public.communication_messages AS message SET status = 'SENDING',
      attempts = message.attempts + 1, lease_owner = p_worker_id,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds), updated_at = v_now
    FROM candidate WHERE message.id = candidate.id RETURNING message.*
  ) SELECT claimed.id, claimed.organisation_id, claimed.channel::text,
      claimed.integration_connection_id, COALESCE(connection.provider::text, 'RESEND'),
      config.secret_reference::text, config.mailbox_address::text, config.phone_number::text,
      claimed.recipient_addresses::text[], claimed.subject::text, claimed.body_text,
      claimed.idempotency_key, claimed.attempts, claimed.max_attempts
    FROM claimed LEFT JOIN public.provider_connection_configs AS config
      ON config.connection_id = claimed.integration_connection_id
    LEFT JOIN public.integration_connections AS connection
      ON connection.id = config.connection_id AND connection.organisation_id = config.organisation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.materialise_due_communication_reminders(
  p_batch_size integer DEFAULT 25
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reminder public.communication_reminders%ROWTYPE;
  v_message public.communication_messages%ROWTYPE;
  v_connection_id uuid;
  v_count integer := 0;
BEGIN
  IF p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'reminder batch size is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.client_portal_invitations SET status = 'EXPIRED', updated_at = v_now
  WHERE status = 'PENDING' AND expires_at <= v_now;
  FOR v_reminder IN
    SELECT reminder.* FROM public.communication_reminders AS reminder
    WHERE reminder.status = 'SCHEDULED' AND reminder.scheduled_for <= v_now
    ORDER BY reminder.scheduled_for, reminder.id FOR UPDATE SKIP LOCKED LIMIT p_batch_size
  LOOP
    SELECT conversation.integration_connection_id INTO v_connection_id
    FROM public.communication_conversations AS conversation
    WHERE conversation.id = v_reminder.conversation_id
      AND conversation.organisation_id = v_reminder.organisation_id;
    INSERT INTO public.communication_messages (
      organisation_id, conversation_id, matter_id, client_id,
      integration_connection_id, channel, direction, actor_type,
      author_user_profile_id, recipient_addresses, subject, body_text,
      status, client_visible, idempotency_key, scheduled_at, queued_at,
      delivered_at, next_attempt_at, created_at, updated_at
    ) VALUES (
      v_reminder.organisation_id, v_reminder.conversation_id,
      v_reminder.matter_id, v_reminder.client_id, v_connection_id,
      v_reminder.channel, 'OUTBOUND', 'STAFF', v_reminder.created_by_user_id,
      CASE WHEN v_reminder.channel = 'PORTAL' THEN ARRAY[]::varchar(320)[]
        ELSE ARRAY[v_reminder.recipient_address]::varchar(320)[] END,
      v_reminder.subject, v_reminder.body_text,
      CASE WHEN v_reminder.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
      true, 'reminder/' || v_reminder.id::text, v_reminder.scheduled_for,
      CASE WHEN v_reminder.channel <> 'PORTAL' THEN v_now ELSE NULL END,
      CASE WHEN v_reminder.channel = 'PORTAL' THEN v_now ELSE NULL END,
      v_now, v_now, v_now
    ) ON CONFLICT (organisation_id, idempotency_key) DO UPDATE
      SET updated_at = EXCLUDED.updated_at RETURNING * INTO v_message;
    UPDATE public.communication_reminders SET
      status = CASE WHEN v_message.channel = 'PORTAL' THEN 'SENT' ELSE 'PROCESSING' END,
      message_id = v_message.id, updated_at = v_now WHERE id = v_reminder.id;
    INSERT INTO public.communication_delivery_events (
      organisation_id, message_id, event_type, occurred_at, payload
    ) VALUES (v_message.organisation_id, v_message.id,
      CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
      v_now, jsonb_build_object('source','REMINDER','reminderId',v_reminder.id,
        'connectionId',v_connection_id)) ON CONFLICT DO NOTHING;
    UPDATE public.communication_conversations SET status = 'WAITING_ON_CLIENT',
      last_message_at = v_now, resolved_at = NULL, version = version + 1,
      updated_at = v_now WHERE id = v_reminder.conversation_id;
    IF v_message.channel = 'PORTAL' THEN
      INSERT INTO public.client_notifications (
        organisation_id, access_grant_id, user_profile_id, matter_id,
        notification_type, title, body, source_type, source_id, created_at
      ) SELECT access.organisation_id, access.id, access.user_profile_id,
        v_message.matter_id, 'REMINDER', COALESCE(v_message.subject,'Reminder'),
        left(v_message.body_text,500), 'COMMUNICATION_MESSAGE', v_message.id, v_now
      FROM public.client_portal_access_grants AS access
      JOIN public.client_portal_matter_grants AS matter_grant
        ON matter_grant.access_grant_id = access.id
       AND matter_grant.organisation_id = access.organisation_id
       AND matter_grant.matter_id = v_message.matter_id
      WHERE access.organisation_id = v_message.organisation_id
        AND access.client_id = v_message.client_id AND access.status = 'ACTIVE'
        AND access.starts_at <= v_now
        AND (access.expires_at IS NULL OR access.expires_at > v_now)
        AND 'NOTIFICATIONS' = ANY(access.scopes);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION private.create_business_calendar_event(
  p_connection_id uuid, p_client_id uuid, p_matter_id uuid, p_conversation_id uuid,
  p_title text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_timezone text, p_location text, p_attendees text[], p_reminder_minutes smallint,
  p_idempotency_key text
)
RETURNS SETOF public.business_calendar_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id(); v_user uuid := private.current_user_id();
  v_event public.business_calendar_events%ROWTYPE; v_address text;
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR NOT private.has_organisation_permission(v_org, 'communications.send') THEN
    RAISE EXCEPTION 'calendar booking is not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT event.* INTO v_event FROM public.business_calendar_events AS event
  WHERE event.organisation_id = v_org AND event.idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN NEXT v_event; RETURN; END IF;
  IF char_length(btrim(COALESCE(p_title,''))) NOT BETWEEN 1 AND 240
    OR p_ends_at <= p_starts_at OR p_ends_at > p_starts_at + interval '7 days'
    OR cardinality(p_attendees) NOT BETWEEN 1 AND 50
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$'
    OR NOT EXISTS (
      SELECT 1 FROM public.provider_connection_configs AS config
      JOIN public.integration_connections AS connection ON connection.id = config.connection_id
        AND connection.organisation_id = config.organisation_id
      WHERE config.connection_id = p_connection_id AND config.organisation_id = v_org
        AND config.state IN ('READY','DEGRADED') AND 'CALENDAR' = ANY(config.capabilities)
        AND connection.provider IN ('MICROSOFT_365','GOOGLE_WORKSPACE')
        AND connection.status = 'ACTIVE'
    ) THEN RAISE EXCEPTION 'calendar booking input or connection is invalid' USING ERRCODE = 'invalid_parameter_value'; END IF;
  FOREACH v_address IN ARRAY p_attendees LOOP
    IF lower(btrim(v_address)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'an attendee email is invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;
  INSERT INTO public.business_calendar_events (
    organisation_id, integration_connection_id, client_id, matter_id, conversation_id,
    title, description, starts_at, ends_at, timezone, location, attendee_addresses,
    idempotency_key, reminder_minutes_before, created_by_user_id, updated_by_user_id
  ) VALUES (v_org, p_connection_id, p_client_id, p_matter_id, p_conversation_id,
    btrim(p_title), NULLIF(btrim(p_description),''), p_starts_at, p_ends_at,
    COALESCE(NULLIF(btrim(p_timezone),''),'Europe/London'), NULLIF(btrim(p_location),''),
    ARRAY(SELECT lower(btrim(value)) FROM unnest(p_attendees) supplied(value)),
    p_idempotency_key, p_reminder_minutes, v_user, v_user) RETURNING * INTO v_event;
  INSERT INTO public.audit_events (id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata)
  VALUES (pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'calendar.event.requested', 'business_calendar_event', v_event.id::text, 'SUCCESS',
    jsonb_build_object('connectionId', p_connection_id, 'startsAt', p_starts_at));
  RETURN NEXT v_event;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_calendar_sync(
  p_event_id uuid, p_provider_event_id text, p_join_url text
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.business_calendar_events SET status = 'SCHEDULED',
    provider_event_id = btrim(p_provider_event_id), provider_join_url = NULLIF(btrim(p_join_url),''),
    failure_code = NULL, failure_detail = NULL, version = version + 1, updated_at = pg_catalog.now()
  WHERE id = p_event_id AND status IN ('PENDING_SYNC','SYNC_FAILED');
  IF NOT FOUND THEN RAISE EXCEPTION 'calendar event cannot be completed' USING ERRCODE = 'object_not_in_prerequisite_state'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fail_calendar_sync(p_event_id uuid, p_code text, p_detail text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.business_calendar_events SET status = 'SYNC_FAILED',
    failure_code = left(btrim(p_code),120), failure_detail = left(btrim(p_detail),500),
    version = version + 1, updated_at = pg_catalog.now()
  WHERE id = p_event_id AND status IN ('PENDING_SYNC','CANCELLATION_PENDING','SYNC_FAILED');
END;
$function$;

CREATE OR REPLACE FUNCTION private.begin_calendar_retry(
  p_event_id uuid, p_expected_version integer
)
RETURNS SETOF public.business_calendar_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_event public.business_calendar_events%ROWTYPE;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
    OR NOT private.has_organisation_permission(v_org,'communications.send') THEN
    RAISE EXCEPTION 'calendar retry is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.business_calendar_events AS event
  SET status = CASE WHEN event.provider_event_id IS NULL
      THEN 'PENDING_SYNC'::public.business_calendar_event_status
      ELSE 'CANCELLATION_PENDING'::public.business_calendar_event_status END,
    failure_code = NULL, failure_detail = NULL, updated_by_user_id = v_user,
    version = event.version + 1, updated_at = pg_catalog.now()
  WHERE event.id = p_event_id AND event.organisation_id = v_org
    AND event.status = 'SYNC_FAILED' AND event.version = p_expected_version
  RETURNING event.* INTO v_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar event changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;
  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'calendar.event.retry_requested', 'business_calendar_event',
    v_event.id::text, 'SUCCESS',
    jsonb_build_object('operation', CASE WHEN v_event.provider_event_id IS NULL
      THEN 'CREATE' ELSE 'CANCEL' END, 'previousVersion', p_expected_version)
  );
  RETURN NEXT v_event;
END;
$function$;

CREATE OR REPLACE FUNCTION private.begin_calendar_cancellation(
  p_event_id uuid, p_reason text, p_expected_version integer
)
RETURNS SETOF public.business_calendar_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_org uuid := private.current_organisation_id(); v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR NOT private.has_organisation_permission(v_org,'communications.send')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'calendar cancellation is not permitted or invalid' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY UPDATE public.business_calendar_events AS event SET status = 'CANCELLATION_PENDING',
    updated_by_user_id = v_user, version = event.version + 1, updated_at = pg_catalog.now()
  WHERE event.id = p_event_id AND event.organisation_id = v_org AND event.status = 'SCHEDULED'
    AND event.version = p_expected_version RETURNING event.*;
  IF NOT FOUND THEN RAISE EXCEPTION 'calendar event changed or is unavailable' USING ERRCODE = 'serialization_failure'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_calendar_cancellation(p_event_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.business_calendar_events SET status = 'CANCELLED', version = version + 1,
    failure_code = NULL, failure_detail = NULL, updated_at = pg_catalog.now()
  WHERE id = p_event_id AND status = 'CANCELLATION_PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'calendar cancellation cannot be completed' USING ERRCODE = 'object_not_in_prerequisite_state'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_calendar_outcome(
  p_event_id uuid, p_status public.business_calendar_event_status,
  p_reason text, p_expected_version integer
)
RETURNS SETOF public.business_calendar_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_org uuid := private.current_organisation_id(); v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL OR NOT private.has_organisation_permission(v_org,'communications.manage')
    OR p_status NOT IN ('COMPLETED','NO_SHOW') OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'calendar outcome is not permitted or invalid' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY UPDATE public.business_calendar_events AS event SET status = p_status,
    updated_by_user_id = v_user, version = event.version + 1, updated_at = pg_catalog.now()
  WHERE event.id = p_event_id AND event.organisation_id = v_org AND event.status = 'SCHEDULED'
    AND event.version = p_expected_version RETURNING event.*;
  IF NOT FOUND THEN RAISE EXCEPTION 'calendar event changed or is unavailable' USING ERRCODE = 'serialization_failure'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_provider_webhook_receipt(
  p_connection_id uuid, p_external_event_id text, p_event_type text,
  p_payload_sha256 text, p_occurred_at timestamptz
)
RETURNS TABLE (receipt_id uuid, duplicate boolean, correlation_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_context record; v_receipt public.provider_webhook_receipts%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM private.get_provider_runtime_context(p_connection_id);
  IF NOT FOUND OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
    OR char_length(btrim(p_external_event_id)) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'provider webhook receipt is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.provider_webhook_receipts (organisation_id, connection_id, provider,
    external_event_id, event_type, payload_sha256, occurred_at)
  VALUES (v_context.organisation_id, p_connection_id, v_context.provider::public.integration_provider,
    btrim(p_external_event_id), left(btrim(p_event_type),160), p_payload_sha256,
    COALESCE(p_occurred_at,pg_catalog.now())) ON CONFLICT (connection_id, external_event_id) DO NOTHING
  RETURNING * INTO v_receipt;
  IF NOT FOUND THEN
    SELECT * INTO v_receipt FROM public.provider_webhook_receipts
    WHERE connection_id = p_connection_id AND external_event_id = btrim(p_external_event_id);
    IF v_receipt.payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'webhook event identifier payload changed' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT v_receipt.id, true, v_receipt.correlation_id; RETURN;
  END IF;
  RETURN QUERY SELECT v_receipt.id, false, v_receipt.correlation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.materialise_approved_ai_draft(p_approval_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_current_org uuid := private.current_organisation_id();
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approval_requests%ROWTYPE;
  v_conversation public.communication_conversations%ROWTYPE;
  v_recipient text;
  v_message_id uuid;
  v_body text;
BEGIN
  SELECT approval.* INTO v_approval FROM public.approval_requests AS approval
  WHERE approval.id = p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_approval.status <> 'APPROVED' THEN RETURN NULL; END IF;
  IF v_current_org IS NULL OR v_current_org <> v_approval.organisation_id THEN
    RAISE EXCEPTION 'approved AI draft is unavailable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT action.* INTO v_action FROM public.agent_actions AS action
  WHERE action.approval_request_id = p_approval_id
    AND action.organisation_id = v_approval.organisation_id
    AND action.tool_key = 'communication.draft'
    AND action.status = 'PENDING_APPROVAL'
  ORDER BY action.created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_body := btrim(v_action.proposed_payload->>'draftText');
  IF char_length(COALESCE(v_body,'')) NOT BETWEEN 1 AND 4000 THEN
    UPDATE public.agent_actions SET status = 'FAILED',
      blocked_reason = 'Approved communication draft contained no usable text.',
      version = version + 1, updated_at = pg_catalog.now() WHERE id = v_action.id;
    RETURN NULL;
  END IF;
  SELECT conversation.* INTO v_conversation
  FROM public.communication_conversations AS conversation
  WHERE conversation.organisation_id = v_action.organisation_id
    AND conversation.channel IN ('EMAIL','WHATSAPP')
    AND conversation.status <> 'ARCHIVED' AND conversation.deleted_at IS NULL
    AND ((v_action.subject_type = 'MATTER' AND conversation.matter_id = v_action.subject_id)
      OR (v_action.subject_type = 'CLIENT' AND conversation.client_id = v_action.subject_id))
  ORDER BY conversation.last_message_at DESC NULLS LAST, conversation.created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.agent_actions SET status = 'BLOCKED',
      blocked_reason = 'No authorised external conversation exists for this approved draft.',
      version = version + 1, updated_at = pg_catalog.now() WHERE id = v_action.id;
    RETURN NULL;
  END IF;
  SELECT message.sender_address INTO v_recipient
  FROM public.communication_messages AS message
  WHERE message.organisation_id = v_action.organisation_id
    AND message.conversation_id = v_conversation.id
    AND message.direction = 'INBOUND' AND message.sender_address IS NOT NULL
  ORDER BY message.created_at DESC LIMIT 1;
  IF v_recipient IS NULL THEN
    UPDATE public.agent_actions SET status = 'BLOCKED',
      blocked_reason = 'The approved draft needs a verified recipient before a human can send it.',
      version = version + 1, updated_at = pg_catalog.now() WHERE id = v_action.id;
    RETURN NULL;
  END IF;
  INSERT INTO public.communication_messages (
    organisation_id, conversation_id, matter_id, client_id,
    integration_connection_id, channel, direction, actor_type,
    author_user_profile_id, recipient_addresses, subject, body_text,
    status, client_visible, approval_request_id, idempotency_key,
    next_attempt_at, created_at, updated_at
  ) VALUES (
    v_action.organisation_id, v_conversation.id, v_conversation.matter_id,
    v_conversation.client_id, v_conversation.integration_connection_id,
    v_conversation.channel, 'OUTBOUND', 'AI_AGENT', v_action.user_profile_id,
    ARRAY[v_recipient]::varchar(320)[], left(v_action.title,500), v_body,
    'DRAFT', true, p_approval_id, 'agent-draft/' || v_action.id::text,
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  ) ON CONFLICT (organisation_id,idempotency_key) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_message_id;
  UPDATE public.agent_actions SET status = 'EXECUTED', blocked_reason = NULL,
    version = version + 1, updated_at = pg_catalog.now() WHERE id = v_action.id;
  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_identifier, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (pg_catalog.gen_random_uuid(), v_action.organisation_id, 'SYSTEM',
    'gate-l-approved-draft-adapter', 'businessos-automation',
    'agent.communication_draft.materialised', 'communication_message',
    v_message_id::text, 'SUCCESS', jsonb_build_object('agentActionId',v_action.id,
      'approvalRequestId',p_approval_id,'conversationId',v_conversation.id,
      'execution','draft-only-human-send-required'));
  RETURN v_message_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_provider_webhook_receipt(
  p_receipt_id uuid, p_status public.integration_event_status, p_error_code text
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.provider_webhook_receipts SET status = p_status,
    error_code = CASE WHEN p_status = 'FAILED' THEN left(btrim(p_error_code),120) ELSE NULL END,
    processed_at = pg_catalog.now() WHERE id = p_receipt_id AND status = 'RECEIVED';
END;
$function$;

REVOKE ALL ON FUNCTION private.upsert_provider_connection(uuid,public.integration_provider,text,text,text,text,text[],integer),
  private.set_provider_connection_status(uuid,public.integration_connection_status,text,integer),
  private.get_provider_runtime_context(uuid), private.get_provider_webhook_context(uuid),
  private.record_provider_health(uuid,boolean,text,text),
  private.claim_provider_sync_job(text,integer,integer),
  private.complete_provider_sync(uuid,text,integer),
  private.attach_provider_communication(uuid,uuid,uuid),
  private.claim_gate_l_delivery_job(text,integer),
  private.create_business_calendar_event(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text,text[],smallint,text),
  private.complete_calendar_sync(uuid,text,text), private.fail_calendar_sync(uuid,text,text),
  private.begin_calendar_retry(uuid,integer),
  private.begin_calendar_cancellation(uuid,text,integer), private.complete_calendar_cancellation(uuid),
  private.set_calendar_outcome(uuid,public.business_calendar_event_status,text,integer),
  private.record_provider_webhook_receipt(uuid,text,text,text,timestamptz),
  private.materialise_approved_ai_draft(uuid),
  private.complete_provider_webhook_receipt(uuid,public.integration_event_status,text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.upsert_provider_connection(uuid,public.integration_provider,text,text,text,text,text[],integer),
  private.set_provider_connection_status(uuid,public.integration_connection_status,text,integer),
  private.get_provider_runtime_context(uuid), private.get_provider_webhook_context(uuid),
  private.record_provider_health(uuid,boolean,text,text),
  private.claim_provider_sync_job(text,integer,integer),
  private.complete_provider_sync(uuid,text,integer),
  private.attach_provider_communication(uuid,uuid,uuid),
  private.claim_gate_l_delivery_job(text,integer),
  private.create_business_calendar_event(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text,text[],smallint,text),
  private.complete_calendar_sync(uuid,text,text), private.fail_calendar_sync(uuid,text,text),
  private.begin_calendar_retry(uuid,integer),
  private.begin_calendar_cancellation(uuid,text,integer), private.complete_calendar_cancellation(uuid),
  private.set_calendar_outcome(uuid,public.business_calendar_event_status,text,integer),
  private.record_provider_webhook_receipt(uuid,text,text,text,timestamptz),
  private.materialise_approved_ai_draft(uuid),
  private.complete_provider_webhook_receipt(uuid,public.integration_event_status,text)
  TO businessos_app;

CREATE TRIGGER provider_configs_immutable_identity
  BEFORE UPDATE ON public.provider_connection_configs FOR EACH ROW
  EXECUTE FUNCTION private.enforce_immutable_columns(
    'id','organisation_id','connection_id','webhook_public_id','created_by_user_id','created_at'
  );
CREATE TRIGGER provider_webhook_receipts_no_update
  BEFORE DELETE ON public.provider_webhook_receipts FOR EACH ROW
  EXECUTE FUNCTION private.reject_integration_evidence_mutation();

COMMENT ON TABLE public.provider_connection_configs IS
  'Tenant provider configuration containing only non-secret settings and a server-side secret-manager reference.';
COMMENT ON TABLE public.business_calendar_events IS
  'Audited BusinessOS appointment state synchronised to an authorised Microsoft or Google calendar.';
COMMENT ON TABLE public.provider_webhook_receipts IS
  'Minimal idempotent provider webhook evidence. Raw provider payloads and credentials are not retained.';

COMMIT;
