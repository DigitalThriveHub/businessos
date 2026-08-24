-- Gate H: make the external communication insert explicit at PostgreSQL enum
-- and constrained-array boundaries. CASE expressions otherwise resolve to
-- text, and function parameters retain their declared text[] type.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

DO $migration$
DECLARE
  v_signature regprocedure :=
    'private.record_external_communication(uuid,text,text,public.business_communication_channel,text,text,text,text[],text,text,timestamptz)'::regprocedure;
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF strpos(
    v_definition,
    'CASE WHEN v_client IS NULL THEN ''SYSTEM'' ELSE ''CLIENT'' END'
  ) = 0 THEN
    RAISE EXCEPTION 'external communication actor expression was not found';
  END IF;

  IF strpos(v_definition, 'COALESCE(p_recipients, ''{}'')') = 0 THEN
    RAISE EXCEPTION 'external communication recipient expression was not found';
  END IF;

  v_definition := replace(
    v_definition,
    'CASE WHEN v_client IS NULL THEN ''SYSTEM'' ELSE ''CLIENT'' END',
    '(CASE WHEN v_client IS NULL THEN ''SYSTEM'' ELSE ''CLIENT'' END)::public.communication_actor_type'
  );

  v_definition := replace(
    v_definition,
    'COALESCE(p_recipients, ''{}'')',
    'COALESCE(p_recipients, ''{}'')::varchar(320)[]'
  );

  EXECUTE v_definition;
END
$migration$;

COMMIT;
