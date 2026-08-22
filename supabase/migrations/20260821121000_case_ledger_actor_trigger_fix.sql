-- Repair the shared append-only case-ledger actor trigger.
-- PostgreSQL resolves record fields before CASE selection, so accessing
-- table-specific NEW fields directly caused matter creation to fail.

CREATE OR REPLACE FUNCTION private.validate_case_ledger_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_column text;
  actor_id uuid;
  organisation_id uuid;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION 'unsupported case ledger table: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  actor_column := CASE TG_TABLE_NAME
    WHEN 'matter_status_history' THEN 'changed_by_user_id'
    WHEN 'enquiry_conversions' THEN 'converted_by_user_id'
    ELSE NULL
  END;

  IF actor_column IS NULL THEN
    RAISE EXCEPTION 'unsupported case ledger table: %.%',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  actor_id := NULLIF(
    pg_catalog.to_jsonb(NEW) ->> actor_column,
    ''
  )::uuid;

  organisation_id := NULLIF(
    pg_catalog.to_jsonb(NEW) ->> 'organisation_id',
    ''
  )::uuid;

  PERFORM private.assert_active_organisation_user(
    organisation_id,
    actor_id,
    'ledger actor'
  );

  IF actor_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'ledger actor must match the authenticated actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.validate_case_ledger_actor()
  OWNER TO businessos_policy_reader;

REVOKE ALL ON FUNCTION private.validate_case_ledger_actor() FROM PUBLIC;