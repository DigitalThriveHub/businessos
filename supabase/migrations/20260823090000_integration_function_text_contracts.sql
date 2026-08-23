-- Gate F hotfix: PostgreSQL requires RETURNS TABLE values to match the
-- declared scalar types exactly. Integration display/reference columns are
-- varchar in storage but text at the private API boundary.

BEGIN;

CREATE OR REPLACE FUNCTION private.create_integration_connection(
  p_provider public.integration_provider,
  p_display_name text,
  p_external_account_reference text
)
RETURNS TABLE (
  id uuid, organisation_id uuid, provider text, display_name text,
  status text, external_account_reference text, secret_version integer,
  version integer, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
  v_connection uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.integration_connections (
    id, organisation_id, provider, display_name,
    external_account_reference, created_by_user_id, updated_by_user_id
  ) VALUES (
    v_connection, v_org, p_provider, btrim(p_display_name),
    NULLIF(btrim(p_external_account_reference), ''), v_user, v_user
  );

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'integration.connection.created', 'integration_connection',
    v_connection::text, 'SUCCESS',
    jsonb_build_object('provider', p_provider, 'displayName', btrim(p_display_name))
  );

  RETURN QUERY
  SELECT connection.id, connection.organisation_id,
    connection.provider::text, connection.display_name::text,
    connection.status::text, connection.external_account_reference::text,
    connection.secret_version, connection.version, connection.created_at
  FROM public.integration_connections AS connection
  WHERE connection.id = v_connection AND connection.organisation_id = v_org;
END
$function$;

CREATE OR REPLACE FUNCTION private.set_integration_connection_status(
  p_connection_id uuid,
  p_status public.integration_connection_status,
  p_expected_version integer
)
RETURNS TABLE (
  id uuid, organisation_id uuid, provider text, display_name text,
  status text, external_account_reference text, secret_version integer,
  version integer, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  UPDATE public.integration_connections AS connection
  SET status = p_status, updated_by_user_id = v_user,
      version = connection.version + 1, updated_at = pg_catalog.now()
  WHERE connection.id = p_connection_id
    AND connection.organisation_id = v_org
    AND connection.version = p_expected_version
  RETURNING connection.id, connection.organisation_id,
    connection.provider::text, connection.display_name::text,
    connection.status::text, connection.external_account_reference::text,
    connection.secret_version, connection.version, connection.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration connection changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'integration.connection.status_changed', 'integration_connection',
    p_connection_id::text, 'SUCCESS', jsonb_build_object('status', p_status)
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.rotate_integration_connection_secret(
  p_connection_id uuid,
  p_expected_version integer
)
RETURNS TABLE (
  id uuid, organisation_id uuid, provider text, display_name text,
  status text, secret_version integer, version integer, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_org uuid := private.current_organisation_id();
  v_user uuid := private.current_user_id();
BEGIN
  IF v_org IS NULL OR v_user IS NULL
     OR NOT private.has_organisation_permission(v_org, 'integrations.manage')
     OR private.current_aal() <> 'AAL2' THEN
    RAISE EXCEPTION 'AAL2 integration management permission is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  UPDATE public.integration_connections AS connection
  SET secret_version = connection.secret_version + 1,
      updated_by_user_id = v_user, version = connection.version + 1,
      updated_at = pg_catalog.now()
  WHERE connection.id = p_connection_id
    AND connection.organisation_id = v_org
    AND connection.provider IN ('WORDPRESS', 'GENERIC')
    AND connection.version = p_expected_version
  RETURNING connection.id, connection.organisation_id,
    connection.provider::text, connection.display_name::text,
    connection.status::text, connection.secret_version,
    connection.version, connection.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration connection changed or is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  INSERT INTO public.audit_events (
    id, organisation_id, actor_type, actor_user_profile_id, source, action,
    resource_type, resource_id, outcome, metadata
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_org, 'USER', v_user, 'businessos-api',
    'integration.connection.secret_rotated', 'integration_connection',
    p_connection_id::text, 'SUCCESS', '{}'::jsonb
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.get_integration_ingress_context(
  p_connection_id uuid
)
RETURNS TABLE (
  organisation_id uuid, provider text, display_name text,
  secret_version integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  SELECT connection.organisation_id, connection.provider::text,
    connection.display_name::text, connection.secret_version
  FROM public.integration_connections AS connection
  JOIN public.organisations AS organisation
    ON organisation.id = connection.organisation_id
   AND organisation.status = 'ACTIVE'
   AND organisation.deleted_at IS NULL
  WHERE connection.id = p_connection_id
    AND connection.status = 'ACTIVE'
    AND connection.provider IN ('WORDPRESS', 'GENERIC')
$function$;

REVOKE ALL ON FUNCTION
  private.create_integration_connection(public.integration_provider, text, text),
  private.set_integration_connection_status(uuid, public.integration_connection_status, integer),
  private.rotate_integration_connection_secret(uuid, integer),
  private.get_integration_ingress_context(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  private.create_integration_connection(public.integration_provider, text, text),
  private.set_integration_connection_status(uuid, public.integration_connection_status, integer),
  private.rotate_integration_connection_secret(uuid, integer),
  private.get_integration_ingress_context(uuid)
  TO businessos_app;

COMMIT;
