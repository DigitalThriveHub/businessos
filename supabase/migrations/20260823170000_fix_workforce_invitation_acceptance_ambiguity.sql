-- Qualify the onboarding-plan organisation column inside the workforce
-- invitation acceptance function.  The function returns an output column
-- named organisation_id, so the previously unqualified table column was
-- ambiguous in PL/pgSQL (SQLSTATE 42702).

BEGIN;

DO $migration$
DECLARE
  function_definition text;
  corrected_definition text;
  ambiguous_expression constant text :=
    'AND organisation_id = v_plan.organisation_id';
  qualified_expression constant text :=
    'AND invitation_onboarding_plans.organisation_id = v_plan.organisation_id';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'private.accept_organisation_invitation(text)'::regprocedure
  )
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION
      'private.accept_organisation_invitation(text) does not exist';
  END IF;

  IF pg_catalog.strpos(function_definition, ambiguous_expression) = 0 THEN
    IF pg_catalog.strpos(function_definition, qualified_expression) > 0 THEN
      RETURN;
    END IF;

    RAISE EXCEPTION
      'Expected ambiguous invitation acceptance expression was not found';
  END IF;

  corrected_definition := pg_catalog.replace(
    function_definition,
    ambiguous_expression,
    qualified_expression
  );

  EXECUTE corrected_definition;
END
$migration$;

COMMIT;
