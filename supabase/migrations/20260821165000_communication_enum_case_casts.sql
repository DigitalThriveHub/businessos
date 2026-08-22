-- Correct conditional enum assignments in the communication pipeline.

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
    $old$WHEN v_conversation.channel = 'PORTAL' THEN 'DELIVERED'
      ELSE 'QUEUED'$old$,
    $new$WHEN v_conversation.channel = 'PORTAL'
        THEN 'DELIVERED'::public.communication_message_status
      ELSE 'QUEUED'::public.communication_message_status$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'staff message status CASE expression was not found';
  END IF;

  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE
        WHEN v_message.channel = 'PORTAL'
          THEN 'DELIVERED'::public.communication_delivery_event_type
        ELSE 'QUEUED'::public.communication_delivery_event_type
      END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'staff delivery event CASE expression was not found';
  END IF;

  EXECUTE patched_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'private.materialise_due_communication_reminders(integer)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_reminder.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE
        WHEN v_reminder.channel = 'PORTAL'
          THEN 'DELIVERED'::public.communication_message_status
        ELSE 'QUEUED'::public.communication_message_status
      END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'reminder message status CASE expression was not found';
  END IF;

  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$WHEN v_message.channel = 'PORTAL' THEN 'SENT'
          ELSE 'PROCESSING'$old$,
    $new$WHEN v_message.channel = 'PORTAL'
            THEN 'SENT'::public.communication_reminder_status
          ELSE 'PROCESSING'::public.communication_reminder_status$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'reminder lifecycle status CASE expression was not found';
  END IF;

  function_definition := patched_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_message.channel = 'PORTAL' THEN 'DELIVERED' ELSE 'QUEUED' END,$old$,
    $new$CASE
        WHEN v_message.channel = 'PORTAL'
          THEN 'DELIVERED'::public.communication_delivery_event_type
        ELSE 'QUEUED'::public.communication_delivery_event_type
      END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'reminder delivery event CASE expression was not found';
  END IF;

  EXECUTE patched_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'private.fail_communication_delivery_job(uuid,text,text,text,boolean)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  patched_definition := pg_catalog.replace(
    function_definition,
    $old$CASE WHEN v_retry THEN 'QUEUED' ELSE 'FAILED' END,$old$,
    $new$CASE
        WHEN v_retry THEN 'QUEUED'::public.communication_message_status
        ELSE 'FAILED'::public.communication_message_status
      END,$new$
  );

  IF patched_definition = function_definition THEN
    RAISE EXCEPTION 'delivery retry status CASE expression was not found';
  END IF;

  EXECUTE patched_definition;
END
$migration$;

ALTER FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) OWNER TO postgres;

ALTER FUNCTION private.materialise_due_communication_reminders(integer)
  OWNER TO postgres;

ALTER FUNCTION private.fail_communication_delivery_job(
  uuid, text, text, text, boolean
) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

REVOKE ALL ON FUNCTION private.materialise_due_communication_reminders(integer)
  FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

REVOKE ALL ON FUNCTION private.fail_communication_delivery_job(
  uuid, text, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role, businessos_policy_reader;

GRANT EXECUTE ON FUNCTION private.create_staff_communication_message(
  uuid, text, text, text[], timestamptz, text
) TO businessos_app;

GRANT EXECUTE ON FUNCTION private.materialise_due_communication_reminders(integer)
  TO businessos_app;

GRANT EXECUTE ON FUNCTION private.fail_communication_delivery_job(
  uuid, text, text, text, boolean
) TO businessos_app;