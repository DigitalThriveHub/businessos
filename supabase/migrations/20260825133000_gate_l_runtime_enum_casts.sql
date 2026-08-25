-- Gate L runtime repair: restore explicit enum casts after the Gate L
-- communication functions replaced earlier cast-safe definitions.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

DO $migration$
DECLARE
  function_definition text;
  patched_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'private.create_staff_communication_message(uuid,text,text,text[],timestamptz,text)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_conversation.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE WHEN v_conversation.channel = 'PORTAL'
      THEN 'DELIVERED'::public.communication_message_status
      ELSE 'QUEUED'::public.communication_message_status END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Gate L staff message status CASE expression was not found';
  END IF;

  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE WHEN v_message.channel = 'PORTAL'
      THEN 'DELIVERED'::public.communication_delivery_event_type
      ELSE 'QUEUED'::public.communication_delivery_event_type END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Gate L staff delivery event CASE expression was not found';
  END IF;

  EXECUTE patched_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'private.materialise_due_communication_reminders(integer)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_reminder.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE WHEN v_reminder.channel = 'PORTAL'
      THEN 'DELIVERED'::public.communication_message_status
      ELSE 'QUEUED'::public.communication_message_status END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Gate L reminder message status CASE expression was not found';
  END IF;

  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$status = CASE WHEN v_message.channel = 'PORTAL' THEN 'SENT' ELSE 'PROCESSING' END,$old$,
    $new$status = CASE WHEN v_message.channel = 'PORTAL'
        THEN 'SENT'::public.communication_reminder_status
        ELSE 'PROCESSING'::public.communication_reminder_status END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Gate L reminder lifecycle CASE expression was not found';
  END IF;

  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE WHEN v_message.channel = 'PORTAL'
      THEN 'DELIVERED'::public.communication_delivery_event_type
      ELSE 'QUEUED'::public.communication_delivery_event_type END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'Gate L reminder delivery event CASE expression was not found';
  END IF;

  EXECUTE patched_definition;
END;
$migration$;

ALTER FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) OWNER TO postgres;

ALTER FUNCTION private.materialise_due_communication_reminders(integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

REVOKE ALL ON FUNCTION private.materialise_due_communication_reminders(integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) TO businessos_app;

GRANT EXECUTE ON FUNCTION private.materialise_due_communication_reminders(integer)
  TO businessos_app;

COMMENT ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) IS 'Creates an audited staff communication with enum-safe delivery state.';

COMMENT ON FUNCTION private.materialise_due_communication_reminders(integer)
  IS 'Materialises due reminders with enum-safe message, reminder and delivery state.';

COMMIT;
