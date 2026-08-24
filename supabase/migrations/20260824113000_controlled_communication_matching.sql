-- Gate H: resolve unmatched external messages through the established
-- matter_parties relationship and permit only an audited, one-way match to
-- populate previously-null communication links.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

CREATE OR REPLACE FUNCTION private.enforce_matched_communication_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_column text;
  v_immutable_columns text[];
BEGIN
  IF TG_TABLE_NAME = 'communication_messages' THEN
    v_immutable_columns := ARRAY[
      'id','organisation_id','conversation_id','channel','direction','actor_type',
      'author_user_profile_id','sender_address','recipient_addresses','subject',
      'body_text','client_visible','approval_request_id','idempotency_key','created_at'
    ];
  ELSE
    v_immutable_columns := ARRAY[
      'id','organisation_id','channel','created_by_user_id','created_at'
    ];
  END IF;

  FOREACH v_column IN ARRAY v_immutable_columns LOOP
    IF (to_jsonb(OLD) -> v_column) IS DISTINCT FROM (to_jsonb(NEW) -> v_column) THEN
      RAISE EXCEPTION 'security-boundary column %.% is immutable', TG_TABLE_NAME, v_column
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;

  IF OLD.client_id IS DISTINCT FROM NEW.client_id
     OR OLD.matter_id IS DISTINCT FROM NEW.matter_id THEN
    IF OLD.client_id IS NOT NULL OR OLD.matter_id IS NOT NULL OR NEW.client_id IS NULL THEN
      RAISE EXCEPTION 'communication links permit only one audited initial match'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_TABLE_NAME = 'communication_messages' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.communication_match_queue AS match_record
        WHERE match_record.organisation_id = NEW.organisation_id
          AND match_record.message_id = NEW.id
          AND match_record.status = 'MATCHED'
          AND match_record.matched_client_id = NEW.client_id
          AND match_record.matched_matter_id IS NOT DISTINCT FROM NEW.matter_id
          AND match_record.reviewed_by_user_id IS NOT NULL
          AND match_record.reviewed_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'message link requires a completed matching decision'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.communication_messages AS message_record
        JOIN public.communication_match_queue AS match_record
          ON match_record.organisation_id = message_record.organisation_id
         AND match_record.message_id = message_record.id
         AND match_record.status = 'MATCHED'
        WHERE message_record.organisation_id = NEW.organisation_id
          AND message_record.conversation_id = NEW.id
          AND message_record.client_id = NEW.client_id
          AND message_record.matter_id IS NOT DISTINCT FROM NEW.matter_id
          AND match_record.matched_client_id = NEW.client_id
          AND match_record.matched_matter_id IS NOT DISTINCT FROM NEW.matter_id
      ) THEN
        RAISE EXCEPTION 'conversation link requires a completed message match'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_matched_communication_links() FROM PUBLIC;

DROP TRIGGER conversations_immutable ON public.communication_conversations;
CREATE TRIGGER conversations_immutable
  BEFORE UPDATE ON public.communication_conversations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_matched_communication_links();

DROP TRIGGER messages_immutable ON public.communication_messages;
CREATE TRIGGER messages_immutable
  BEFORE UPDATE ON public.communication_messages
  FOR EACH ROW EXECUTE FUNCTION private.enforce_matched_communication_links();

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
    SELECT 1 FROM public.clients AS client_record
    WHERE client_record.id = p_client_id AND client_record.organisation_id = v_org
      AND client_record.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'client is unavailable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_matter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.matters AS matter_record
    JOIN public.matter_parties AS party_record
      ON party_record.organisation_id = matter_record.organisation_id
     AND party_record.matter_id = matter_record.id
     AND party_record.client_id = p_client_id
     AND party_record.deleted_at IS NULL
    WHERE matter_record.id = p_matter_id
      AND matter_record.organisation_id = v_org
      AND matter_record.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'matter is unavailable for client' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT queue_record.message_id INTO v_message
  FROM public.communication_match_queue AS queue_record
  WHERE queue_record.id = p_queue_id AND queue_record.organisation_id = v_org
    AND queue_record.status IN ('UNMATCHED','SUGGESTED')
    AND queue_record.version = p_expected_version
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'matching item changed or is unavailable' USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public.communication_match_queue AS queue_record
  SET status = CASE WHEN p_action = 'MATCH' THEN 'MATCHED'::public.communication_match_status
                    ELSE 'DISMISSED'::public.communication_match_status END,
      matched_client_id = p_client_id, matched_matter_id = p_matter_id,
      reviewed_by_user_id = v_user, review_reason = btrim(p_reason),
      reviewed_at = pg_catalog.now(), version = queue_record.version + 1,
      updated_at = pg_catalog.now()
  WHERE queue_record.id = p_queue_id AND queue_record.organisation_id = v_org;

  IF p_action = 'MATCH' THEN
    UPDATE public.communication_messages
    SET client_id = p_client_id, matter_id = p_matter_id,
      updated_at = pg_catalog.now()
    WHERE id = v_message AND organisation_id = v_org;

    UPDATE public.communication_conversations AS conversation
    SET client_id = p_client_id, matter_id = p_matter_id,
      version = conversation.version + 1, updated_at = pg_catalog.now()
    FROM public.communication_messages AS message_record
    WHERE message_record.id = v_message AND message_record.organisation_id = v_org
      AND conversation.id = message_record.conversation_id
      AND conversation.organisation_id = v_org;
  END IF;

  INSERT INTO public.audit_events(
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    CASE WHEN p_action = 'MATCH' THEN 'communication.match.confirmed' ELSE 'communication.match.dismissed' END,
    'communication_match_queue', p_queue_id::text, 'SUCCESS',
    jsonb_build_object('messageId', v_message, 'clientId', p_client_id, 'matterId', p_matter_id)
  );

  RETURN QUERY
  SELECT queue_record.*
  FROM public.communication_match_queue AS queue_record
  WHERE queue_record.id = p_queue_id AND queue_record.organisation_id = v_org;
END
$function$;

REVOKE ALL ON FUNCTION private.resolve_communication_match(uuid,text,uuid,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.resolve_communication_match(uuid,text,uuid,uuid,text,integer)
  TO businessos_app;

COMMIT;
