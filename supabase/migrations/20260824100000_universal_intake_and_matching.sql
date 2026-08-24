-- Gate H: provider-neutral public forms, durable intake evidence and a
-- human-controlled matching queue. External platforms use the existing
-- signed ingress contract; public BusinessOS forms use unguessable IDs,
-- origin controls, bounded payloads, rate limits and server-side validation.

BEGIN;

CREATE TYPE public.intake_form_status AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');
CREATE TYPE public.intake_submission_status AS ENUM (
  'RECEIVED', 'ACCEPTED', 'DUPLICATE', 'QUARANTINED', 'REJECTED'
);
CREATE TYPE public.communication_match_status AS ENUM (
  'UNMATCHED', 'SUGGESTED', 'MATCHED', 'DISMISSED'
);

CREATE TABLE public.intake_forms (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  public_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  key varchar(120) NOT NULL,
  name varchar(180) NOT NULL,
  description varchar(1000),
  status public.intake_form_status NOT NULL DEFAULT 'DRAFT',
  form_schema jsonb NOT NULL,
  privacy_notice_url varchar(2048) NOT NULL,
  privacy_notice_version varchar(80) NOT NULL,
  allowed_origins text[] NOT NULL,
  success_message varchar(500) NOT NULL DEFAULT 'Thank you. Your information has been received securely.',
  submit_button_label varchar(80) NOT NULL DEFAULT 'Submit securely',
  honeypot_field varchar(80) NOT NULL DEFAULT 'company_website',
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_intake_forms PRIMARY KEY (id),
  CONSTRAINT fk_intake_forms_org FOREIGN KEY (organisation_id)
    REFERENCES public.organisations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_intake_forms_connection FOREIGN KEY (connection_id, organisation_id)
    REFERENCES public.integration_connections(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_intake_forms_created_by FOREIGN KEY (created_by_user_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_intake_forms_updated_by FOREIGN KEY (updated_by_user_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_intake_forms_id_org UNIQUE (id, organisation_id),
  CONSTRAINT uq_intake_forms_public_id UNIQUE (public_id),
  CONSTRAINT uq_intake_forms_org_key UNIQUE (organisation_id, key),
  CONSTRAINT ck_intake_forms_key CHECK (key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  CONSTRAINT ck_intake_forms_name CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 2 AND 180
  ),
  CONSTRAINT ck_intake_forms_schema CHECK (
    jsonb_typeof(form_schema) = 'object'
    AND jsonb_typeof(form_schema -> 'fields') = 'array'
    AND jsonb_array_length(form_schema -> 'fields') BETWEEN 1 AND 50
    AND pg_column_size(form_schema) <= 65536
  ),
  CONSTRAINT ck_intake_forms_origins CHECK (cardinality(allowed_origins) BETWEEN 1 AND 50),
  CONSTRAINT ck_intake_forms_version CHECK (version > 0)
);

CREATE TABLE public.intake_submissions (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  form_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_event_id varchar(240) NOT NULL,
  payload_sha256 char(64) NOT NULL,
  status public.intake_submission_status NOT NULL DEFAULT 'RECEIVED',
  enquiry_id uuid,
  rejection_code varchar(120),
  risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  received_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  processed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_intake_submissions PRIMARY KEY (id),
  CONSTRAINT fk_intake_submissions_form FOREIGN KEY (form_id, organisation_id)
    REFERENCES public.intake_forms(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_intake_submissions_connection FOREIGN KEY (connection_id, organisation_id)
    REFERENCES public.integration_connections(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_intake_submissions_enquiry FOREIGN KEY (enquiry_id, organisation_id)
    REFERENCES public.enquiries(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_intake_submissions_form_event UNIQUE (form_id, external_event_id),
  CONSTRAINT uq_intake_submissions_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_intake_submissions_hash CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_intake_submissions_risk CHECK (
    jsonb_typeof(risk_signals) = 'array' AND pg_column_size(risk_signals) <= 8192
  ),
  CONSTRAINT ck_intake_submissions_lifecycle CHECK (
    (status = 'RECEIVED' AND enquiry_id IS NULL AND processed_at IS NULL)
    OR (status IN ('ACCEPTED', 'DUPLICATE') AND enquiry_id IS NOT NULL AND processed_at IS NOT NULL AND rejection_code IS NULL)
    OR (status IN ('QUARANTINED', 'REJECTED') AND enquiry_id IS NULL AND processed_at IS NOT NULL AND rejection_code IS NOT NULL)
  )
);

CREATE TABLE public.communication_match_queue (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  organisation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  status public.communication_match_status NOT NULL DEFAULT 'UNMATCHED',
  sender_identifier varchar(320),
  provider_thread_id varchar(240),
  suggested_client_id uuid,
  suggested_matter_id uuid,
  confidence numeric(5,4),
  matched_client_id uuid,
  matched_matter_id uuid,
  reviewed_by_user_id uuid,
  review_reason varchar(1000),
  reviewed_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz(6) NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pk_communication_match_queue PRIMARY KEY (id),
  CONSTRAINT fk_match_queue_message FOREIGN KEY (message_id, organisation_id)
    REFERENCES public.communication_messages(id, organisation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_match_queue_suggested_client FOREIGN KEY (suggested_client_id, organisation_id)
    REFERENCES public.clients(id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_match_queue_suggested_matter FOREIGN KEY (suggested_matter_id, organisation_id)
    REFERENCES public.matters(id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_match_queue_matched_client FOREIGN KEY (matched_client_id, organisation_id)
    REFERENCES public.clients(id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_match_queue_matched_matter FOREIGN KEY (matched_matter_id, organisation_id)
    REFERENCES public.matters(id, organisation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_match_queue_reviewer FOREIGN KEY (reviewed_by_user_id)
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT uq_match_queue_message UNIQUE (message_id),
  CONSTRAINT uq_match_queue_id_org UNIQUE (id, organisation_id),
  CONSTRAINT ck_match_queue_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CONSTRAINT ck_match_queue_version CHECK (version > 0),
  CONSTRAINT ck_match_queue_review CHECK (
    (status IN ('UNMATCHED', 'SUGGESTED') AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
    OR (status IN ('MATCHED', 'DISMISSED') AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND review_reason IS NOT NULL)
  )
);

CREATE INDEX ix_intake_forms_org_status ON public.intake_forms(organisation_id, status, name);
CREATE INDEX ix_intake_submissions_org_status ON public.intake_submissions(organisation_id, status, received_at DESC);
CREATE INDEX ix_match_queue_org_status ON public.communication_match_queue(organisation_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION private.create_intake_form(
  p_connection_id uuid, p_key text, p_name text, p_description text,
  p_form_schema jsonb, p_privacy_notice_url text,
  p_privacy_notice_version text, p_allowed_origins text[]
)
RETURNS SETOF public.intake_forms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'integration management permission and MFA are required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  INSERT INTO public.intake_forms(
    organisation_id, connection_id, key, name, description, form_schema,
    privacy_notice_url, privacy_notice_version, allowed_origins,
    created_by_user_id, updated_by_user_id
  )
  SELECT v_org, connection.id, lower(btrim(p_key)), btrim(p_name),
    NULLIF(btrim(p_description), ''), p_form_schema, btrim(p_privacy_notice_url),
    btrim(p_privacy_notice_version), COALESCE(p_allowed_origins, '{}'), v_user, v_user
  FROM public.integration_connections AS connection
  WHERE connection.id = p_connection_id
    AND connection.organisation_id = v_org
    AND connection.status = 'ACTIVE'
    AND connection.provider IN ('WORDPRESS', 'GENERIC')
  RETURNING *;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active intake connection is unavailable' USING ERRCODE = 'no_data_found';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION private.set_intake_form_status(
  p_form_id uuid, p_status public.intake_form_status, p_expected_version integer
)
RETURNS SETOF public.intake_forms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'integration management permission and MFA are required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY UPDATE public.intake_forms AS form_record
  SET status = p_status, updated_by_user_id = v_user,
      version = form_record.version + 1, updated_at = pg_catalog.now()
  WHERE form_record.id = p_form_id AND form_record.organisation_id = v_org
    AND form_record.version = p_expected_version
  RETURNING form_record.*;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'intake form changed or is unavailable' USING ERRCODE = 'serialization_failure';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION private.get_public_intake_form(p_public_id uuid)
RETURNS TABLE(
  id uuid, organisation_id uuid, connection_id uuid, public_id uuid,
  name text, description text, form_schema jsonb, privacy_notice_url text,
  privacy_notice_version text, allowed_origins text[], success_message text,
  submit_button_label text, honeypot_field text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  SELECT form_record.id, form_record.organisation_id, form_record.connection_id,
    form_record.public_id, form_record.name::text, form_record.description::text,
    form_record.form_schema, form_record.privacy_notice_url::text,
    form_record.privacy_notice_version::text, form_record.allowed_origins,
    form_record.success_message::text, form_record.submit_button_label::text,
    form_record.honeypot_field::text
  FROM public.intake_forms AS form_record
  JOIN public.integration_connections AS connection
    ON connection.id = form_record.connection_id
   AND connection.organisation_id = form_record.organisation_id
   AND connection.status = 'ACTIVE'
  JOIN public.organisations AS organisation
    ON organisation.id = form_record.organisation_id
   AND organisation.status = 'ACTIVE' AND organisation.deleted_at IS NULL
  WHERE form_record.public_id = p_public_id AND form_record.status = 'ACTIVE'
$function$;

CREATE OR REPLACE FUNCTION private.get_gate_h_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_org uuid := private.current_organisation_id();
BEGIN
  IF v_org IS NULL OR private.current_user_id() IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.read') THEN
    RAISE EXCEPTION 'integration read permission is required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'generatedAt', pg_catalog.now(),
    'forms', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', form_record.id, 'publicId', form_record.public_id,
      'connectionId', form_record.connection_id, 'key', form_record.key,
      'name', form_record.name, 'description', form_record.description,
      'status', form_record.status, 'formSchema', form_record.form_schema,
      'privacyNoticeUrl', form_record.privacy_notice_url,
      'privacyNoticeVersion', form_record.privacy_notice_version,
      'allowedOrigins', form_record.allowed_origins, 'version', form_record.version,
      'createdAt', form_record.created_at, 'updatedAt', form_record.updated_at
    ) ORDER BY form_record.name) FROM public.intake_forms AS form_record
      WHERE form_record.organisation_id = v_org), '[]'::jsonb),
    'submissionCounts', jsonb_build_object(
      'accepted24Hours', (SELECT count(*) FROM public.intake_submissions
        WHERE organisation_id = v_org AND status IN ('ACCEPTED','DUPLICATE')
          AND received_at >= pg_catalog.now() - interval '24 hours'),
      'quarantined', (SELECT count(*) FROM public.intake_submissions
        WHERE organisation_id = v_org AND status = 'QUARANTINED')
    ),
    'unlinkedCommunications', (SELECT count(*) FROM public.communication_match_queue
      WHERE organisation_id = v_org AND status IN ('UNMATCHED','SUGGESTED')),
    'failedDeliveries', (SELECT count(*) FROM public.communication_messages
      WHERE organisation_id = v_org AND status = 'FAILED')
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.record_public_intake_submission(
  p_form_id uuid, p_external_event_id text, p_payload_sha256 text,
  p_enquiry jsonb, p_risk_signals jsonb
)
RETURNS TABLE(
  submission_id uuid, enquiry_id uuid, duplicate boolean, correlation_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_form record;
  v_result record;
  v_submission uuid := pg_catalog.gen_random_uuid();
  v_existing_enquiry uuid;
BEGIN
  SELECT form_record.id, form_record.organisation_id, form_record.connection_id
  INTO v_form
  FROM public.intake_forms AS form_record
  JOIN public.integration_connections AS connection
    ON connection.id = form_record.connection_id
   AND connection.organisation_id = form_record.organisation_id
   AND connection.status = 'ACTIVE'
  WHERE form_record.id = p_form_id AND form_record.status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public intake form is unavailable' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_result FROM private.record_external_enquiry(
    v_form.connection_id, p_external_event_id, 'businessos.form.submitted',
    pg_catalog.now(), p_payload_sha256, p_enquiry
  );

  INSERT INTO public.intake_submissions(
    id, organisation_id, form_id, connection_id, external_event_id,
    payload_sha256, status, enquiry_id, risk_signals, processed_at
  ) VALUES (
    v_submission, v_form.organisation_id, v_form.id, v_form.connection_id,
    p_external_event_id, p_payload_sha256,
    CASE WHEN v_result.duplicate THEN 'DUPLICATE'::public.intake_submission_status
         ELSE 'ACCEPTED'::public.intake_submission_status END,
    v_result.enquiry_id, COALESCE(p_risk_signals, '[]'::jsonb), pg_catalog.now()
  ) ON CONFLICT (form_id, external_event_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT submission.id, submission.enquiry_id
    INTO v_submission, v_existing_enquiry
    FROM public.intake_submissions AS submission
    WHERE submission.form_id = v_form.id
      AND submission.external_event_id = p_external_event_id
      AND submission.payload_sha256 = p_payload_sha256;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'submission identifier payload changed' USING ERRCODE = 'unique_violation';
    END IF;
    v_result.enquiry_id := v_existing_enquiry;
  END IF;

  RETURN QUERY SELECT v_submission, v_result.enquiry_id,
    v_result.duplicate, v_result.correlation_id;
END
$function$;

CREATE OR REPLACE FUNCTION private.quarantine_public_intake_submission(
  p_form_id uuid, p_external_event_id text, p_payload_sha256 text,
  p_rejection_code text, p_risk_signals jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_form record;
  v_submission uuid := pg_catalog.gen_random_uuid();
  v_created boolean := true;
BEGIN
  SELECT form_record.id, form_record.organisation_id, form_record.connection_id
  INTO v_form
  FROM public.intake_forms AS form_record
  JOIN public.integration_connections AS connection
    ON connection.id = form_record.connection_id
   AND connection.organisation_id = form_record.organisation_id
   AND connection.status = 'ACTIVE'
  WHERE form_record.id = p_form_id AND form_record.status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public intake form is unavailable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_rejection_code !~ '^[A-Z0-9_]{3,120}$'
     OR jsonb_typeof(COALESCE(p_risk_signals, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'quarantine evidence is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.intake_submissions(
    id, organisation_id, form_id, connection_id, external_event_id,
    payload_sha256, status, rejection_code, risk_signals, processed_at
  ) VALUES (
    v_submission, v_form.organisation_id, v_form.id, v_form.connection_id,
    btrim(p_external_event_id), p_payload_sha256, 'QUARANTINED',
    p_rejection_code, COALESCE(p_risk_signals, '[]'::jsonb), pg_catalog.now()
  ) ON CONFLICT (form_id, external_event_id) DO NOTHING;

  IF NOT FOUND THEN
    v_created := false;
    SELECT submission.id INTO v_submission
    FROM public.intake_submissions AS submission
    WHERE submission.form_id = v_form.id
      AND submission.external_event_id = p_external_event_id
      AND submission.payload_sha256 = p_payload_sha256;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'submission identifier payload changed' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF v_created THEN
    INSERT INTO public.audit_events(
      id, organisation_id, actor_type, actor_identifier, source, action,
      resource_type, resource_id, outcome, metadata
    ) VALUES (
      pg_catalog.gen_random_uuid(), v_form.organisation_id, 'SERVICE',
      'public-form-abuse-control', 'businessos-public-intake',
      'integration.intake.quarantined', 'intake_submission',
      v_submission::text, 'SUCCESS',
      jsonb_build_object('formId', v_form.id, 'rejectionCode', p_rejection_code,
        'riskSignals', p_risk_signals, 'payloadSha256', p_payload_sha256)
    );
  END IF;
  RETURN v_submission;
END
$function$;

CREATE OR REPLACE FUNCTION private.record_external_communication(
  p_connection_id uuid, p_external_event_id text, p_payload_sha256 text,
  p_channel public.business_communication_channel, p_provider_message_id text,
  p_provider_thread_id text, p_sender text, p_recipients text[],
  p_subject text, p_body text, p_occurred_at timestamptz
)
RETURNS TABLE(
  event_id uuid, conversation_id uuid, message_id uuid,
  queued_for_matching boolean, duplicate boolean, correlation_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_connection record;
  v_event uuid := pg_catalog.gen_random_uuid();
  v_conversation uuid := pg_catalog.gen_random_uuid();
  v_message uuid := pg_catalog.gen_random_uuid();
  v_correlation uuid := pg_catalog.gen_random_uuid();
  v_client uuid;
  v_client_count integer;
  v_existing record;
  v_sender text := lower(btrim(p_sender));
BEGIN
  SELECT * INTO v_connection FROM private.get_integration_ingress_context(p_connection_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration connection is unavailable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_channel NOT IN ('EMAIL','WHATSAPP')
     OR char_length(v_sender) NOT BETWEEN 3 AND 320
     OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 50000
     OR cardinality(p_recipients) NOT BETWEEN 1 AND 20
     OR char_length(btrim(p_provider_message_id)) NOT BETWEEN 3 AND 240 THEN
    RAISE EXCEPTION 'external communication payload is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.integration_events(
    id, organisation_id, connection_id, provider, direction,
    external_event_id, event_type, payload_sha256, correlation_id, occurred_at
  ) VALUES (
    v_event, v_connection.organisation_id, p_connection_id,
    v_connection.provider::public.integration_provider, 'INBOUND',
    btrim(p_external_event_id), lower(p_channel::text) || '.message.received',
    p_payload_sha256, v_correlation, p_occurred_at
  ) ON CONFLICT (connection_id, external_event_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT integration.id, integration.subject_id, integration.correlation_id,
      integration.payload_sha256 INTO v_existing
    FROM public.integration_events AS integration
    WHERE integration.connection_id = p_connection_id
      AND integration.external_event_id = p_external_event_id;
    IF v_existing.payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'event identifier payload changed' USING ERRCODE = 'unique_violation';
    END IF;
    SELECT message_record.conversation_id INTO v_conversation
    FROM public.communication_messages AS message_record
    WHERE message_record.id = v_existing.subject_id;
    RETURN QUERY SELECT v_existing.id, v_conversation, v_existing.subject_id,
      false, true, v_existing.correlation_id;
    RETURN;
  END IF;

  IF p_channel = 'EMAIL' THEN
    SELECT count(*), min(client_record.id) INTO v_client_count, v_client
    FROM public.clients AS client_record
    WHERE client_record.organisation_id = v_connection.organisation_id
      AND client_record.archived_at IS NULL
      AND lower(client_record.email) = v_sender;
  ELSE
    SELECT count(*), min(client_record.id) INTO v_client_count, v_client
    FROM public.clients AS client_record
    WHERE client_record.organisation_id = v_connection.organisation_id
      AND client_record.archived_at IS NULL
      AND regexp_replace(client_record.phone, '[^0-9+]', '', 'g') =
          regexp_replace(v_sender, '[^0-9+]', '', 'g');
  END IF;
  IF v_client_count <> 1 THEN v_client := NULL; END IF;

  SELECT conversation.id INTO v_conversation
  FROM public.communication_conversations AS conversation
  WHERE conversation.organisation_id = v_connection.organisation_id
    AND conversation.channel = p_channel
    AND conversation.external_thread_id = NULLIF(btrim(p_provider_thread_id), '')
    AND conversation.deleted_at IS NULL
  ORDER BY conversation.created_at DESC LIMIT 1;

  IF v_conversation IS NULL THEN
    v_conversation := pg_catalog.gen_random_uuid();
    INSERT INTO public.communication_conversations(
      id, organisation_id, client_id, channel, subject, status,
      external_thread_id, last_message_at
    ) VALUES (
      v_conversation, v_connection.organisation_id, v_client, p_channel,
      left(COALESCE(NULLIF(btrim(p_subject), ''), 'Inbound ' || lower(p_channel::text)), 240),
      'OPEN', NULLIF(btrim(p_provider_thread_id), ''), p_occurred_at
    );
  END IF;

  INSERT INTO public.communication_messages(
    id, organisation_id, conversation_id, client_id, channel, direction,
    actor_type, sender_address, recipient_addresses, subject, body_text,
    status, client_visible, idempotency_key, provider, provider_message_id,
    sent_at, delivered_at, attempts, next_attempt_at
  ) VALUES (
    v_message, v_connection.organisation_id, v_conversation, v_client,
    p_channel, 'INBOUND', CASE WHEN v_client IS NULL THEN 'SYSTEM' ELSE 'CLIENT' END,
    v_sender, COALESCE(p_recipients, '{}'), NULLIF(btrim(p_subject), ''),
    btrim(p_body), 'DELIVERED', true,
    'inbound:' || p_connection_id::text || ':' || p_external_event_id,
    left(lower(v_connection.provider) || ':' || p_connection_id::text, 80),
    btrim(p_provider_message_id),
    p_occurred_at, p_occurred_at, 1, p_occurred_at
  );

  UPDATE public.communication_conversations
  SET last_message_at = p_occurred_at, updated_at = pg_catalog.now()
  WHERE id = v_conversation AND organisation_id = v_connection.organisation_id;

  IF v_client IS NULL THEN
    INSERT INTO public.communication_match_queue(
      organisation_id, message_id, sender_identifier, provider_thread_id
    ) VALUES (
      v_connection.organisation_id, v_message, v_sender,
      NULLIF(btrim(p_provider_thread_id), '')
    );
  END IF;

  UPDATE public.integration_events SET status = 'PROCESSED',
    subject_type = 'COMMUNICATION_MESSAGE', subject_id = v_message,
    processed_at = pg_catalog.now()
  WHERE id = v_event AND organisation_id = v_connection.organisation_id;

  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_identifier, correlation_id,
    source, action, resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_connection.organisation_id, 'SERVICE',
    lower(v_connection.provider) || '-webhook', v_correlation::text,
    'businessos-integration-gateway', 'communication.inbound.received',
    'communication_message', v_message::text, 'SUCCESS',
    jsonb_build_object('connectionId', p_connection_id, 'channel', p_channel,
      'matchedClient', v_client IS NOT NULL, 'payloadSha256', p_payload_sha256)
  );

  RETURN QUERY SELECT v_event, v_conversation, v_message,
    v_client IS NULL, false, v_correlation;
END
$function$;

CREATE OR REPLACE FUNCTION private.resolve_communication_match(
  p_queue_id uuid, p_action text, p_client_id uuid, p_matter_id uuid,
  p_reason text, p_expected_version integer
)
RETURNS SETOF public.communication_match_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_message uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'communications.send') THEN
    RAISE EXCEPTION 'communication permission is required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_action NOT IN ('MATCH','DISMISS') OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 1000
     OR (p_action = 'MATCH' AND p_client_id IS NULL)
     OR (p_action = 'DISMISS' AND (p_client_id IS NOT NULL OR p_matter_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'matching decision is invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action = 'MATCH' AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND organisation_id = v_org AND archived_at IS NULL
  ) THEN RAISE EXCEPTION 'client is unavailable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_matter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.matters WHERE id = p_matter_id AND organisation_id = v_org
      AND client_id = p_client_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'matter is unavailable for client' USING ERRCODE = 'no_data_found'; END IF;

  SELECT queue_record.message_id INTO v_message
  FROM public.communication_match_queue AS queue_record
  WHERE queue_record.id = p_queue_id AND queue_record.organisation_id = v_org
    AND queue_record.status IN ('UNMATCHED','SUGGESTED')
    AND queue_record.version = p_expected_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'matching item changed or is unavailable' USING ERRCODE = 'serialization_failure'; END IF;

  IF p_action = 'MATCH' THEN
    UPDATE public.communication_messages SET client_id = p_client_id,
      matter_id = p_matter_id, updated_at = pg_catalog.now()
    WHERE id = v_message AND organisation_id = v_org;
    UPDATE public.communication_conversations AS conversation
    SET client_id = p_client_id, matter_id = p_matter_id,
      version = conversation.version + 1, updated_at = pg_catalog.now()
    FROM public.communication_messages AS message_record
    WHERE message_record.id = v_message AND message_record.organisation_id = v_org
      AND conversation.id = message_record.conversation_id
      AND conversation.organisation_id = v_org;
  END IF;

  RETURN QUERY UPDATE public.communication_match_queue AS queue_record
  SET status = CASE WHEN p_action = 'MATCH' THEN 'MATCHED'::public.communication_match_status
                    ELSE 'DISMISSED'::public.communication_match_status END,
      matched_client_id = p_client_id, matched_matter_id = p_matter_id,
      reviewed_by_user_id = v_user, review_reason = btrim(p_reason),
      reviewed_at = pg_catalog.now(), version = queue_record.version + 1,
      updated_at = pg_catalog.now()
  WHERE queue_record.id = p_queue_id AND queue_record.organisation_id = v_org
  RETURNING queue_record.*;

  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    CASE WHEN p_action = 'MATCH' THEN 'communication.match.confirmed' ELSE 'communication.match.dismissed' END,
    'communication_match_queue', p_queue_id::text, 'SUCCESS',
    jsonb_build_object('messageId', v_message, 'clientId', p_client_id, 'matterId', p_matter_id)
  );
END
$function$;

ALTER TABLE public.intake_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE public.intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.communication_match_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_match_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY intake_forms_read ON public.intake_forms FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'integrations.read'));
CREATE POLICY intake_submissions_read ON public.intake_submissions FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'integrations.read'));
CREATE POLICY communication_match_queue_read ON public.communication_match_queue FOR SELECT TO businessos_app
  USING (private.has_organisation_permission(organisation_id, 'communications.read'));

REVOKE ALL ON TABLE public.intake_forms, public.intake_submissions,
  public.communication_match_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.intake_forms, public.intake_submissions,
  public.communication_match_queue TO businessos_app;

REVOKE ALL ON FUNCTION private.create_intake_form(uuid,text,text,text,jsonb,text,text,text[]),
  private.set_intake_form_status(uuid,public.intake_form_status,integer),
  private.get_public_intake_form(uuid), private.get_gate_h_dashboard(),
  private.record_public_intake_submission(uuid,text,text,jsonb,jsonb),
  private.quarantine_public_intake_submission(uuid,text,text,text,jsonb),
  private.record_external_communication(uuid,text,text,public.business_communication_channel,text,text,text,text[],text,text,timestamptz),
  private.resolve_communication_match(uuid,text,uuid,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.create_intake_form(uuid,text,text,text,jsonb,text,text,text[]),
  private.set_intake_form_status(uuid,public.intake_form_status,integer),
  private.get_public_intake_form(uuid), private.get_gate_h_dashboard(),
  private.record_public_intake_submission(uuid,text,text,jsonb,jsonb),
  private.quarantine_public_intake_submission(uuid,text,text,text,jsonb),
  private.record_external_communication(uuid,text,text,public.business_communication_channel,text,text,text,text[],text,text,timestamptz),
  private.resolve_communication_match(uuid,text,uuid,uuid,text,integer)
  TO businessos_app;

CREATE TRIGGER intake_forms_immutable_identity BEFORE UPDATE ON public.intake_forms
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id','organisation_id','connection_id','public_id','key','created_by_user_id','created_at'
  );
CREATE TRIGGER intake_submissions_no_update BEFORE UPDATE OR DELETE ON public.intake_submissions
  FOR EACH ROW EXECUTE FUNCTION private.reject_integration_evidence_mutation();

COMMENT ON TABLE public.intake_forms IS
  'Tenant-owned, versioned BusinessOS public form definitions; no executable code or provider secrets.';
COMMENT ON TABLE public.intake_submissions IS
  'Minimal immutable public-form submission evidence; raw form payloads are never retained here.';
COMMENT ON TABLE public.communication_match_queue IS
  'Human-controlled queue for inbound messages that cannot be linked with sufficient confidence.';

COMMIT;
