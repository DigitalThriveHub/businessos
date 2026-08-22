-- BusinessOS Gate D: atomic portal, messaging and delivery operations.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

CREATE OR REPLACE FUNCTION private.validate_client_portal_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_valid_matter_count bigint;
  v_distinct_matter_count bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'new portal invitations must start pending'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    SELECT
      pg_catalog.count(DISTINCT matter_record.id),
      pg_catalog.count(DISTINCT supplied_matter.id)
    INTO v_valid_matter_count, v_distinct_matter_count
    FROM pg_catalog.unnest(NEW.matter_ids) AS supplied_matter(id)
    LEFT JOIN public.matters AS matter_record
      ON matter_record.id = supplied_matter.id
     AND matter_record.organisation_id = NEW.organisation_id
     AND matter_record.deleted_at IS NULL
    LEFT JOIN public.matter_parties AS party
      ON party.organisation_id = NEW.organisation_id
     AND party.matter_id = supplied_matter.id
     AND party.client_id = NEW.client_id
     AND party.deleted_at IS NULL
    WHERE matter_record.id IS NOT NULL AND party.id IS NOT NULL;

    SELECT pg_catalog.count(DISTINCT supplied_matter.id)
    INTO v_distinct_matter_count
    FROM pg_catalog.unnest(NEW.matter_ids) AS supplied_matter(id);

    IF v_valid_matter_count <> v_distinct_matter_count
      OR v_distinct_matter_count <> cardinality(NEW.matter_ids) THEN
      RAISE EXCEPTION 'portal invitation matters must be distinct authorised client matters'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.client_portal_access_grants AS access_record
      JOIN public.user_profiles AS profile_record
        ON profile_record.id = access_record.user_profile_id
       AND profile_record.status = 'ACTIVE'
       AND profile_record.deleted_at IS NULL
      WHERE access_record.organisation_id = NEW.organisation_id
        AND access_record.client_id = NEW.client_id
        AND access_record.status = 'ACTIVE'
        AND access_record.starts_at <= pg_catalog.now()
        AND (access_record.expires_at IS NULL
          OR access_record.expires_at > pg_catalog.now())
        AND pg_catalog.lower(pg_catalog.btrim(profile_record.email)) = NEW.email
    ) THEN
      RAISE EXCEPTION 'active portal access already exists for this client identity'
        USING ERRCODE = 'unique_violation';
    END IF;
  ELSE
    IF OLD.status IN ('ACCEPTED', 'REVOKED', 'EXPIRED')
      AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal portal invitation status cannot change'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$function$;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;
ALTER FUNCTION private.validate_client_portal_invitation()
  OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.validate_client_portal_invitation()
  FROM PUBLIC;

CREATE TRIGGER portal_invitations_validate
  BEFORE INSERT OR UPDATE ON public.client_portal_invitations
  FOR EACH ROW EXECUTE FUNCTION private.validate_client_portal_invitation();

CREATE OR REPLACE FUNCTION private.validate_communication_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.channel = 'PORTAL'
    AND (NEW.matter_id IS NULL OR NEW.client_id IS NULL) THEN
    RAISE EXCEPTION 'portal conversations require a client and matter'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.matter_id IS NOT NULL AND NEW.client_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.matter_parties AS party
      WHERE party.organisation_id = NEW.organisation_id
        AND party.matter_id = NEW.matter_id
        AND party.client_id = NEW.client_id
        AND party.deleted_at IS NULL
    ) THEN
    RAISE EXCEPTION 'conversation client must be a party to the matter'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END
$function$;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;
ALTER FUNCTION private.validate_communication_conversation()
  OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.validate_communication_conversation()
  FROM PUBLIC;

CREATE TRIGGER communication_conversations_validate
  BEFORE INSERT OR UPDATE OF organisation_id, matter_id, client_id, channel
  ON public.communication_conversations
  FOR EACH ROW EXECUTE FUNCTION private.validate_communication_conversation();

CREATE OR REPLACE FUNCTION private.accept_client_portal_invitation(
  p_token_hash text
)
RETURNS TABLE (
  invitation_id uuid,
  access_grant_id uuid,
  organisation_id uuid,
  organisation_name text,
  client_id uuid,
  client_name text,
  matter_ids uuid[],
  scopes text[],
  invitation_status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_auth_email text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_invitation public.client_portal_invitations%ROWTYPE;
  v_organisation public.organisations%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_access public.client_portal_access_grants%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_valid_matter_count bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'portal invitation token hash is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  INTO v_auth_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_user_id
    AND auth_user.email IS NOT NULL
    AND pg_catalog.btrim(auth_user.email) <> ''
    AND auth_user.email_confirmed_at IS NOT NULL;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'a verified email identity is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT invitation_record.*
  INTO v_invitation
  FROM public.client_portal_invitations AS invitation_record
  WHERE invitation_record.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.status <> 'PENDING'
    OR v_invitation.expires_at <= v_now THEN
    RAISE EXCEPTION 'portal invitation is unavailable'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_invitation.email <> v_auth_email THEN
    RAISE EXCEPTION 'portal invitation identity does not match'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT organisation_record.*
  INTO v_organisation
  FROM public.organisations AS organisation_record
  WHERE organisation_record.id = v_invitation.organisation_id
    AND organisation_record.status = 'ACTIVE'
    AND organisation_record.deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organisation is unavailable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT client_record.*
  INTO v_client
  FROM public.clients AS client_record
  WHERE client_record.id = v_invitation.client_id
    AND client_record.organisation_id = v_invitation.organisation_id
    AND client_record.status IN ('ONBOARDING', 'ACTIVE')
    AND client_record.deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client is unavailable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pg_catalog.count(DISTINCT matter_record.id)
  INTO v_valid_matter_count
  FROM pg_catalog.unnest(v_invitation.matter_ids) AS supplied_matter(id)
  JOIN public.matters AS matter_record
    ON matter_record.id = supplied_matter.id
   AND matter_record.organisation_id = v_invitation.organisation_id
   AND matter_record.deleted_at IS NULL
  JOIN public.matter_parties AS party
    ON party.organisation_id = matter_record.organisation_id
   AND party.matter_id = matter_record.id
   AND party.client_id = v_invitation.client_id
   AND party.deleted_at IS NULL;

  IF v_valid_matter_count <> cardinality(v_invitation.matter_ids) THEN
    RAISE EXCEPTION 'portal invitation matter access is no longer valid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT profile_record.*
  INTO v_profile
  FROM public.user_profiles AS profile_record
  WHERE profile_record.id = v_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF pg_catalog.lower(pg_catalog.btrim(v_profile.email)) <> v_auth_email
      OR v_profile.status <> 'ACTIVE' OR v_profile.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'the signed-in profile cannot use client portal access'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    INSERT INTO public.user_profiles (
      id, email, display_name, status, locale, timezone,
      is_platform_user, metadata, created_at, updated_at
    )
    VALUES (
      v_user_id,
      v_auth_email,
      v_client.display_name,
      'ACTIVE',
      COALESCE(NULLIF(v_client.preferred_language, ''), 'en-GB'),
      v_organisation.timezone,
      false,
      jsonb_build_object(
        'identityType', 'CLIENT_PORTAL',
        'createdFromInvitationId', v_invitation.id
      ),
      v_now,
      v_now
    )
    RETURNING * INTO v_profile;
  END IF;

  INSERT INTO public.client_portal_access_grants (
    organisation_id, client_id, user_profile_id, status, scopes,
    starts_at, expires_at, granted_by_user_id, grant_reason,
    created_at, updated_at
  )
  VALUES (
    v_invitation.organisation_id,
    v_invitation.client_id,
    v_user_id,
    'ACTIVE',
    v_invitation.scopes,
    v_now,
    NULL,
    v_invitation.invited_by_user_id,
    'Accepted verified client portal invitation',
    v_now,
    v_now
  )
  RETURNING * INTO v_access;

  INSERT INTO public.client_portal_matter_grants (
    organisation_id, access_grant_id, matter_id, created_at
  )
  SELECT
    v_invitation.organisation_id,
    v_access.id,
    supplied_matter.matter_id,
    v_now
  FROM pg_catalog.unnest(v_invitation.matter_ids)
    AS supplied_matter(matter_id);

  INSERT INTO public.communication_conversations (
    organisation_id, matter_id, client_id, channel, subject, status,
    created_by_user_id, created_at, updated_at
  )
  SELECT
    v_invitation.organisation_id,
    matter_record.id,
    v_invitation.client_id,
    'PORTAL',
    'Secure portal — ' || matter_record.matter_number,
    'OPEN',
    v_invitation.invited_by_user_id,
    v_now,
    v_now
  FROM public.matters AS matter_record
  WHERE matter_record.id = ANY(v_invitation.matter_ids)
    AND matter_record.organisation_id = v_invitation.organisation_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.client_notifications (
    organisation_id, access_grant_id, user_profile_id,
    notification_type, title, body, source_type, source_id, created_at
  )
  VALUES (
    v_invitation.organisation_id,
    v_access.id,
    v_user_id,
    'PORTAL_ACCESS_GRANTED',
    'Welcome to your secure client portal',
    'You can now view authorised case progress, documents and messages.',
    'PORTAL_INVITATION',
    v_invitation.id,
    v_now
  );

  UPDATE public.client_portal_invitations
  SET status = 'ACCEPTED',
      accepted_at = v_now,
      accepted_by_user_id = v_user_id,
      access_grant_id = v_access.id,
      updated_at = v_now
  WHERE id = v_invitation.id AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal invitation changed during acceptance'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    subject_user_profile_id, source, action, resource_type,
    resource_id, outcome, new_value
  )
  VALUES (
    pg_catalog.gen_random_uuid(),
    v_invitation.organisation_id,
    'USER',
    v_user_id,
    v_user_id,
    'businessos-api',
    'client_portal.invitation.accepted',
    'client_portal_access_grant',
    v_access.id::text,
    'SUCCESS',
    jsonb_build_object(
      'clientId', v_invitation.client_id,
      'matterCount', cardinality(v_invitation.matter_ids),
      'scopes', v_invitation.scopes
    )
  );

  RETURN QUERY
  SELECT
    v_invitation.id,
    v_access.id,
    v_invitation.organisation_id,
    v_organisation.name::text,
    v_invitation.client_id,
    v_client.display_name::text,
    v_invitation.matter_ids,
    v_invitation.scopes::text[],
    'ACCEPTED'::text;
END
$function$;

CREATE OR REPLACE FUNCTION private.revoke_client_portal_access(
  p_access_grant_id uuid,
  p_reason text
)
RETURNS TABLE (
  access_grant_id uuid,
  access_status text,
  revoked_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org_id uuid := private.current_organisation_id();
  v_user_id uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_access public.client_portal_access_grants%ROWTYPE;
  v_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
BEGIN
  IF v_org_id IS NULL OR v_user_id IS NULL
    OR NOT private.has_organisation_permission(v_org_id, 'portal_access.manage') THEN
    RAISE EXCEPTION 'portal access management is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'a valid revocation reason is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT access_record.*
  INTO v_access
  FROM public.client_portal_access_grants AS access_record
  WHERE access_record.id = p_access_grant_id
    AND access_record.organisation_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal access grant was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_access.status = 'REVOKED' THEN
    RETURN QUERY SELECT v_access.id, v_access.status::text, v_access.revoked_at;
    RETURN;
  END IF;

  UPDATE public.client_portal_access_grants
  SET status = 'REVOKED',
      revoked_at = v_now,
      revoked_by_user_id = v_user_id,
      revocation_reason = v_reason,
      suspended_at = CASE WHEN status = 'SUSPENDED' THEN suspended_at ELSE NULL END,
      suspended_by_user_id = CASE
        WHEN status = 'SUSPENDED' THEN suspended_by_user_id ELSE NULL END,
      suspension_reason = CASE
        WHEN status = 'SUSPENDED' THEN suspension_reason ELSE NULL END,
      version = version + 1,
      updated_at = v_now
  WHERE id = v_access.id
  RETURNING * INTO v_access;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    subject_user_profile_id, source, action, resource_type,
    resource_id, outcome, reason, new_value
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_org_id, 'USER', v_user_id,
    v_access.user_profile_id, 'businessos-api',
    'client_portal.access.revoked', 'client_portal_access_grant',
    v_access.id::text, 'SUCCESS', v_reason,
    jsonb_build_object('status', 'REVOKED', 'clientId', v_access.client_id)
  );

  RETURN QUERY SELECT v_access.id, v_access.status::text, v_access.revoked_at;
END
$function$;

CREATE OR REPLACE FUNCTION private.create_staff_communication_message(
  p_conversation_id uuid,
  p_subject text,
  p_body_text text,
  p_recipient_addresses text[],
  p_scheduled_at timestamptz,
  p_idempotency_key text
)
RETURNS TABLE (
  message_id uuid,
  message_status text,
  channel text,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org_id uuid := private.current_organisation_id();
  v_user_id uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_conversation public.communication_conversations%ROWTYPE;
  v_message public.communication_messages%ROWTYPE;
  v_recipient text;
BEGIN
  IF v_org_id IS NULL OR v_user_id IS NULL
    OR NOT private.has_organisation_permission(v_org_id, 'communications.send') THEN
    RAISE EXCEPTION 'communication sending is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$' THEN
    RAISE EXCEPTION 'a valid idempotency key is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT existing_message.*
  INTO v_message
  FROM public.communication_messages AS existing_message
  WHERE existing_message.organisation_id = v_org_id
    AND existing_message.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_message.author_user_profile_id IS DISTINCT FROM v_user_id
      OR v_message.conversation_id IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'idempotency key belongs to a different operation'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY
    SELECT v_message.id, v_message.status::text,
      v_message.channel::text, v_message.created_at;
    RETURN;
  END IF;

  SELECT conversation_record.*
  INTO v_conversation
  FROM public.communication_conversations AS conversation_record
  WHERE conversation_record.id = p_conversation_id
    AND conversation_record.organisation_id = v_org_id
    AND conversation_record.deleted_at IS NULL
    AND conversation_record.status <> 'ARCHIVED'
  FOR UPDATE;

  IF NOT FOUND OR NOT private.can_read_communication_conversation(
    v_org_id, p_conversation_id
  ) THEN
    RAISE EXCEPTION 'communication conversation was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_body_text IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_body_text))
      NOT BETWEEN 1 AND 50000 THEN
    RAISE EXCEPTION 'message body is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_conversation.channel = 'EMAIL' THEN
    IF cardinality(p_recipient_addresses) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'email recipients are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOREACH v_recipient IN ARRAY p_recipient_addresses LOOP
      IF pg_catalog.lower(pg_catalog.btrim(v_recipient)) !~
        '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'an email recipient is invalid'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END LOOP;
  ELSIF v_conversation.channel = 'WHATSAPP' THEN
    RAISE EXCEPTION 'WhatsApp delivery is not configured for this Gate D release'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  INSERT INTO public.communication_messages (
    organisation_id, conversation_id, matter_id, client_id,
    channel, direction, actor_type, author_user_profile_id,
    recipient_addresses, subject, body_text, status, client_visible,
    idempotency_key, scheduled_at, queued_at, delivered_at,
    next_attempt_at, created_at, updated_at
  )
  VALUES (
    v_org_id,
    v_conversation.id,
    v_conversation.matter_id,
    v_conversation.client_id,
    v_conversation.channel,
    'OUTBOUND',
    'STAFF',
    v_user_id,
    CASE
      WHEN v_conversation.channel = 'PORTAL' THEN ARRAY[]::varchar(320)[]
      ELSE ARRAY(
        SELECT pg_catalog.lower(pg_catalog.btrim(recipient))
        FROM pg_catalog.unnest(p_recipient_addresses) AS recipient
      )
    END,
    NULLIF(pg_catalog.btrim(p_subject), ''),
    pg_catalog.btrim(p_body_text),
    CASE
      WHEN v_conversation.channel = 'PORTAL' THEN 'DELIVERED'
      ELSE 'QUEUED'
    END,
    true,
    p_idempotency_key,
    p_scheduled_at,
    CASE WHEN v_conversation.channel = 'EMAIL' THEN v_now ELSE NULL END,
    CASE WHEN v_conversation.channel = 'PORTAL' THEN v_now ELSE NULL END,
    COALESCE(p_scheduled_at, v_now),
    v_now,
    v_now
  )
  RETURNING * INTO v_message;

  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, occurred_at, payload
  )
  VALUES (
    v_org_id,
    v_message.id,
    CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
    v_now,
    jsonb_build_object('channel', v_message.channel::text)
  );

  UPDATE public.communication_conversations
  SET status = 'WAITING_ON_CLIENT',
      last_message_at = v_now,
      resolved_at = NULL,
      version = version + 1,
      updated_at = v_now
  WHERE id = v_conversation.id;

  IF v_message.channel = 'PORTAL' THEN
    INSERT INTO public.client_notifications (
      organisation_id, access_grant_id, user_profile_id, matter_id,
      notification_type, title, body, source_type, source_id, created_at
    )
    SELECT
      access_record.organisation_id,
      access_record.id,
      access_record.user_profile_id,
      v_conversation.matter_id,
      'NEW_MESSAGE',
      COALESCE(v_message.subject, 'New secure message'),
      pg_catalog.left(v_message.body_text, 500),
      'COMMUNICATION_MESSAGE',
      v_message.id,
      v_now
    FROM public.client_portal_access_grants AS access_record
    JOIN public.client_portal_matter_grants AS matter_grant
      ON matter_grant.access_grant_id = access_record.id
     AND matter_grant.organisation_id = access_record.organisation_id
     AND matter_grant.matter_id = v_conversation.matter_id
    WHERE access_record.organisation_id = v_org_id
      AND access_record.client_id = v_conversation.client_id
      AND access_record.status = 'ACTIVE'
      AND access_record.starts_at <= v_now
      AND (access_record.expires_at IS NULL OR access_record.expires_at > v_now)
      AND 'NOTIFICATIONS' = ANY(access_record.scopes);
  END IF;

  IF v_conversation.matter_id IS NOT NULL THEN
    INSERT INTO public.matter_timeline_events (
      organisation_id, matter_id, event_type, source_type, source_id,
      summary, details, actor_user_id
    )
    VALUES (
      v_org_id, v_conversation.matter_id,
      'COMMUNICATION_SENT', 'COMMUNICATION_MESSAGE', v_message.id,
      'Client communication recorded.',
      jsonb_build_object(
        'channel', v_message.channel::text,
        'status', v_message.status::text,
        'conversationId', v_conversation.id
      ),
      v_user_id
    );
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_org_id, 'USER', v_user_id,
    'businessos-api', 'communication.message.created',
    'communication_message', v_message.id::text, 'SUCCESS',
    jsonb_build_object(
      'channel', v_message.channel::text,
      'conversationId', v_message.conversation_id,
      'clientVisible', v_message.client_visible
    )
  );

  RETURN QUERY
  SELECT v_message.id, v_message.status::text,
    v_message.channel::text, v_message.created_at;
END
$function$;

CREATE OR REPLACE FUNCTION private.post_client_portal_message(
  p_conversation_id uuid,
  p_body_text text,
  p_idempotency_key text
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  message_status text,
  created_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_conversation public.communication_conversations%ROWTYPE;
  v_message public.communication_messages%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_idempotency_key IS NULL
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,179}$'
    OR p_body_text IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_body_text)) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'portal message input is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT existing_message.*
  INTO v_message
  FROM public.communication_messages AS existing_message
  WHERE existing_message.idempotency_key = p_idempotency_key
    AND existing_message.author_user_profile_id = v_user_id;

  IF FOUND THEN
    IF v_message.conversation_id IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'idempotency key belongs to a different operation'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY
    SELECT v_message.id, v_message.conversation_id,
      v_message.status::text, v_message.created_at;
    RETURN;
  END IF;

  SELECT conversation_record.*
  INTO v_conversation
  FROM public.communication_conversations AS conversation_record
  WHERE conversation_record.id = p_conversation_id
    AND conversation_record.channel = 'PORTAL'
    AND conversation_record.client_id IS NOT NULL
    AND conversation_record.matter_id IS NOT NULL
    AND conversation_record.status <> 'ARCHIVED'
    AND conversation_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT private.portal_access_allows(
    v_conversation.organisation_id,
    v_conversation.client_id,
    v_conversation.matter_id,
    'MESSAGES'
  ) THEN
    RAISE EXCEPTION 'portal conversation was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.communication_messages (
    organisation_id, conversation_id, matter_id, client_id,
    channel, direction, actor_type, author_user_profile_id,
    recipient_addresses, body_text, status, client_visible,
    idempotency_key, delivered_at, next_attempt_at, created_at, updated_at
  )
  VALUES (
    v_conversation.organisation_id,
    v_conversation.id,
    v_conversation.matter_id,
    v_conversation.client_id,
    'PORTAL',
    'INBOUND',
    'CLIENT',
    v_user_id,
    ARRAY[]::varchar(320)[],
    pg_catalog.btrim(p_body_text),
    'DELIVERED',
    true,
    p_idempotency_key,
    v_now,
    v_now,
    v_now,
    v_now
  )
  RETURNING * INTO v_message;

  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, occurred_at, payload
  )
  VALUES (
    v_message.organisation_id, v_message.id, 'DELIVERED', v_now,
    jsonb_build_object('channel', 'PORTAL', 'actorType', 'CLIENT')
  );

  UPDATE public.communication_conversations
  SET status = 'WAITING_ON_TEAM',
      last_message_at = v_now,
      resolved_at = NULL,
      version = version + 1,
      updated_at = v_now
  WHERE id = v_conversation.id;

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id
  )
  VALUES (
    v_conversation.organisation_id,
    v_conversation.matter_id,
    'CLIENT_MESSAGE_RECEIVED',
    'COMMUNICATION_MESSAGE',
    v_message.id,
    'A secure client portal message was received.',
    jsonb_build_object('conversationId', v_conversation.id),
    v_user_id
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_conversation.organisation_id,
    'USER', v_user_id, 'businessos-client-portal',
    'communication.message.received', 'communication_message',
    v_message.id::text, 'SUCCESS',
    jsonb_build_object(
      'channel', 'PORTAL',
      'conversationId', v_conversation.id,
      'matterId', v_conversation.matter_id
    )
  );

  RETURN QUERY
  SELECT v_message.id, v_message.conversation_id,
    v_message.status::text, v_message.created_at;
END
$function$;

CREATE OR REPLACE FUNCTION private.publish_client_portal_update(
  p_matter_id uuid,
  p_title text,
  p_summary text,
  p_stage_key text,
  p_progress_percent integer
)
RETURNS TABLE (
  update_id uuid,
  matter_id uuid,
  published_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org_id uuid := private.current_organisation_id();
  v_user_id uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_update public.portal_matter_updates%ROWTYPE;
BEGIN
  IF v_org_id IS NULL OR v_user_id IS NULL
    OR NOT private.has_organisation_permission(v_org_id, 'portal_updates.publish')
    OR NOT private.can_update_matter(v_org_id, p_matter_id) THEN
    RAISE EXCEPTION 'portal update publishing is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.portal_matter_updates (
    organisation_id, matter_id, title, summary, stage_key,
    progress_percent, published_at, published_by_user_id, created_at
  )
  VALUES (
    v_org_id,
    p_matter_id,
    pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_summary),
    NULLIF(pg_catalog.btrim(p_stage_key), ''),
    p_progress_percent,
    v_now,
    v_user_id,
    v_now
  )
  RETURNING * INTO v_update;

  INSERT INTO public.client_notifications (
    organisation_id, access_grant_id, user_profile_id, matter_id,
    notification_type, title, body, source_type, source_id, created_at
  )
  SELECT
    access_record.organisation_id,
    access_record.id,
    access_record.user_profile_id,
    p_matter_id,
    'MATTER_PROGRESS',
    v_update.title,
    pg_catalog.left(v_update.summary, 500),
    'PORTAL_MATTER_UPDATE',
    v_update.id,
    v_now
  FROM public.client_portal_access_grants AS access_record
  JOIN public.client_portal_matter_grants AS matter_grant
    ON matter_grant.access_grant_id = access_record.id
   AND matter_grant.organisation_id = access_record.organisation_id
   AND matter_grant.matter_id = p_matter_id
  WHERE access_record.organisation_id = v_org_id
    AND access_record.status = 'ACTIVE'
    AND access_record.starts_at <= v_now
    AND (access_record.expires_at IS NULL OR access_record.expires_at > v_now)
    AND 'NOTIFICATIONS' = ANY(access_record.scopes);

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id
  )
  VALUES (
    v_org_id, p_matter_id, 'CLIENT_PROGRESS_PUBLISHED',
    'PORTAL_MATTER_UPDATE', v_update.id,
    'A client-visible matter progress update was published.',
    jsonb_build_object(
      'stageKey', v_update.stage_key,
      'progressPercent', v_update.progress_percent
    ),
    v_user_id
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_org_id, 'USER', v_user_id,
    'businessos-api', 'client_portal.progress.published',
    'portal_matter_update', v_update.id::text, 'SUCCESS',
    jsonb_build_object('matterId', p_matter_id)
  );

  RETURN QUERY SELECT v_update.id, v_update.matter_id, v_update.published_at;
END
$function$;

CREATE OR REPLACE FUNCTION private.register_client_portal_document_upload(
  p_request_item_id uuid,
  p_original_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_sha256_hex text
)
RETURNS TABLE (
  document_id uuid,
  version_id uuid,
  storage_bucket text,
  storage_path text,
  document_status text,
  scan_status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_item public.document_request_items%ROWTYPE;
  v_request public.document_requests%ROWTYPE;
  v_document public.matter_documents%ROWTYPE;
  v_version public.matter_document_versions%ROWTYPE;
  v_version_id uuid := pg_catalog.gen_random_uuid();
  v_version_number integer;
  v_file_name text := pg_catalog.btrim(p_original_file_name);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_file_name IS NULL OR pg_catalog.char_length(v_file_name) NOT BETWEEN 1 AND 255
    OR v_file_name ~ '[\\/]'
    OR p_content_type NOT IN (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    OR p_size_bytes NOT BETWEEN 1 AND 52428800
    OR p_sha256_hex !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'document registration metadata is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT item_record.*
  INTO v_request_item
  FROM public.document_request_items AS item_record
  WHERE item_record.id = p_request_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_request_item.status NOT IN ('REQUESTED', 'REJECTED') THEN
    RAISE EXCEPTION 'document request item is unavailable'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT request_record.*
  INTO v_request
  FROM public.document_requests AS request_record
  WHERE request_record.id = v_request_item.request_id
    AND request_record.organisation_id = v_request_item.organisation_id
    AND request_record.recipient_client_id IS NOT NULL
    AND request_record.status IN ('SENT', 'PARTIALLY_RECEIVED')
    AND request_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT private.portal_access_allows(
    v_request.organisation_id,
    v_request.recipient_client_id,
    v_request.matter_id,
    'DOCUMENTS'
  ) THEN
    RAISE EXCEPTION 'document upload is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT document_record.*
  INTO v_document
  FROM public.matter_documents AS document_record
  WHERE document_record.organisation_id = v_request.organisation_id
    AND document_record.matter_id = v_request.matter_id
    AND document_record.request_item_id = v_request_item.id
    AND document_record.archived_at IS NULL
    AND document_record.deleted_at IS NULL
  ORDER BY document_record.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.matter_documents (
      organisation_id, matter_id, request_item_id, title, category,
      security_classification, status, client_visible,
      created_by_user_id, updated_by_user_id, created_at, updated_at
    )
    VALUES (
      v_request.organisation_id,
      v_request.matter_id,
      v_request_item.id,
      v_request_item.title,
      v_request_item.category,
      'CONFIDENTIAL',
      'PENDING_UPLOAD',
      true,
      v_user_id,
      v_user_id,
      v_now,
      v_now
    )
    RETURNING * INTO v_document;
    v_version_number := 1;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.matter_document_versions AS pending_version
      WHERE pending_version.document_id = v_document.id
        AND pending_version.organisation_id = v_document.organisation_id
        AND pending_version.status IN ('PENDING_UPLOAD', 'PENDING_SCAN')
    ) THEN
      RAISE EXCEPTION 'a document upload is already in progress for this request item'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    SELECT COALESCE(pg_catalog.max(version_record.version_number), 0) + 1
    INTO v_version_number
    FROM public.matter_document_versions AS version_record
    WHERE version_record.document_id = v_document.id;
  END IF;

  INSERT INTO public.matter_document_versions (
    id, organisation_id, matter_id, document_id, version_number,
    original_file_name, content_type, size_bytes, sha256_hex,
    storage_bucket, storage_path, status, scan_status,
    uploaded_by_user_id, created_at, updated_at
  )
  VALUES (
    v_version_id,
    v_request.organisation_id,
    v_request.matter_id,
    v_document.id,
    v_version_number,
    v_file_name,
    pg_catalog.lower(p_content_type),
    p_size_bytes,
    p_sha256_hex,
    'businessos-documents',
    v_request.organisation_id::text || '/' ||
      v_request.matter_id::text || '/' ||
      v_document.id::text || '/' ||
      v_version_id::text || '/object',
    'PENDING_UPLOAD',
    'NOT_SCANNED',
    v_user_id,
    v_now,
    v_now
  )
  RETURNING * INTO v_version;

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id
  )
  VALUES (
    v_request.organisation_id, v_request.matter_id,
    'CLIENT_DOCUMENT_REGISTERED', 'DOCUMENT', v_document.id,
    'A client registered a secure document upload.',
    jsonb_build_object(
      'requestItemId', v_request_item.id,
      'versionId', v_version.id,
      'versionNumber', v_version.version_number
    ),
    v_user_id
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_request.organisation_id,
    'USER', v_user_id, 'businessos-client-portal',
    'client_portal.document.registered', 'matter_document',
    v_document.id::text, 'SUCCESS',
    jsonb_build_object(
      'matterId', v_request.matter_id,
      'requestItemId', v_request_item.id,
      'versionId', v_version.id,
      'sizeBytes', v_version.size_bytes,
      'contentType', v_version.content_type
    )
  );

  RETURN QUERY
  SELECT
    v_document.id,
    v_version.id,
    v_version.storage_bucket::text,
    v_version.storage_path::text,
    v_version.status::text,
    v_version.scan_status::text;
END
$function$;

CREATE OR REPLACE FUNCTION private.finalise_client_portal_document_upload(
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
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_version public.matter_document_versions%ROWTYPE;
  v_document public.matter_documents%ROWTYPE;
  v_request public.document_requests%ROWTYPE;
  v_object_matches boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT version_record.*
  INTO v_version
  FROM public.matter_document_versions AS version_record
  WHERE version_record.id = p_version_id
    AND version_record.document_id = p_document_id
  FOR UPDATE;

  IF NOT FOUND OR v_version.uploaded_by_user_id <> v_user_id
    OR v_version.status <> 'PENDING_UPLOAD'
    OR v_version.scan_status <> 'NOT_SCANNED' THEN
    RAISE EXCEPTION 'document upload cannot be finalised'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT document_record.*
  INTO v_document
  FROM public.matter_documents AS document_record
  WHERE document_record.id = p_document_id
    AND document_record.organisation_id = v_version.organisation_id
    AND document_record.request_item_id IS NOT NULL
    AND document_record.client_visible
    AND document_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document upload cannot be finalised'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT request_record.*
  INTO v_request
  FROM public.document_request_items AS item_record
  JOIN public.document_requests AS request_record
    ON request_record.id = item_record.request_id
   AND request_record.organisation_id = item_record.organisation_id
  WHERE item_record.id = v_document.request_item_id
    AND item_record.organisation_id = v_document.organisation_id;

  IF NOT FOUND OR v_request.recipient_client_id IS NULL
    OR NOT private.portal_access_allows(
      v_request.organisation_id,
      v_request.recipient_client_id,
      v_request.matter_id,
      'DOCUMENTS'
    ) THEN
    RAISE EXCEPTION 'document upload is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM storage.objects AS object_record
    WHERE object_record.bucket_id = v_version.storage_bucket
      AND object_record.name = v_version.storage_path
      AND COALESCE((object_record.metadata ->> 'size')::bigint, -1)
        = v_version.size_bytes
      AND pg_catalog.lower(COALESCE(
        object_record.metadata ->> 'mimetype', ''
      )) = v_version.content_type
  ) INTO v_object_matches;

  IF NOT v_object_matches THEN
    RAISE EXCEPTION 'stored object metadata does not match registration'
      USING ERRCODE = 'check_violation';
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
  WHERE id = v_document.id;

  INSERT INTO public.matter_timeline_events (
    organisation_id, matter_id, event_type, source_type, source_id,
    summary, details, actor_user_id
  )
  VALUES (
    v_version.organisation_id, v_version.matter_id,
    'CLIENT_DOCUMENT_UPLOADED', 'DOCUMENT', v_document.id,
    'A client document was uploaded and isolated pending malware scan.',
    jsonb_build_object('versionId', v_version.id, 'scanStatus', 'PENDING'),
    v_user_id
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_version.organisation_id,
    'USER', v_user_id, 'businessos-client-portal',
    'client_portal.document.uploaded', 'matter_document',
    v_document.id::text, 'SUCCESS',
    jsonb_build_object(
      'matterId', v_version.matter_id,
      'versionId', v_version.id,
      'scanStatus', 'PENDING'
    )
  );

  RETURN QUERY
  SELECT v_document.id, v_version.id, document_record.status::text, 'PENDING'::text
  FROM public.matter_documents AS document_record
  WHERE document_record.id = v_document.id;
END
$function$;

CREATE OR REPLACE FUNCTION private.mark_client_notification_read(
  p_notification_id uuid
)
RETURNS TABLE (notification_id uuid, read_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_notification public.client_notifications%ROWTYPE;
BEGIN
  UPDATE public.client_notifications
  SET read_at = COALESCE(read_at, pg_catalog.now())
  WHERE id = p_notification_id
    AND user_profile_id = v_user_id
    AND EXISTS (
      SELECT 1
      FROM public.client_portal_access_grants AS access_record
      WHERE access_record.id = client_notifications.access_grant_id
        AND access_record.organisation_id = client_notifications.organisation_id
        AND access_record.user_profile_id = v_user_id
        AND private.portal_access_allows(
          access_record.organisation_id,
          access_record.client_id,
          client_notifications.matter_id,
          'NOTIFICATIONS'
        )
    )
  RETURNING * INTO v_notification;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN QUERY SELECT v_notification.id, v_notification.read_at;
END
$function$;

CREATE OR REPLACE FUNCTION private.get_client_portal_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := private.current_user_id();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication context is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.client_portal_access_grants
  SET last_accessed_at = v_now,
      updated_at = v_now
  WHERE user_profile_id = v_user_id
    AND status = 'ACTIVE'
    AND starts_at <= v_now
    AND (expires_at IS NULL OR expires_at > v_now);

  WITH active_access AS (
    SELECT
      access_record.id,
      access_record.organisation_id,
      access_record.client_id,
      access_record.scopes,
      organisation_record.name AS organisation_name,
      organisation_record.slug AS organisation_slug,
      organisation_record.timezone,
      client_record.client_number,
      client_record.display_name AS client_name,
      client_record.email AS client_email
    FROM public.client_portal_access_grants AS access_record
    JOIN public.organisations AS organisation_record
      ON organisation_record.id = access_record.organisation_id
     AND organisation_record.status = 'ACTIVE'
     AND organisation_record.deleted_at IS NULL
    JOIN public.clients AS client_record
      ON client_record.id = access_record.client_id
     AND client_record.organisation_id = access_record.organisation_id
     AND client_record.status IN ('ONBOARDING', 'ACTIVE')
     AND client_record.deleted_at IS NULL
    WHERE access_record.user_profile_id = v_user_id
      AND access_record.status = 'ACTIVE'
      AND access_record.starts_at <= v_now
      AND (access_record.expires_at IS NULL OR access_record.expires_at > v_now)
  ), authorised_matters AS (
    SELECT DISTINCT
      active_access.id AS access_grant_id,
      active_access.organisation_id,
      active_access.client_id,
      active_access.scopes,
      matter_record.id,
      matter_record.matter_number,
      matter_record.title,
      matter_record.service_type,
      matter_record.status,
      matter_record.priority,
      matter_record.opened_at,
      matter_record.target_completion_at,
      matter_record.closed_at
    FROM active_access
    JOIN public.client_portal_matter_grants AS matter_grant
      ON matter_grant.access_grant_id = active_access.id
     AND matter_grant.organisation_id = active_access.organisation_id
    JOIN public.matters AS matter_record
      ON matter_record.id = matter_grant.matter_id
     AND matter_record.organisation_id = matter_grant.organisation_id
     AND matter_record.deleted_at IS NULL
    JOIN public.matter_parties AS party
      ON party.organisation_id = matter_record.organisation_id
     AND party.matter_id = matter_record.id
     AND party.client_id = active_access.client_id
     AND party.deleted_at IS NULL
  ), portal_documents AS (
    SELECT DISTINCT
      document_record.id,
      document_record.organisation_id,
      document_record.matter_id,
      document_record.request_item_id,
      document_record.title,
      document_record.category,
      document_record.status,
      document_record.current_version_id,
      version_record.original_file_name,
      version_record.content_type,
      version_record.size_bytes,
      version_record.storage_bucket,
      version_record.storage_path,
      version_record.uploaded_at,
      version_record.scan_status
    FROM authorised_matters
    JOIN public.matter_documents AS document_record
      ON document_record.organisation_id = authorised_matters.organisation_id
     AND document_record.matter_id = authorised_matters.id
     AND document_record.client_visible
     AND document_record.status = 'AVAILABLE'
     AND document_record.security_classification IN ('INTERNAL', 'CONFIDENTIAL')
     AND document_record.deleted_at IS NULL
    JOIN public.matter_document_versions AS version_record
      ON version_record.id = document_record.current_version_id
     AND version_record.organisation_id = document_record.organisation_id
     AND version_record.status = 'AVAILABLE'
     AND version_record.scan_status = 'CLEAN'
    WHERE 'DOCUMENTS' = ANY(authorised_matters.scopes)
  )
  SELECT jsonb_build_object(
    'profile', COALESCE((
      SELECT jsonb_build_object(
        'id', profile_record.id,
        'email', profile_record.email,
        'displayName', profile_record.display_name
      )
      FROM public.user_profiles AS profile_record
      WHERE profile_record.id = v_user_id
        AND profile_record.status = 'ACTIVE'
        AND profile_record.deleted_at IS NULL
    ), 'null'::jsonb),
    'accessGrants', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', active_access.id,
          'organisationId', active_access.organisation_id,
          'organisationName', active_access.organisation_name,
          'organisationSlug', active_access.organisation_slug,
          'timezone', active_access.timezone,
          'clientId', active_access.client_id,
          'clientNumber', active_access.client_number,
          'clientName', active_access.client_name,
          'clientEmail', active_access.client_email,
          'scopes', active_access.scopes
        ) ORDER BY active_access.organisation_name, active_access.client_name
      ) FROM active_access
    ), '[]'::jsonb),
    'matters', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'accessGrantId', authorised_matters.access_grant_id,
          'organisationId', authorised_matters.organisation_id,
          'clientId', authorised_matters.client_id,
          'id', authorised_matters.id,
          'matterNumber', authorised_matters.matter_number,
          'title', authorised_matters.title,
          'serviceType', authorised_matters.service_type,
          'status', authorised_matters.status,
          'priority', authorised_matters.priority,
          'openedAt', authorised_matters.opened_at,
          'targetCompletionAt', authorised_matters.target_completion_at,
          'closedAt', authorised_matters.closed_at
        ) ORDER BY authorised_matters.opened_at DESC
      ) FROM authorised_matters
    ), '[]'::jsonb),
    'updates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', update_record.id,
          'organisationId', update_record.organisation_id,
          'matterId', update_record.matter_id,
          'title', update_record.title,
          'summary', update_record.summary,
          'stageKey', update_record.stage_key,
          'progressPercent', update_record.progress_percent,
          'publishedAt', update_record.published_at
        ) ORDER BY update_record.published_at DESC
      )
      FROM public.portal_matter_updates AS update_record
      JOIN authorised_matters
        ON authorised_matters.organisation_id = update_record.organisation_id
       AND authorised_matters.id = update_record.matter_id
      WHERE update_record.superseded_at IS NULL
        AND 'MATTER_PROGRESS' = ANY(authorised_matters.scopes)
    ), '[]'::jsonb),
    'documentRequests', COALESCE((
      SELECT jsonb_agg(request_payload ORDER BY request_created_at DESC)
      FROM (
        SELECT DISTINCT
          request_record.created_at AS request_created_at,
          jsonb_build_object(
            'id', request_record.id,
            'organisationId', request_record.organisation_id,
            'matterId', request_record.matter_id,
            'title', request_record.title,
            'message', request_record.message,
            'status', request_record.status,
            'dueAt', request_record.due_at,
            'sentAt', request_record.sent_at,
            'completedAt', request_record.completed_at,
            'items', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', item_record.id,
                  'category', item_record.category,
                  'title', item_record.title,
                  'description', item_record.description,
                  'isRequired', item_record.is_required,
                  'status', item_record.status,
                  'statusReason', item_record.status_reason
                ) ORDER BY item_record.created_at
              )
              FROM public.document_request_items AS item_record
              WHERE item_record.request_id = request_record.id
                AND item_record.organisation_id = request_record.organisation_id
            ), '[]'::jsonb)
          ) AS request_payload
        FROM public.document_requests AS request_record
        JOIN authorised_matters
          ON authorised_matters.organisation_id = request_record.organisation_id
         AND authorised_matters.id = request_record.matter_id
         AND authorised_matters.client_id = request_record.recipient_client_id
        WHERE request_record.status IN (
          'SENT', 'PARTIALLY_RECEIVED', 'COMPLETED', 'EXPIRED'
        )
          AND 'DOCUMENTS' = ANY(authorised_matters.scopes)
          AND request_record.deleted_at IS NULL
      ) AS request_rows
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', portal_documents.id,
          'organisationId', portal_documents.organisation_id,
          'matterId', portal_documents.matter_id,
          'requestItemId', portal_documents.request_item_id,
          'title', portal_documents.title,
          'category', portal_documents.category,
          'status', portal_documents.status,
          'versionId', portal_documents.current_version_id,
          'fileName', portal_documents.original_file_name,
          'contentType', portal_documents.content_type,
          'sizeBytes', portal_documents.size_bytes,
          'storageBucket', portal_documents.storage_bucket,
          'storagePath', portal_documents.storage_path,
          'uploadedAt', portal_documents.uploaded_at,
          'scanStatus', portal_documents.scan_status
        ) ORDER BY portal_documents.uploaded_at DESC
      ) FROM portal_documents
    ), '[]'::jsonb),
    'conversations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', conversation_record.id,
          'organisationId', conversation_record.organisation_id,
          'matterId', conversation_record.matter_id,
          'clientId', conversation_record.client_id,
          'subject', conversation_record.subject,
          'status', conversation_record.status,
          'lastMessageAt', conversation_record.last_message_at,
          'messages', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', message_record.id,
                'direction', message_record.direction,
                'actorType', message_record.actor_type,
                'subject', message_record.subject,
                'bodyText', message_record.body_text,
                'status', message_record.status,
                'deliveredAt', message_record.delivered_at,
                'readAt', message_record.read_at,
                'createdAt', message_record.created_at
              ) ORDER BY message_record.created_at
            )
            FROM public.communication_messages AS message_record
            WHERE message_record.conversation_id = conversation_record.id
              AND message_record.organisation_id = conversation_record.organisation_id
              AND message_record.client_visible
          ), '[]'::jsonb)
        ) ORDER BY conversation_record.last_message_at DESC NULLS LAST,
          conversation_record.created_at DESC
      )
      FROM public.communication_conversations AS conversation_record
      JOIN authorised_matters
        ON authorised_matters.organisation_id = conversation_record.organisation_id
       AND authorised_matters.id = conversation_record.matter_id
       AND authorised_matters.client_id = conversation_record.client_id
      WHERE conversation_record.channel = 'PORTAL'
        AND 'MESSAGES' = ANY(authorised_matters.scopes)
        AND conversation_record.deleted_at IS NULL
    ), '[]'::jsonb),
    'notifications', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', notification_record.id,
          'organisationId', notification_record.organisation_id,
          'matterId', notification_record.matter_id,
          'type', notification_record.notification_type,
          'title', notification_record.title,
          'body', notification_record.body,
          'readAt', notification_record.read_at,
          'createdAt', notification_record.created_at
        ) ORDER BY notification_record.created_at DESC
      )
      FROM public.client_notifications AS notification_record
      JOIN active_access
        ON active_access.id = notification_record.access_grant_id
       AND active_access.organisation_id = notification_record.organisation_id
      WHERE notification_record.user_profile_id = v_user_id
        AND 'NOTIFICATIONS' = ANY(active_access.scopes)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object(
    'profile', NULL,
    'accessGrants', '[]'::jsonb,
    'matters', '[]'::jsonb,
    'updates', '[]'::jsonb,
    'documentRequests', '[]'::jsonb,
    'documents', '[]'::jsonb,
    'conversations', '[]'::jsonb,
    'notifications', '[]'::jsonb
  ));
END
$function$;

CREATE OR REPLACE FUNCTION private.auth_portal_can_upload_document_object(
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
    JOIN public.document_request_items AS item_record
      ON item_record.id = document_record.request_item_id
     AND item_record.organisation_id = document_record.organisation_id
    JOIN public.document_requests AS request_record
      ON request_record.id = item_record.request_id
     AND request_record.organisation_id = item_record.organisation_id
    WHERE version_record.storage_bucket = 'businessos-documents'
      AND version_record.storage_path = p_storage_path
      AND version_record.status = 'PENDING_UPLOAD'
      AND version_record.scan_status = 'NOT_SCANNED'
      AND version_record.uploaded_by_user_id = auth.uid()
      AND document_record.client_visible
      AND document_record.deleted_at IS NULL
      AND request_record.recipient_client_id IS NOT NULL
      AND private.auth_portal_access_allows(
        version_record.organisation_id,
        request_record.recipient_client_id,
        version_record.matter_id,
        'DOCUMENTS'
      )
  )
$function$;

CREATE OR REPLACE FUNCTION private.auth_portal_can_read_document_object(
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
    JOIN public.matter_parties AS party
      ON party.organisation_id = document_record.organisation_id
     AND party.matter_id = document_record.matter_id
     AND party.deleted_at IS NULL
    WHERE version_record.storage_bucket = 'businessos-documents'
      AND version_record.storage_path = p_storage_path
      AND version_record.status = 'AVAILABLE'
      AND version_record.scan_status = 'CLEAN'
      AND document_record.current_version_id = version_record.id
      AND document_record.status = 'AVAILABLE'
      AND document_record.client_visible
      AND document_record.security_classification IN ('INTERNAL', 'CONFIDENTIAL')
      AND document_record.deleted_at IS NULL
      AND private.auth_portal_access_allows(
        version_record.organisation_id,
        party.client_id,
        version_record.matter_id,
        'DOCUMENTS'
      )
  )
$function$;

GRANT CREATE ON SCHEMA private TO businessos_policy_reader;
ALTER FUNCTION private.auth_portal_can_upload_document_object(text)
  OWNER TO businessos_policy_reader;
ALTER FUNCTION private.auth_portal_can_read_document_object(text)
  OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;
REVOKE ALL ON FUNCTION private.auth_portal_can_upload_document_object(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_portal_can_read_document_object(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.auth_portal_can_upload_document_object(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.auth_portal_can_read_document_object(text)
  TO authenticated;

CREATE POLICY businessos_portal_document_object_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'businessos-documents'
  AND private.auth_portal_can_upload_document_object(name)
);

CREATE POLICY businessos_portal_document_object_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'businessos-documents'
  AND private.auth_portal_can_read_document_object(name)
);

CREATE OR REPLACE FUNCTION private.materialise_due_communication_reminders(
  p_batch_size integer DEFAULT 25
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reminder public.communication_reminders%ROWTYPE;
  v_message public.communication_messages%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'reminder batch size is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.client_portal_invitations
  SET status = 'EXPIRED', updated_at = v_now
  WHERE status = 'PENDING' AND expires_at <= v_now;

  FOR v_reminder IN
    SELECT reminder_record.*
    FROM public.communication_reminders AS reminder_record
    WHERE reminder_record.status = 'SCHEDULED'
      AND reminder_record.scheduled_for <= v_now
    ORDER BY reminder_record.scheduled_for, reminder_record.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  LOOP
    INSERT INTO public.communication_messages (
      organisation_id, conversation_id, matter_id, client_id,
      channel, direction, actor_type, author_user_profile_id,
      recipient_addresses, subject, body_text, status, client_visible,
      idempotency_key, scheduled_at, queued_at, delivered_at,
      next_attempt_at, created_at, updated_at
    )
    VALUES (
      v_reminder.organisation_id,
      v_reminder.conversation_id,
      v_reminder.matter_id,
      v_reminder.client_id,
      v_reminder.channel,
      'OUTBOUND',
      'STAFF',
      v_reminder.created_by_user_id,
      CASE WHEN v_reminder.channel = 'PORTAL'
        THEN ARRAY[]::varchar(320)[]
        ELSE ARRAY[v_reminder.recipient_address]::varchar(320)[] END,
      v_reminder.subject,
      v_reminder.body_text,
      CASE WHEN v_reminder.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
      true,
      'reminder/' || v_reminder.id::text,
      v_reminder.scheduled_for,
      CASE WHEN v_reminder.channel = 'EMAIL' THEN v_now ELSE NULL END,
      CASE WHEN v_reminder.channel = 'PORTAL' THEN v_now ELSE NULL END,
      v_now,
      v_now,
      v_now
    )
    ON CONFLICT (organisation_id, idempotency_key) DO UPDATE
      SET updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_message;

    UPDATE public.communication_reminders
    SET status = CASE
          WHEN v_message.channel = 'PORTAL' THEN 'SENT'
          ELSE 'PROCESSING'
        END,
        message_id = v_message.id,
        updated_at = v_now
    WHERE id = v_reminder.id;

    INSERT INTO public.communication_delivery_events (
      organisation_id, message_id, event_type, occurred_at, payload
    )
    VALUES (
      v_message.organisation_id,
      v_message.id,
      CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,
      v_now,
      jsonb_build_object('source', 'REMINDER', 'reminderId', v_reminder.id)
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.communication_conversations
    SET status = 'WAITING_ON_CLIENT',
        last_message_at = v_now,
        resolved_at = NULL,
        version = version + 1,
        updated_at = v_now
    WHERE id = v_reminder.conversation_id;

    IF v_message.channel = 'PORTAL' THEN
      INSERT INTO public.client_notifications (
        organisation_id, access_grant_id, user_profile_id, matter_id,
        notification_type, title, body, source_type, source_id, created_at
      )
      SELECT
        access_record.organisation_id,
        access_record.id,
        access_record.user_profile_id,
        v_message.matter_id,
        'REMINDER',
        COALESCE(v_message.subject, 'Reminder'),
        pg_catalog.left(v_message.body_text, 500),
        'COMMUNICATION_MESSAGE',
        v_message.id,
        v_now
      FROM public.client_portal_access_grants AS access_record
      JOIN public.client_portal_matter_grants AS matter_grant
        ON matter_grant.access_grant_id = access_record.id
       AND matter_grant.organisation_id = access_record.organisation_id
       AND matter_grant.matter_id = v_message.matter_id
      WHERE access_record.organisation_id = v_message.organisation_id
        AND access_record.client_id = v_message.client_id
        AND access_record.status = 'ACTIVE'
        AND 'NOTIFICATIONS' = ANY(access_record.scopes);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$function$;

CREATE OR REPLACE FUNCTION private.claim_communication_delivery_job(
  p_worker_id text,
  p_lease_seconds integer
)
RETURNS TABLE (
  message_id uuid,
  organisation_id uuid,
  recipient_addresses text[],
  subject text,
  body_text text,
  idempotency_key text,
  attempt integer,
  max_attempts integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
    OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'delivery worker lease input is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH failed_messages AS (
    UPDATE public.communication_messages
    SET status = 'FAILED',
        failed_at = v_now,
        failure_code = 'DELIVERY_LEASE_EXHAUSTED',
        failure_detail = 'The delivery lease expired after the maximum number of attempts.',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE channel = 'EMAIL'
      AND status = 'SENDING'
      AND lease_expires_at <= v_now
      AND attempts >= max_attempts
    RETURNING id, failure_code, failure_detail
  )
  UPDATE public.communication_reminders AS reminder_record
  SET status = 'FAILED',
      failure_code = failed_messages.failure_code,
      failure_detail = failed_messages.failure_detail,
      updated_at = v_now
  FROM failed_messages
  WHERE reminder_record.message_id = failed_messages.id
    AND reminder_record.status = 'PROCESSING';

  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, occurred_at, payload
  )
  SELECT
    message_record.organisation_id,
    message_record.id,
    'FAILED',
    v_now,
    jsonb_build_object(
      'errorCode', 'DELIVERY_LEASE_EXHAUSTED',
      'attempt', message_record.attempts
    )
  FROM public.communication_messages AS message_record
  WHERE message_record.channel = 'EMAIL'
    AND message_record.status = 'FAILED'
    AND message_record.failure_code = 'DELIVERY_LEASE_EXHAUSTED'
    AND message_record.failed_at = v_now;

  RETURN QUERY
  WITH candidate AS (
    SELECT message_record.id
    FROM public.communication_messages AS message_record
    WHERE message_record.channel = 'EMAIL'
      AND (
        message_record.status = 'QUEUED'
        OR (
          message_record.status = 'SENDING'
          AND message_record.lease_expires_at <= v_now
        )
      )
      AND message_record.next_attempt_at <= v_now
      AND (message_record.scheduled_at IS NULL OR message_record.scheduled_at <= v_now)
      AND message_record.attempts < message_record.max_attempts
    ORDER BY message_record.next_attempt_at, message_record.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.communication_messages AS message_record
    SET status = 'SENDING',
        attempts = message_record.attempts + 1,
        lease_owner = p_worker_id,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = v_now
    FROM candidate
    WHERE message_record.id = candidate.id
    RETURNING message_record.*
  )
  SELECT
    claimed.id,
    claimed.organisation_id,
    claimed.recipient_addresses::text[],
    claimed.subject::text,
    claimed.body_text,
    claimed.idempotency_key,
    claimed.attempts,
    claimed.max_attempts
  FROM claimed;
END
$function$;

CREATE OR REPLACE FUNCTION private.complete_communication_delivery_job(
  p_message_id uuid,
  p_worker_id text,
  p_provider text,
  p_provider_message_id text
)
RETURNS TABLE (message_id uuid, message_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_message public.communication_messages%ROWTYPE;
BEGIN
  SELECT message_record.*
  INTO v_message
  FROM public.communication_messages AS message_record
  WHERE message_record.id = p_message_id
  FOR UPDATE;

  IF NOT FOUND OR v_message.status <> 'SENDING'
    OR v_message.lease_owner IS DISTINCT FROM p_worker_id
    OR v_message.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'delivery job lease is invalid'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE public.communication_messages
  SET status = 'SENT',
      provider = pg_catalog.lower(pg_catalog.btrim(p_provider)),
      provider_message_id = pg_catalog.btrim(p_provider_message_id),
      sent_at = v_now,
      lease_owner = NULL,
      lease_expires_at = NULL,
      failure_code = NULL,
      failure_detail = NULL,
      failed_at = NULL,
      updated_at = v_now
  WHERE id = v_message.id
  RETURNING * INTO v_message;

  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, provider,
    occurred_at, payload
  )
  VALUES (
    v_message.organisation_id, v_message.id, 'ACCEPTED',
    v_message.provider, v_now,
    jsonb_build_object('providerMessageId', v_message.provider_message_id)
  );

  UPDATE public.communication_reminders
  SET status = 'SENT', updated_at = v_now
  WHERE message_id = v_message.id AND status = 'PROCESSING';

  IF v_message.client_id IS NOT NULL THEN
    UPDATE public.clients
    SET last_contacted_at = v_now,
        updated_at = v_now
    WHERE id = v_message.client_id
      AND organisation_id = v_message.organisation_id;
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_identifier,
    source, action, resource_type, resource_id, outcome, metadata
  )
  VALUES (
    pg_catalog.gen_random_uuid(), v_message.organisation_id,
    'SYSTEM', p_worker_id, 'businessos-communication-worker',
    'communication.delivery.accepted', 'communication_message',
    v_message.id::text, 'SUCCESS',
    jsonb_build_object('provider', v_message.provider, 'attempt', v_message.attempts)
  );

  RETURN QUERY SELECT v_message.id, v_message.status::text;
END
$function$;

CREATE OR REPLACE FUNCTION private.fail_communication_delivery_job(
  p_message_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text,
  p_retryable boolean
)
RETURNS TABLE (message_id uuid, message_status text, next_attempt_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_message public.communication_messages%ROWTYPE;
  v_retry boolean;
  v_delay_seconds integer;
BEGIN
  SELECT message_record.*
  INTO v_message
  FROM public.communication_messages AS message_record
  WHERE message_record.id = p_message_id
  FOR UPDATE;

  IF NOT FOUND OR v_message.status <> 'SENDING'
    OR v_message.lease_owner IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'delivery job lease is invalid'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  v_retry := p_retryable AND v_message.attempts < v_message.max_attempts;
  v_delay_seconds := LEAST(
    3600,
    30 * pg_catalog.power(2, GREATEST(v_message.attempts - 1, 0))::integer
  );

  UPDATE public.communication_messages
  SET status = CASE WHEN v_retry THEN 'QUEUED' ELSE 'FAILED' END,
      next_attempt_at = CASE
        WHEN v_retry THEN v_now + pg_catalog.make_interval(secs => v_delay_seconds)
        ELSE next_attempt_at
      END,
      failed_at = CASE WHEN v_retry THEN NULL ELSE v_now END,
      failure_code = pg_catalog.left(pg_catalog.btrim(p_error_code), 120),
      failure_detail = pg_catalog.left(pg_catalog.btrim(p_error_detail), 1000),
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
  WHERE id = v_message.id
  RETURNING * INTO v_message;

  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, occurred_at, payload
  )
  VALUES (
    v_message.organisation_id, v_message.id, 'FAILED', v_now,
    jsonb_build_object(
      'errorCode', v_message.failure_code,
      'retryable', v_retry,
      'attempt', v_message.attempts
    )
  );

  IF NOT v_retry THEN
    UPDATE public.communication_reminders
    SET status = 'FAILED',
        failure_code = v_message.failure_code,
        failure_detail = v_message.failure_detail,
        updated_at = v_now
    WHERE message_id = v_message.id AND status = 'PROCESSING';
  END IF;

  RETURN QUERY
  SELECT v_message.id, v_message.status::text, v_message.next_attempt_at;
END
$function$;

CREATE OR REPLACE FUNCTION private.record_communication_delivery_event(
  p_provider text,
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type public.communication_delivery_event_type,
  p_occurred_at timestamptz,
  p_payload jsonb
)
RETURNS TABLE (message_id uuid, message_status text, recorded boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_message public.communication_messages%ROWTYPE;
  v_inserted_id uuid;
  v_occurred timestamptz := COALESCE(p_occurred_at, pg_catalog.now());
BEGIN
  IF p_provider_event_id IS NULL OR pg_catalog.char_length(p_provider_event_id) > 240
    OR p_provider_message_id IS NULL OR pg_catalog.char_length(p_provider_message_id) > 240
    OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
    OR pg_column_size(p_payload) > 32768 THEN
    RAISE EXCEPTION 'delivery event input is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT message_record.*
  INTO v_message
  FROM public.communication_messages AS message_record
  WHERE message_record.provider = pg_catalog.lower(pg_catalog.btrim(p_provider))
    AND message_record.provider_message_id = p_provider_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider message was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.communication_delivery_events (
    organisation_id, message_id, event_type, provider,
    provider_event_id, occurred_at, payload
  )
  VALUES (
    v_message.organisation_id, v_message.id, p_event_type,
    v_message.provider, p_provider_event_id, v_occurred, p_payload
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RETURN QUERY SELECT v_message.id, v_message.status::text, false;
    RETURN;
  END IF;

  IF p_event_type = 'DELIVERED' AND v_message.status IN ('SENT', 'SENDING') THEN
    UPDATE public.communication_messages
    SET status = 'DELIVERED',
        delivered_at = v_occurred,
        updated_at = pg_catalog.now()
    WHERE id = v_message.id
    RETURNING * INTO v_message;
  ELSIF p_event_type IN ('BOUNCED', 'COMPLAINED', 'FAILED')
    AND v_message.status NOT IN ('READ', 'CANCELLED') THEN
    UPDATE public.communication_messages
    SET status = 'FAILED',
        failed_at = v_occurred,
        failure_code = 'PROVIDER_' || p_event_type::text,
        failure_detail = 'Provider reported ' || pg_catalog.lower(p_event_type::text) || '.',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_message.id
    RETURNING * INTO v_message;
  END IF;

  RETURN QUERY SELECT v_message.id, v_message.status::text, true;
END
$function$;

ALTER FUNCTION private.accept_client_portal_invitation(text) OWNER TO postgres;
ALTER FUNCTION private.revoke_client_portal_access(uuid, text) OWNER TO postgres;
ALTER FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) OWNER TO postgres;
ALTER FUNCTION private.post_client_portal_message(uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION private.publish_client_portal_update(
  uuid, text, text, text, integer
) OWNER TO postgres;
ALTER FUNCTION private.register_client_portal_document_upload(
  uuid, text, text, bigint, text
) OWNER TO postgres;
ALTER FUNCTION private.finalise_client_portal_document_upload(uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION private.mark_client_notification_read(uuid) OWNER TO postgres;
ALTER FUNCTION private.get_client_portal_dashboard() OWNER TO postgres;
ALTER FUNCTION private.materialise_due_communication_reminders(integer)
  OWNER TO postgres;
ALTER FUNCTION private.claim_communication_delivery_job(text, integer)
  OWNER TO postgres;
ALTER FUNCTION private.complete_communication_delivery_job(
  uuid, text, text, text
) OWNER TO postgres;
ALTER FUNCTION private.fail_communication_delivery_job(
  uuid, text, text, text, boolean
) OWNER TO postgres;
ALTER FUNCTION private.record_communication_delivery_event(
  text, text, text, public.communication_delivery_event_type,
  timestamptz, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.accept_client_portal_invitation(text)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.revoke_client_portal_access(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.post_client_portal_message(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.publish_client_portal_update(
  uuid, text, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.register_client_portal_document_upload(
  uuid, text, text, bigint, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.finalise_client_portal_document_upload(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.mark_client_notification_read(uuid)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.get_client_portal_dashboard()
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.materialise_due_communication_reminders(integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.claim_communication_delivery_job(text, integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.complete_communication_delivery_job(
  uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.fail_communication_delivery_job(
  uuid, text, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;
REVOKE ALL ON FUNCTION private.record_communication_delivery_event(
  text, text, text, public.communication_delivery_event_type,
  timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.accept_client_portal_invitation(text)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.revoke_client_portal_access(uuid, text)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.post_client_portal_message(uuid, text, text)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.publish_client_portal_update(
  uuid, text, text, text, integer
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.register_client_portal_document_upload(
  uuid, text, text, bigint, text
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.finalise_client_portal_document_upload(uuid, uuid)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.mark_client_notification_read(uuid)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.get_client_portal_dashboard()
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.materialise_due_communication_reminders(integer)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.claim_communication_delivery_job(text, integer)
  TO businessos_app;
GRANT EXECUTE ON FUNCTION private.complete_communication_delivery_job(
  uuid, text, text, text
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.fail_communication_delivery_job(
  uuid, text, text, text, boolean
) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.record_communication_delivery_event(
  text, text, text, public.communication_delivery_event_type,
  timestamptz, jsonb
) TO businessos_app;

COMMIT;
