-- Gate H: PostgreSQL has no min(uuid) aggregate. Preserve deterministic
-- single-client matching by ordering the UUID textual representation and
-- casting the selected value back to uuid.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

DO $migration$
DECLARE
  v_signature regprocedure :=
    'private.record_external_communication(uuid,text,text,public.business_communication_channel,text,text,text,text[],text,text,timestamptz)'::regprocedure;
  v_definition text;
  v_replacements integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  v_replacements := (
    char_length(v_definition)
    - char_length(replace(v_definition, 'min(client_record.id)', ''))
  ) / char_length('min(client_record.id)');

  IF v_replacements <> 2 THEN
    RAISE EXCEPTION 'unexpected external communication function contract: expected 2 UUID aggregate replacements, found %',
      v_replacements;
  END IF;

  v_definition := replace(
    v_definition,
    'min(client_record.id)',
    'min(client_record.id::text)::uuid'
  );

  EXECUTE v_definition;
END
$migration$;

COMMIT;
