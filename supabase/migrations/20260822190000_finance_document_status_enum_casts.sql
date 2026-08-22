-- PostgreSQL resolves CASE string literals as text. Explicitly cast every
-- conditional finance document status assignment back to the enum type.

DO $migration$
DECLARE
  function_definition text;
  previous_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'private.issue_finance_document(uuid,integer)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  previous_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    $old$status = CASE document_type WHEN 'CREDIT_NOTE' THEN 'PAID' ELSE 'ISSUED' END,$old$,
    $new$status = (CASE document_type WHEN 'CREDIT_NOTE' THEN 'PAID' ELSE 'ISSUED' END)::public.finance_document_status,$new$
  );
  IF function_definition = previous_definition THEN
    RAISE EXCEPTION 'issue function primary status expression was not found';
  END IF;

  previous_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    $old$status = CASE
          WHEN balance_minor - document_record.total_minor = 0 THEN 'PAID'
          WHEN allocated_minor > 0 OR credited_minor + document_record.total_minor > 0
            THEN 'PARTIALLY_PAID'
          ELSE 'ISSUED'
        END,$old$,
    $new$status = (CASE
          WHEN balance_minor - document_record.total_minor = 0 THEN 'PAID'
          WHEN allocated_minor > 0 OR credited_minor + document_record.total_minor > 0
            THEN 'PARTIALLY_PAID'
          ELSE 'ISSUED'
        END)::public.finance_document_status,$new$
  );
  IF function_definition = previous_definition THEN
    RAISE EXCEPTION 'issue function balance status expression was not found';
  END IF;

  EXECUTE function_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'private.void_finance_document(uuid,integer,text)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  previous_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    $old$status = CASE
          WHEN allocated_minor = 0 AND credited_minor - document_record.total_minor = 0
            THEN 'ISSUED'
          ELSE 'PARTIALLY_PAID'
        END,$old$,
    $new$status = (CASE
          WHEN allocated_minor = 0 AND credited_minor - document_record.total_minor = 0
            THEN 'ISSUED'
          ELSE 'PARTIALLY_PAID'
        END)::public.finance_document_status,$new$
  );
  IF function_definition = previous_definition THEN
    RAISE EXCEPTION 'void function status expression was not found';
  END IF;

  EXECUTE function_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'private.record_finance_payment(jsonb)'::pg_catalog.regprocedure
  )
  INTO function_definition;

  previous_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    $old$status = CASE
            WHEN balance_minor - (v_allocation ->> 'amountMinor')::bigint = 0
              THEN 'PAID'
            ELSE 'PARTIALLY_PAID'
          END,$old$,
    $new$status = (CASE
            WHEN balance_minor - (v_allocation ->> 'amountMinor')::bigint = 0
              THEN 'PAID'
            ELSE 'PARTIALLY_PAID'
          END)::public.finance_document_status,$new$
  );
  IF function_definition = previous_definition THEN
    RAISE EXCEPTION 'receipt allocation status expression was not found';
  END IF;

  previous_definition := function_definition;
  function_definition := pg_catalog.replace(
    function_definition,
    $old$status = CASE
            WHEN allocated_minor - (v_allocation ->> 'amountMinor')::bigint = 0
              AND credited_minor = 0 THEN 'ISSUED'
            ELSE 'PARTIALLY_PAID'
          END,$old$,
    $new$status = (CASE
            WHEN allocated_minor - (v_allocation ->> 'amountMinor')::bigint = 0
              AND credited_minor = 0 THEN 'ISSUED'
            ELSE 'PARTIALLY_PAID'
          END)::public.finance_document_status,$new$
  );
  IF function_definition = previous_definition THEN
    RAISE EXCEPTION 'refund allocation status expression was not found';
  END IF;

  EXECUTE function_definition;
END
$migration$;

COMMENT ON FUNCTION private.issue_finance_document(uuid, integer) IS
  'Issues a finance document with enum-safe lifecycle transitions and balanced journal evidence.';
COMMENT ON FUNCTION private.void_finance_document(uuid, integer, text) IS
  'Voids an eligible finance document and posts reversal evidence using enum-safe lifecycle transitions.';
COMMENT ON FUNCTION private.record_finance_payment(jsonb) IS
  'Records idempotent receipts or refunds, allocations and balanced journals using enum-safe lifecycle transitions.';
