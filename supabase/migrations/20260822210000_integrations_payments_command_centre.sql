-- Gate F: signed external intake, Stripe Connect checkout/reconciliation and
-- tenant-isolated management command centre. Raw webhook payloads and provider
-- secrets are deliberately excluded from database persistence.

BEGIN;

CREATE TYPE public.integration_provider AS ENUM (
  'WORDPRESS', 'STRIPE', 'GENERIC'
);
CREATE TYPE public.integration_connection_status AS ENUM (
  'ACTIVE', 'DISABLED'
);
CREATE TYPE public.integration_direction AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE public.integration_event_status AS ENUM (
  'RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'
);
CREATE TYPE public.payment_checkout_status AS ENUM (
  'PENDING_PROVIDER', 'OPEN', 'COMPLETED', 'EXPIRED', 'FAILED'
);

CREATE TABLE public.integration_connections (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  provider public.integration_provider NOT NULL,
  display_name varchar(160) NOT NULL,
  status public.integration_connection_status NOT NULL DEFAULT 'ACTIVE',
  external_account_reference varchar(240),
  secret_version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_integration_connections PRIMARY KEY (id),
  CONSTRAINT fk_integration_connections_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_integration_connections_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_integration_connections_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_integration_connections_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_integration_connections_org_provider_name
    UNIQUE (organisation_id, provider, display_name),
  CONSTRAINT ck_integration_connections_name CHECK (
    display_name = btrim(display_name)
    AND char_length(display_name) BETWEEN 2 AND 160
  ),
  CONSTRAINT ck_integration_connections_secret_version CHECK (secret_version > 0),
  CONSTRAINT ck_integration_connections_version CHECK (version > 0),
  CONSTRAINT ck_integration_connections_external_reference CHECK (
    (provider = 'STRIPE'
      AND external_account_reference IS NOT NULL
      AND external_account_reference ~ '^acct_[A-Za-z0-9]{8,}$')
    OR
    (provider <> 'STRIPE'
      AND (external_account_reference IS NULL
        OR char_length(btrim(external_account_reference)) BETWEEN 1 AND 240))
  )
);

CREATE INDEX ix_integration_connections_org_provider_status
  ON public.integration_connections (organisation_id, provider, status);
CREATE UNIQUE INDEX uq_integration_connections_org_active_stripe
  ON public.integration_connections (organisation_id)
  WHERE provider = 'STRIPE' AND status = 'ACTIVE';
CREATE UNIQUE INDEX uq_integration_connections_active_stripe_account
  ON public.integration_connections (external_account_reference)
  WHERE provider = 'STRIPE' AND status = 'ACTIVE';

CREATE TABLE public.integration_events (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider public.integration_provider NOT NULL,
  direction public.integration_direction NOT NULL,
  external_event_id varchar(240) NOT NULL,
  event_type varchar(160) NOT NULL,
  status public.integration_event_status NOT NULL DEFAULT 'RECEIVED',
  payload_sha256 char(64) NOT NULL,
  correlation_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  subject_type varchar(80),
  subject_id uuid,
  error_code varchar(120),
  occurred_at timestamptz(6) NOT NULL,
  received_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  processed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_integration_events PRIMARY KEY (id),
  CONSTRAINT fk_integration_events_connection FOREIGN KEY (
    connection_id, organisation_id
  ) REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_integration_events_connection_external
    UNIQUE (connection_id, external_event_id),
  CONSTRAINT uq_integration_events_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_integration_events_external_id CHECK (
    external_event_id = btrim(external_event_id)
    AND char_length(external_event_id) BETWEEN 8 AND 240
  ),
  CONSTRAINT ck_integration_events_type CHECK (
    event_type = btrim(event_type)
    AND char_length(event_type) BETWEEN 3 AND 160
  ),
  CONSTRAINT ck_integration_events_hash CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_integration_events_subject CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (subject_type IS NOT NULL AND subject_id IS NOT NULL)
  ),
  CONSTRAINT ck_integration_events_lifecycle CHECK (
    (status = 'RECEIVED' AND processed_at IS NULL AND error_code IS NULL)
    OR (status = 'PROCESSED' AND processed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'IGNORED' AND processed_at IS NOT NULL)
    OR (status = 'FAILED' AND processed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX ix_integration_events_org_status_received
  ON public.integration_events (organisation_id, status, received_at DESC);
CREATE INDEX ix_integration_events_org_correlation
  ON public.integration_events (organisation_id, correlation_id);

CREATE TABLE public.payment_checkout_sessions (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  client_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  status public.payment_checkout_status NOT NULL DEFAULT 'PENDING_PROVIDER',
  amount_minor bigint NOT NULL,
  currency_code char(3) NOT NULL,
  idempotency_key varchar(180) NOT NULL,
  provider_session_id varchar(240),
  provider_payment_intent_id varchar(240),
  checkout_url varchar(2048),
  expires_at timestamptz(6),
  completed_at timestamptz(6),
  failed_at timestamptz(6),
  failure_code varchar(120),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_payment_checkout_sessions PRIMARY KEY (id),
  CONSTRAINT fk_payment_checkouts_connection FOREIGN KEY (
    connection_id, organisation_id
  ) REFERENCES public.integration_connections (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_checkouts_invoice FOREIGN KEY (
    invoice_id, organisation_id
  ) REFERENCES public.finance_documents (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_checkouts_client FOREIGN KEY (
    client_id, organisation_id
  ) REFERENCES public.clients (id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_checkouts_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_payment_checkouts_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_payment_checkouts_org_idempotency
    UNIQUE (organisation_id, idempotency_key),
  CONSTRAINT uq_payment_checkouts_provider_session UNIQUE (provider_session_id),
  CONSTRAINT ck_payment_checkouts_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_payment_checkouts_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_payment_checkouts_idempotency CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$'
  ),
  CONSTRAINT ck_payment_checkouts_version CHECK (version > 0),
  CONSTRAINT ck_payment_checkouts_lifecycle CHECK (
    (status = 'PENDING_PROVIDER'
      AND provider_session_id IS NULL AND checkout_url IS NULL
      AND completed_at IS NULL AND failed_at IS NULL AND failure_code IS NULL)
    OR (status = 'OPEN'
      AND provider_session_id IS NOT NULL AND checkout_url IS NOT NULL
      AND expires_at IS NOT NULL AND completed_at IS NULL
      AND failed_at IS NULL AND failure_code IS NULL)
    OR (status = 'COMPLETED'
      AND provider_session_id IS NOT NULL AND completed_at IS NOT NULL
      AND failed_at IS NULL AND failure_code IS NULL)
    OR (status = 'EXPIRED'
      AND provider_session_id IS NOT NULL AND failed_at IS NOT NULL
      AND failure_code IS NOT NULL)
    OR (status = 'FAILED'
      AND failed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX ix_payment_checkouts_org_invoice_created
  ON public.payment_checkout_sessions (organisation_id, invoice_id, created_at DESC);
CREATE INDEX ix_payment_checkouts_status_expiry
  ON public.payment_checkout_sessions (status, expires_at);

-- Card receipts are not bank deposits until Stripe pays out. Extend the
-- standard chart with a clearing asset so checkout settlement does not
-- overstate the organisation's bank balance.
CREATE OR REPLACE FUNCTION private.provision_finance_defaults(p_organisation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  organisation_record record;
BEGIN
  SELECT organisation.id, organisation.name, organisation.legal_name,
    organisation.country_code
  INTO organisation_record
  FROM public.organisations AS organisation
  WHERE organisation.id = p_organisation_id
    AND organisation.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is unavailable' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.finance_settings (
    organisation_id, legal_name, country_code
  ) VALUES (
    organisation_record.id,
    COALESCE(organisation_record.legal_name, organisation_record.name),
    organisation_record.country_code
  ) ON CONFLICT (organisation_id) DO NOTHING;

  INSERT INTO public.finance_ledger_accounts (
    organisation_id, code, name, account_type, system_key
  ) VALUES
    (p_organisation_id, '1000', 'Bank and cash', 'ASSET', 'BANK'),
    (p_organisation_id, '1100', 'Trade debtors', 'ASSET', 'ACCOUNTS_RECEIVABLE'),
    (p_organisation_id, '2200', 'VAT control', 'LIABILITY', 'VAT_CONTROL'),
    (p_organisation_id, '4000', 'Fee income', 'REVENUE', 'FEE_INCOME')
  ON CONFLICT (organisation_id, code) DO NOTHING;

  INSERT INTO public.finance_ledger_accounts (
    organisation_id, code, name, account_type, system_key
  ) VALUES (
    p_organisation_id, 'STRIPE', 'Stripe clearing', 'ASSET', 'STRIPE_CLEARING'
  ) ON CONFLICT (organisation_id, system_key) DO NOTHING;
END
$function$;

INSERT INTO public.finance_ledger_accounts (
  organisation_id, code, name, account_type, system_key
)
SELECT organisation.id, 'STRIPE', 'Stripe clearing', 'ASSET', 'STRIPE_CLEARING'
FROM public.organisations AS organisation
WHERE organisation.deleted_at IS NULL
ON CONFLICT (organisation_id, system_key) DO NOTHING;

WITH permission_seed(
  permission_key, permission_name, permission_description,
  resource_name, action_name, is_sensitive, requires_mfa
) AS (
  VALUES
    ('integrations.read', 'View integration operations',
      'View configured connectors and minimal delivery or ingestion evidence.',
      'integrations', 'read', true, false),
    ('integrations.manage', 'Manage integration connections',
      'Create, disable and rotate organisation integration connections.',
      'integrations', 'manage', true, true),
    ('command_centre.read', 'View management command centre',
      'View tenant-level operational, service, SLA and financial aggregates.',
      'command_centre', 'read', true, false)
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
    'classification', 'operational-confidential',
    'contains_pii', false,
    'ai_default', 'deny',
    'control_family', 'gate-f-integrations-command-centre'
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
SELECT pg_catalog.gen_random_uuid(), role_record.id, permission_record.id,
  pg_catalog.now()
FROM public.roles AS role_record
CROSS JOIN public.permissions AS permission_record
WHERE role_record.key IN ('organisation_owner', 'system_administrator')
  AND role_record.scope = 'ORGANISATION'
  AND role_record.organisation_id IS NOT NULL
  AND role_record.deleted_at IS NULL
  AND permission_record.resource IN ('integrations', 'command_centre')
  AND permission_record.is_active
  AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_permission_seed(role_key, permission_key) AS (
  VALUES
    ('compliance_manager', 'integrations.read'),
    ('compliance_manager', 'command_centre.read'),
    ('solicitor', 'command_centre.read'),
    ('sales_manager', 'integrations.read'),
    ('sales_manager', 'command_centre.read'),
    ('finance', 'integrations.read'),
    ('finance', 'command_centre.read'),
    ('case_manager', 'integrations.read'),
    ('case_manager', 'command_centre.read')
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
 AND permission_record.is_active
 AND permission_record.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.reject_integration_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'integration evidence is append-only'
    USING ERRCODE = 'insufficient_privilege';
END
$function$;

CREATE OR REPLACE FUNCTION private.create_integration_connection(
  p_provider public.integration_provider,
  p_display_name text,
  p_external_account_reference text
)
RETURNS TABLE (
  id uuid,
  organisation_id uuid,
  provider text,
  display_name text,
  status text,
  external_account_reference text,
  secret_version integer,
  version integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_connection uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.integration_connections (
    id, organisation_id, provider, display_name,
    external_account_reference, created_by_user_id, updated_by_user_id
  ) VALUES (
    v_connection, v_org, p_provider, btrim(p_display_name),
    NULLIF(btrim(p_external_account_reference), ''), v_user, v_user
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'integration.connection.created', 'integration_connection',
    v_connection::text, 'SUCCESS',
    jsonb_build_object('provider', p_provider, 'displayName', btrim(p_display_name))
  );

  RETURN QUERY
  SELECT connection.id, connection.organisation_id,
    connection.provider::text, connection.display_name,
    connection.status::text, connection.external_account_reference,
    connection.secret_version, connection.version, connection.created_at
  FROM public.integration_connections AS connection
  WHERE connection.id = v_connection AND connection.organisation_id = v_org;
END
$function$;

CREATE OR REPLACE FUNCTION private.set_integration_connection_status(
  p_connection_id uuid,
  p_status public.integration_connection_status,
  p_expected_version integer
)
RETURNS TABLE (
  id uuid,
  organisation_id uuid,
  provider text,
  display_name text,
  status text,
  external_account_reference text,
  secret_version integer,
  version integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  UPDATE public.integration_connections AS connection
  SET status = p_status,
      updated_by_user_id = v_user,
      version = connection.version + 1,
      updated_at = pg_catalog.now()
  WHERE connection.id = p_connection_id
    AND connection.organisation_id = v_org
    AND connection.version = p_expected_version
  RETURNING connection.id, connection.organisation_id,
    connection.provider::text, connection.display_name,
    connection.status::text, connection.external_account_reference,
    connection.secret_version, connection.version, connection.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration connection changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'integration.connection.status_changed', 'integration_connection',
    p_connection_id::text, 'SUCCESS', jsonb_build_object('status', p_status)
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.rotate_integration_connection_secret(
  p_connection_id uuid,
  p_expected_version integer
)
RETURNS TABLE (
  id uuid,
  organisation_id uuid,
  provider text,
  display_name text,
  status text,
  secret_version integer,
  version integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  UPDATE public.integration_connections AS connection
  SET secret_version = connection.secret_version + 1,
      updated_by_user_id = v_user,
      version = connection.version + 1,
      updated_at = pg_catalog.now()
  WHERE connection.id = p_connection_id
    AND connection.organisation_id = v_org
    AND connection.provider IN ('WORDPRESS', 'GENERIC')
    AND connection.version = p_expected_version
  RETURNING connection.id, connection.organisation_id,
    connection.provider::text, connection.display_name,
    connection.status::text, connection.secret_version,
    connection.version, connection.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration connection changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'integration.connection.secret_rotated', 'integration_connection',
    p_connection_id::text, 'SUCCESS', '{}'::jsonb
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.get_integration_ingress_context(
  p_connection_id uuid
)
RETURNS TABLE (
  organisation_id uuid,
  provider text,
  display_name text,
  secret_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT connection.organisation_id, connection.provider::text,
    connection.display_name, connection.secret_version
  FROM public.integration_connections AS connection
  JOIN public.organisations AS organisation
    ON organisation.id = connection.organisation_id
   AND organisation.status = 'ACTIVE'
   AND organisation.deleted_at IS NULL
  WHERE connection.id = p_connection_id
    AND connection.status = 'ACTIVE'
    AND connection.provider IN ('WORDPRESS', 'GENERIC')
$function$;

CREATE OR REPLACE FUNCTION private.record_external_enquiry(
  p_connection_id uuid,
  p_external_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload_sha256 text,
  p_enquiry jsonb
)
RETURNS TABLE (
  event_id uuid,
  enquiry_id uuid,
  duplicate boolean,
  correlation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_connection record;
  v_event uuid := pg_catalog.gen_random_uuid();
  v_enquiry uuid := pg_catalog.gen_random_uuid();
  v_correlation uuid := pg_catalog.gen_random_uuid();
  v_existing record;
  v_first_name text := btrim(p_enquiry ->> 'firstName');
  v_last_name text := NULLIF(btrim(p_enquiry ->> 'lastName'), '');
  v_email text := NULLIF(lower(btrim(p_enquiry ->> 'email')), '');
  v_phone text := NULLIF(btrim(p_enquiry ->> 'phone'), '');
  v_country text := NULLIF(btrim(p_enquiry ->> 'country'), '');
  v_service text := NULLIF(btrim(p_enquiry ->> 'serviceType'), '');
  v_message text := NULLIF(btrim(p_enquiry ->> 'message'), '');
  v_priority public."EnquiryPriority" :=
    COALESCE(NULLIF(p_enquiry ->> 'priority', ''), 'NORMAL')::public."EnquiryPriority";
BEGIN
  SELECT * INTO v_connection
  FROM private.get_integration_ingress_context(p_connection_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration connection is unavailable'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_first_name IS NULL OR char_length(v_first_name) NOT BETWEEN 1 AND 100
     OR (v_email IS NULL AND v_phone IS NULL)
     OR (v_email IS NOT NULL AND char_length(v_email) > 320)
     OR (v_phone IS NOT NULL AND char_length(v_phone) > 50)
     OR COALESCE((p_enquiry ->> 'privacyNoticeAcknowledged')::boolean, false) IS NOT TRUE
     OR char_length(COALESCE(p_enquiry ->> 'privacyNoticeVersion', '')) NOT BETWEEN 1 AND 80
     OR (
       COALESCE((p_enquiry ->> 'marketingConsent')::boolean, false)
       AND NULLIF(p_enquiry ->> 'marketingConsentCapturedAt', '') IS NULL
     )
     OR COALESCE(p_enquiry ->> 'lawfulBasis', '') NOT IN (
       'CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST'
     ) THEN
    RAISE EXCEPTION 'external enquiry payload is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.integration_events (
    id, organisation_id, connection_id, provider, direction,
    external_event_id, event_type, payload_sha256, correlation_id,
    occurred_at
  ) VALUES (
    v_event, v_connection.organisation_id, p_connection_id,
    v_connection.provider::public.integration_provider, 'INBOUND',
    btrim(p_external_event_id), btrim(p_event_type), p_payload_sha256,
    v_correlation, p_occurred_at
  ) ON CONFLICT (connection_id, external_event_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT integration.id, integration.subject_id,
      integration.correlation_id, integration.payload_sha256
    INTO v_existing
    FROM public.integration_events AS integration
    WHERE integration.connection_id = p_connection_id
      AND integration.external_event_id = p_external_event_id;

    IF v_existing.payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'event identifier payload does not match prior delivery'
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN QUERY SELECT v_existing.id, v_existing.subject_id, true,
      v_existing.correlation_id;
    RETURN;
  END IF;

  INSERT INTO public.enquiries (
    id, organisation_id, first_name, last_name, email, phone, country,
    service_type, message, source, status, priority, created_at, updated_at
  ) VALUES (
    v_enquiry, v_connection.organisation_id, v_first_name, v_last_name,
    v_email, v_phone, v_country, v_service, v_message,
    left(v_connection.provider::text || ': ' || v_connection.display_name, 100),
    'NEW', v_priority, pg_catalog.now(), pg_catalog.now()
  );

  UPDATE public.integration_events
  SET status = 'PROCESSED', subject_type = 'ENQUIRY', subject_id = v_enquiry,
      processed_at = pg_catalog.now()
  WHERE id = v_event AND organisation_id = v_connection.organisation_id;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_identifier, correlation_id,
    source, action, resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_connection.organisation_id, 'SERVICE',
    lower(v_connection.provider) || '-webhook', v_correlation::text,
    'businessos-integration-gateway', 'integration.enquiry.received',
    'enquiry', v_enquiry::text, 'SUCCESS',
    jsonb_build_object(
      'connectionId', p_connection_id,
      'eventId', p_external_event_id,
      'payloadSha256', p_payload_sha256,
      'lawfulBasis', p_enquiry ->> 'lawfulBasis',
      'privacyNoticeVersion', p_enquiry ->> 'privacyNoticeVersion',
      'marketingConsent', COALESCE((p_enquiry ->> 'marketingConsent')::boolean, false),
      'marketingConsentCapturedAt', p_enquiry ->> 'marketingConsentCapturedAt'
    )
  );

  RETURN QUERY SELECT v_event, v_enquiry, false, v_correlation;
END
$function$;

CREATE OR REPLACE FUNCTION private.get_integrations_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
BEGIN
  IF v_org IS NULL OR private.current_user_id() IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.read') THEN
    RAISE EXCEPTION 'integration read permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'connections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', connection.id,
        'organisationId', connection.organisation_id,
        'provider', connection.provider,
        'displayName', connection.display_name,
        'status', connection.status,
        'externalAccountReference', connection.external_account_reference,
        'secretVersion', connection.secret_version,
        'version', connection.version,
        'createdAt', connection.created_at,
        'updatedAt', connection.updated_at,
        'processed24Hours', (SELECT count(*)
          FROM public.integration_events AS event
          WHERE event.connection_id = connection.id
            AND event.status = 'PROCESSED'
            AND event.received_at >= pg_catalog.now() - interval '24 hours'),
        'failed24Hours', (SELECT count(*)
          FROM public.integration_events AS event
          WHERE event.connection_id = connection.id
            AND event.status = 'FAILED'
            AND event.received_at >= pg_catalog.now() - interval '24 hours'),
        'lastEventAt', (SELECT max(event.received_at)
          FROM public.integration_events AS event
          WHERE event.connection_id = connection.id)
      ) ORDER BY connection.provider, connection.display_name)
      FROM public.integration_connections AS connection
      WHERE connection.organisation_id = v_org
    ), '[]'::jsonb),
    'recentEvents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', event.id,
        'connectionId', event.connection_id,
        'provider', event.provider,
        'direction', event.direction,
        'externalEventId', event.external_event_id,
        'eventType', event.event_type,
        'status', event.status,
        'payloadSha256', event.payload_sha256,
        'correlationId', event.correlation_id,
        'subjectType', event.subject_type,
        'subjectId', event.subject_id,
        'errorCode', event.error_code,
        'occurredAt', event.occurred_at,
        'receivedAt', event.received_at,
        'processedAt', event.processed_at
      ) ORDER BY event.received_at DESC)
      FROM (
        SELECT * FROM public.integration_events
        WHERE organisation_id = v_org
        ORDER BY received_at DESC LIMIT 100
      ) AS event
    ), '[]'::jsonb)
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.prepare_client_portal_checkout(
  p_invoice_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (
  checkout_id uuid,
  organisation_id uuid,
  connection_id uuid,
  stripe_account_id text,
  invoice_id uuid,
  invoice_number text,
  client_id uuid,
  customer_email text,
  amount_minor bigint,
  currency_code text,
  status text,
  checkout_url text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user uuid := private.current_user_id();
  v_invoice record;
  v_connection record;
  v_checkout uuid := pg_catalog.gen_random_uuid();
  v_existing record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authenticated portal context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT document.*, client.email AS customer_email
  INTO v_invoice
  FROM public.finance_documents AS document
  JOIN public.clients AS client
    ON client.id = document.client_id
   AND client.organisation_id = document.organisation_id
  WHERE document.id = p_invoice_id
    AND document.document_type = 'INVOICE'
    AND document.client_visible
    AND document.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    AND document.balance_minor > 0
    AND EXISTS (
      SELECT 1
      FROM public.client_portal_access_grants AS access
      JOIN public.client_portal_matter_grants AS matter_grant
        ON matter_grant.access_grant_id = access.id
       AND matter_grant.organisation_id = access.organisation_id
       AND matter_grant.matter_id = document.matter_id
      WHERE access.organisation_id = document.organisation_id
        AND access.client_id = document.client_id
        AND access.user_profile_id = v_user
        AND access.status = 'ACTIVE'
        AND access.starts_at <= pg_catalog.now()
        AND (access.expires_at IS NULL OR access.expires_at > pg_catalog.now())
        AND 'BILLING' = ANY(access.scopes)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal invoice is unavailable'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_connection
  FROM public.integration_connections AS connection
  WHERE connection.organisation_id = v_invoice.organisation_id
    AND connection.provider = 'STRIPE'
    AND connection.status = 'ACTIVE';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'online payments are not configured'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT checkout.* INTO v_existing
  FROM public.payment_checkout_sessions AS checkout
  WHERE checkout.organisation_id = v_invoice.organisation_id
    AND checkout.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.invoice_id <> p_invoice_id OR v_existing.created_by_user_id <> v_user THEN
      RAISE EXCEPTION 'checkout idempotency key is already in use'
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN QUERY SELECT v_existing.id, v_existing.organisation_id,
      v_existing.connection_id, v_connection.external_account_reference,
      v_existing.invoice_id, v_invoice.document_number, v_existing.client_id,
      v_invoice.customer_email, v_existing.amount_minor,
      v_existing.currency_code::text, v_existing.status::text,
      v_existing.checkout_url::text, v_existing.expires_at;
    RETURN;
  END IF;

  INSERT INTO public.payment_checkout_sessions (
    id, organisation_id, connection_id, invoice_id, client_id,
    created_by_user_id, amount_minor, currency_code, idempotency_key
  ) VALUES (
    v_checkout, v_invoice.organisation_id, v_connection.id, v_invoice.id,
    v_invoice.client_id, v_user, v_invoice.balance_minor,
    v_invoice.currency_code, p_idempotency_key
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_invoice.organisation_id, 'USER', v_user,
    'businessos-client-portal', 'payment.checkout.prepared',
    'payment_checkout_session', v_checkout::text, 'SUCCESS',
    jsonb_build_object('invoiceId', v_invoice.id, 'amountMinor', v_invoice.balance_minor)
  );

  RETURN QUERY SELECT v_checkout, v_invoice.organisation_id, v_connection.id,
    v_connection.external_account_reference, v_invoice.id,
    v_invoice.document_number, v_invoice.client_id, v_invoice.customer_email,
    v_invoice.balance_minor, v_invoice.currency_code::text,
    'PENDING_PROVIDER'::text, NULL::text, NULL::timestamptz;
END
$function$;

CREATE OR REPLACE FUNCTION private.attach_stripe_checkout_session(
  p_checkout_id uuid,
  p_provider_session_id text,
  p_checkout_url text,
  p_expires_at timestamptz
)
RETURNS TABLE (
  checkout_id uuid,
  status text,
  checkout_url text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user uuid := private.current_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authenticated portal context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  UPDATE public.payment_checkout_sessions AS checkout
  SET provider_session_id = p_provider_session_id,
      checkout_url = p_checkout_url,
      expires_at = p_expires_at,
      status = 'OPEN', version = checkout.version + 1,
      updated_at = pg_catalog.now()
  WHERE checkout.id = p_checkout_id
    AND checkout.created_by_user_id = v_user
    AND checkout.status = 'PENDING_PROVIDER'
  RETURNING checkout.id, checkout.status::text,
    checkout.checkout_url::text, checkout.expires_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION private.fail_payment_checkout(
  p_checkout_id uuid,
  p_failure_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user uuid := private.current_user_id();
BEGIN
  UPDATE public.payment_checkout_sessions AS checkout
  SET status = 'FAILED', failed_at = pg_catalog.now(),
      failure_code = left(btrim(p_failure_code), 120),
      version = checkout.version + 1, updated_at = pg_catalog.now()
  WHERE checkout.id = p_checkout_id
    AND checkout.created_by_user_id = v_user
    AND checkout.status = 'PENDING_PROVIDER';
END
$function$;

CREATE OR REPLACE FUNCTION private.process_stripe_checkout_event(
  p_external_event_id text,
  p_event_type text,
  p_stripe_account_id text,
  p_provider_session_id text,
  p_payment_intent_id text,
  p_payment_status text,
  p_amount_total bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_payload_sha256 text
)
RETURNS TABLE (accepted boolean, duplicate boolean, checkout_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_connection record;
  v_checkout record;
  v_event uuid := pg_catalog.gen_random_uuid();
  v_correlation uuid := pg_catalog.gen_random_uuid();
  v_payment uuid := pg_catalog.gen_random_uuid();
  v_journal uuid := pg_catalog.gen_random_uuid();
  v_payment_sequence bigint;
  v_journal_sequence bigint;
  v_payment_number text;
  v_clearing uuid;
  v_ar uuid;
BEGIN
  SELECT * INTO v_connection
  FROM public.integration_connections AS connection
  WHERE connection.provider = 'STRIPE'
    AND connection.status = 'ACTIVE'
    AND connection.external_account_reference = p_stripe_account_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, false, 'IGNORED'::text;
    RETURN;
  END IF;

  INSERT INTO public.integration_events (
    id, organisation_id, connection_id, provider, direction,
    external_event_id, event_type, payload_sha256, correlation_id,
    occurred_at
  ) VALUES (
    v_event, v_connection.organisation_id, v_connection.id, 'STRIPE',
    'INBOUND', p_external_event_id, p_event_type, p_payload_sha256,
    v_correlation, p_occurred_at
  ) ON CONFLICT (connection_id, external_event_id) DO NOTHING;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.integration_events AS event
      WHERE event.connection_id = v_connection.id
        AND event.external_event_id = p_external_event_id
        AND event.payload_sha256 <> p_payload_sha256
    ) THEN
      RAISE EXCEPTION 'event identifier payload does not match prior delivery'
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN QUERY SELECT true, true,
      COALESCE((SELECT checkout.status::text
        FROM public.payment_checkout_sessions AS checkout
        WHERE checkout.provider_session_id = p_provider_session_id), 'IGNORED');
    RETURN;
  END IF;

  SELECT * INTO v_checkout
  FROM public.payment_checkout_sessions AS checkout
  WHERE checkout.connection_id = v_connection.id
    AND checkout.organisation_id = v_connection.organisation_id
    AND checkout.provider_session_id = p_provider_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.integration_events
    SET status = 'IGNORED', error_code = 'CHECKOUT_NOT_FOUND',
        processed_at = pg_catalog.now()
    WHERE id = v_event;
    RETURN QUERY SELECT true, false, 'IGNORED'::text;
    RETURN;
  END IF;

  IF p_event_type IN ('checkout.session.expired', 'checkout.session.async_payment_failed') THEN
    IF v_checkout.status = 'OPEN' THEN
      UPDATE public.payment_checkout_sessions
      SET status = CASE WHEN p_event_type = 'checkout.session.expired'
          THEN 'EXPIRED'::public.payment_checkout_status
          ELSE 'FAILED'::public.payment_checkout_status END,
          provider_payment_intent_id = NULLIF(p_payment_intent_id, ''),
          failed_at = pg_catalog.now(),
          failure_code = CASE WHEN p_event_type = 'checkout.session.expired'
            THEN 'STRIPE_SESSION_EXPIRED' ELSE 'STRIPE_PAYMENT_FAILED' END,
          version = version + 1, updated_at = pg_catalog.now()
      WHERE id = v_checkout.id AND organisation_id = v_checkout.organisation_id;
    END IF;
    UPDATE public.integration_events
    SET status = 'PROCESSED', subject_type = 'PAYMENT_CHECKOUT',
        subject_id = v_checkout.id, processed_at = pg_catalog.now()
    WHERE id = v_event;
    RETURN QUERY SELECT true, false,
      CASE WHEN p_event_type = 'checkout.session.expired' THEN 'EXPIRED' ELSE 'FAILED' END;
    RETURN;
  END IF;

  IF p_event_type NOT IN (
       'checkout.session.completed', 'checkout.session.async_payment_succeeded'
     ) OR p_payment_status <> 'paid' THEN
    UPDATE public.integration_events
    SET status = 'IGNORED', error_code = 'UNSUPPORTED_OR_UNPAID_EVENT',
        subject_type = 'PAYMENT_CHECKOUT', subject_id = v_checkout.id,
        processed_at = pg_catalog.now()
    WHERE id = v_event;
    RETURN QUERY SELECT true, false, v_checkout.status::text;
    RETURN;
  END IF;

  IF v_checkout.status = 'COMPLETED' THEN
    UPDATE public.integration_events
    SET status = 'PROCESSED', subject_type = 'PAYMENT_CHECKOUT',
        subject_id = v_checkout.id, processed_at = pg_catalog.now()
    WHERE id = v_event;
    RETURN QUERY SELECT true, false, 'COMPLETED'::text;
    RETURN;
  END IF;

  IF v_checkout.status <> 'OPEN'
     OR v_checkout.amount_minor <> p_amount_total
     OR lower(v_checkout.currency_code) <> lower(p_currency) THEN
    UPDATE public.integration_events
    SET status = 'FAILED', error_code = 'PAYMENT_EVIDENCE_MISMATCH',
        subject_type = 'PAYMENT_CHECKOUT', subject_id = v_checkout.id,
        processed_at = pg_catalog.now()
    WHERE id = v_event;
    RETURN QUERY SELECT true, false, v_checkout.status::text;
    RETURN;
  END IF;

  PERFORM 1 FROM public.finance_documents AS document
  WHERE document.id = v_checkout.invoice_id
    AND document.organisation_id = v_checkout.organisation_id
    AND document.client_id = v_checkout.client_id
    AND document.document_type = 'INVOICE'
    AND document.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    AND document.balance_minor = v_checkout.amount_minor
    AND document.currency_code = v_checkout.currency_code
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.integration_events
    SET status = 'FAILED', error_code = 'INVOICE_BALANCE_CHANGED',
        subject_type = 'PAYMENT_CHECKOUT', subject_id = v_checkout.id,
        processed_at = pg_catalog.now()
    WHERE id = v_event;
    RETURN QUERY SELECT true, false, v_checkout.status::text;
    RETURN;
  END IF;

  INSERT INTO public.organisation_number_sequences (
    organisation_id, key, next_value
  ) VALUES (v_checkout.organisation_id, 'FINANCE_PAYMENT', 2)
  ON CONFLICT (organisation_id, key) DO UPDATE SET
    next_value = public.organisation_number_sequences.next_value + 1,
    updated_at = pg_catalog.now()
  RETURNING next_value - 1 INTO v_payment_sequence;

  v_payment_number := (
    SELECT payment_prefix FROM public.finance_settings
    WHERE organisation_id = v_checkout.organisation_id
  ) || '-' || pg_catalog.lpad(v_payment_sequence::text, 8, '0');

  INSERT INTO public.finance_payments (
    id, organisation_id, client_id, payment_number, payment_type, method,
    currency_code, amount_minor, occurred_at, reference, provider,
    provider_reference, idempotency_key, recorded_by_user_id
  ) VALUES (
    v_payment, v_checkout.organisation_id, v_checkout.client_id,
    v_payment_number, 'RECEIPT', 'CARD', v_checkout.currency_code,
    v_checkout.amount_minor, p_occurred_at,
    'Stripe payment for checkout ' || v_checkout.id::text,
    'stripe', NULLIF(p_payment_intent_id, ''),
    'stripe/event/' || p_external_event_id, v_checkout.created_by_user_id
  );

  INSERT INTO public.finance_payment_allocations (
    organisation_id, payment_id, document_id, amount_minor
  ) VALUES (
    v_checkout.organisation_id, v_payment, v_checkout.invoice_id,
    v_checkout.amount_minor
  );

  UPDATE public.finance_documents
  SET allocated_minor = allocated_minor + v_checkout.amount_minor,
      balance_minor = 0, status = 'PAID'::public.finance_document_status,
      updated_by_user_id = v_checkout.created_by_user_id,
      version = version + 1, updated_at = pg_catalog.now()
  WHERE id = v_checkout.invoice_id
    AND organisation_id = v_checkout.organisation_id;

  SELECT
    (max(id::text) FILTER (WHERE system_key = 'STRIPE_CLEARING'))::uuid,
    (max(id::text) FILTER (WHERE system_key = 'ACCOUNTS_RECEIVABLE'))::uuid
  INTO v_clearing, v_ar
  FROM public.finance_ledger_accounts
  WHERE organisation_id = v_checkout.organisation_id AND active;

  IF v_clearing IS NULL OR v_ar IS NULL THEN
    RAISE EXCEPTION 'finance ledger defaults are unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO public.organisation_number_sequences (
    organisation_id, key, next_value
  ) VALUES (v_checkout.organisation_id, 'FINANCE_JOURNAL', 2)
  ON CONFLICT (organisation_id, key) DO UPDATE SET
    next_value = public.organisation_number_sequences.next_value + 1,
    updated_at = pg_catalog.now()
  RETURNING next_value - 1 INTO v_journal_sequence;

  INSERT INTO public.finance_journal_entries (
    id, organisation_id, entry_number, source, source_id,
    entry_date, description, posted_by_user_id
  ) VALUES (
    v_journal, v_checkout.organisation_id,
    'JRN-' || pg_catalog.lpad(v_journal_sequence::text, 8, '0'),
    'PAYMENT', v_payment, p_occurred_at::date,
    'Stripe receipt ' || v_payment_number, v_checkout.created_by_user_id
  );

  INSERT INTO public.finance_journal_lines (
    organisation_id, journal_entry_id, account_id, position,
    debit_minor, credit_minor, description
  ) VALUES
    (v_checkout.organisation_id, v_journal, v_clearing, 1,
      v_checkout.amount_minor, 0, v_payment_number),
    (v_checkout.organisation_id, v_journal, v_ar, 2,
      0, v_checkout.amount_minor, v_payment_number);

  UPDATE public.payment_checkout_sessions
  SET status = 'COMPLETED',
      provider_payment_intent_id = NULLIF(p_payment_intent_id, ''),
      checkout_url = NULL, completed_at = pg_catalog.now(),
      version = version + 1, updated_at = pg_catalog.now()
  WHERE id = v_checkout.id AND organisation_id = v_checkout.organisation_id;

  UPDATE public.integration_events
  SET status = 'PROCESSED', subject_type = 'FINANCE_PAYMENT',
      subject_id = v_payment, processed_at = pg_catalog.now()
  WHERE id = v_event;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_identifier, correlation_id,
    source, action, resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_checkout.organisation_id, 'SERVICE',
    'stripe-webhook', v_correlation::text, 'businessos-payment-gateway',
    'finance.payment.settled', 'finance_payment', v_payment::text, 'SUCCESS',
    jsonb_build_object(
      'checkoutId', v_checkout.id,
      'invoiceId', v_checkout.invoice_id,
      'amountMinor', v_checkout.amount_minor,
      'stripeEventId', p_external_event_id,
      'payloadSha256', p_payload_sha256
    )
  );

  RETURN QUERY SELECT true, false, 'COMPLETED'::text;
END
$function$;

CREATE OR REPLACE FUNCTION private.get_command_centre_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
BEGIN
  IF v_org IS NULL OR private.current_user_id() IS NULL
     OR NOT private.has_organisation_permission(v_org, 'command_centre.read') THEN
    RAISE EXCEPTION 'command centre permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'summary', jsonb_build_object(
      'newEnquiries', (SELECT count(*) FROM public.enquiries
        WHERE organisation_id = v_org AND status = 'NEW' AND deleted_at IS NULL),
      'openMatters', (SELECT count(*) FROM public.matters
        WHERE organisation_id = v_org
          AND status NOT IN ('ARCHIVED', 'CANCELLED', 'CLOSED')
          AND deleted_at IS NULL),
      'overdueTasks', (SELECT count(*) FROM public.matter_tasks
        WHERE organisation_id = v_org AND status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
          AND due_at < pg_catalog.now() AND deleted_at IS NULL),
      'criticalDeadlines7Days', (SELECT count(*) FROM public.matter_deadlines
        WHERE organisation_id = v_org AND status = 'OPEN' AND is_critical
          AND due_at <= pg_catalog.now() + interval '7 days'
          AND deleted_at IS NULL),
      'slaAtRisk', (SELECT count(*) FROM public.sla_instances
        WHERE organisation_id = v_org AND status = 'AT_RISK'),
      'slaBreached', (SELECT count(*) FROM public.sla_instances
        WHERE organisation_id = v_org AND status = 'BREACHED'),
      'pendingApprovals', (SELECT count(*) FROM public.approval_requests
        WHERE organisation_id = v_org AND status = 'PENDING'
          AND expires_at > pg_catalog.now()),
      'receivableMinor', COALESCE((SELECT sum(balance_minor)::text
        FROM public.finance_documents WHERE organisation_id = v_org
          AND document_type = 'INVOICE'
          AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')), '0'),
      'overdueInvoices', (SELECT count(*) FROM public.finance_documents
        WHERE organisation_id = v_org AND document_type = 'INVOICE'
          AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
          AND balance_minor > 0 AND due_date < CURRENT_DATE),
      'integrationFailures24Hours', (SELECT count(*) FROM public.integration_events
        WHERE organisation_id = v_org AND status = 'FAILED'
          AND received_at >= pg_catalog.now() - interval '24 hours'),
      'communicationFailures24Hours', (SELECT count(*) FROM public.communication_messages
        WHERE organisation_id = v_org AND status = 'FAILED'
          AND failed_at >= pg_catalog.now() - interval '24 hours'),
      'scannerDeadLetters', (SELECT count(*) FROM public.document_scan_jobs
        WHERE organisation_id = v_org AND status = 'DEAD_LETTER')
    ),
    'urgentWork', COALESCE((
      SELECT jsonb_agg(work ORDER BY (work ->> 'dueAt')::timestamptz)
      FROM (
        SELECT combined.work
        FROM (
        SELECT jsonb_build_object(
          'kind', 'TASK', 'id', task.id, 'matterId', task.matter_id,
          'title', task.title, 'priority', task.priority,
          'dueAt', task.due_at, 'status', task.status
        ) AS work
        FROM public.matter_tasks AS task
        WHERE task.organisation_id = v_org
          AND task.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')
          AND task.due_at IS NOT NULL AND task.deleted_at IS NULL
        UNION ALL
        SELECT jsonb_build_object(
          'kind', 'DEADLINE', 'id', deadline.id, 'matterId', deadline.matter_id,
          'title', deadline.title,
          'priority', CASE WHEN deadline.is_critical THEN 'URGENT' ELSE 'HIGH' END,
          'dueAt', deadline.due_at, 'status', deadline.status
        ) AS work
        FROM public.matter_deadlines AS deadline
        WHERE deadline.organisation_id = v_org AND deadline.status = 'OPEN'
          AND deadline.due_at <= pg_catalog.now() + interval '30 days'
          AND deadline.deleted_at IS NULL
        ) AS combined
        ORDER BY (combined.work ->> 'dueAt')::timestamptz
        LIMIT 30
      ) AS urgent
    ), '[]'::jsonb),
    'serviceHealth', jsonb_build_object(
      'integrations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'provider', connection.provider,
        'name', connection.display_name,
        'status', connection.status,
        'lastEventAt', (SELECT max(event.received_at)
          FROM public.integration_events AS event
          WHERE event.connection_id = connection.id),
        'failed24Hours', (SELECT count(*)
          FROM public.integration_events AS event
          WHERE event.connection_id = connection.id AND event.status = 'FAILED'
            AND event.received_at >= pg_catalog.now() - interval '24 hours')
      ) ORDER BY connection.provider, connection.display_name)
      FROM public.integration_connections AS connection
      WHERE connection.organisation_id = v_org), '[]'::jsonb),
      'automationDeadLetters', (SELECT count(*) FROM public.workflow_runs
        WHERE organisation_id = v_org AND status = 'DEAD_LETTER'),
      'communicationFailures', (SELECT count(*) FROM public.communication_messages
        WHERE organisation_id = v_org AND status = 'FAILED')
    )
  );
END
$function$;

REVOKE ALL ON TABLE public.integration_connections,
  public.integration_events, public.payment_checkout_sessions
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.integration_connections,
  public.integration_events, public.payment_checkout_sessions
  TO businessos_app;

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_checkout_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY integration_connections_select ON public.integration_connections
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'integrations.read'));
CREATE POLICY integration_events_select ON public.integration_events
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'integrations.read'));
CREATE POLICY payment_checkouts_staff_select ON public.payment_checkout_sessions
  FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'finance.read'));

CREATE TRIGGER integration_connections_immutable_identity
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'provider', 'external_account_reference',
    'created_by_user_id', 'created_at'
  );
CREATE TRIGGER integration_events_immutable_identity
  BEFORE UPDATE ON public.integration_events
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'connection_id', 'provider', 'direction',
    'external_event_id', 'event_type', 'payload_sha256', 'correlation_id',
    'occurred_at', 'received_at', 'created_at'
  );
CREATE TRIGGER integration_events_no_delete
  BEFORE DELETE ON public.integration_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_integration_evidence_mutation();
CREATE TRIGGER payment_checkouts_immutable_identity
  BEFORE UPDATE ON public.payment_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'connection_id', 'invoice_id', 'client_id',
    'created_by_user_id', 'amount_minor', 'currency_code', 'idempotency_key',
    'created_at'
  );

REVOKE ALL ON FUNCTION private.reject_integration_evidence_mutation(),
  private.create_integration_connection(public.integration_provider, text, text),
  private.set_integration_connection_status(uuid, public.integration_connection_status, integer),
  private.rotate_integration_connection_secret(uuid, integer),
  private.get_integration_ingress_context(uuid),
  private.record_external_enquiry(uuid, text, text, timestamptz, text, jsonb),
  private.get_integrations_dashboard(),
  private.prepare_client_portal_checkout(uuid, text),
  private.attach_stripe_checkout_session(uuid, text, text, timestamptz),
  private.fail_payment_checkout(uuid, text),
  private.process_stripe_checkout_event(text, text, text, text, text, text, bigint, text, timestamptz, text),
  private.get_command_centre_dashboard()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  private.create_integration_connection(public.integration_provider, text, text),
  private.set_integration_connection_status(uuid, public.integration_connection_status, integer),
  private.rotate_integration_connection_secret(uuid, integer),
  private.get_integration_ingress_context(uuid),
  private.record_external_enquiry(uuid, text, text, timestamptz, text, jsonb),
  private.get_integrations_dashboard(),
  private.prepare_client_portal_checkout(uuid, text),
  private.attach_stripe_checkout_session(uuid, text, text, timestamptz),
  private.fail_payment_checkout(uuid, text),
  private.process_stripe_checkout_event(text, text, text, text, text, text, bigint, text, timestamptz, text),
  private.get_command_centre_dashboard()
  TO businessos_app;

COMMENT ON TABLE public.integration_events IS
  'Minimal immutable provider-event evidence: identifiers, state and SHA-256 only; never raw webhook payloads.';
COMMENT ON TABLE public.payment_checkout_sessions IS
  'Tenant-bound Stripe Checkout lifecycle evidence; BusinessOS never receives card data.';
COMMENT ON FUNCTION private.record_external_enquiry(uuid, text, text, timestamptz, text, jsonb) IS
  'Idempotently converts a verified external intake event into a tenant enquiry without persisting the raw payload.';
COMMENT ON FUNCTION private.process_stripe_checkout_event(text, text, text, text, text, text, bigint, text, timestamptz, text) IS
  'Idempotently validates Stripe settlement evidence and atomically posts the receipt, allocation and balanced journal.';

COMMIT;
