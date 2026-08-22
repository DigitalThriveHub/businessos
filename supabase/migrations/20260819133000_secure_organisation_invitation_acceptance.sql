-- Secure, atomic organisation invitation acceptance.
--
-- The caller must be an authenticated BusinessOS API user. The function:
-- - derives the identity from the transaction context;
-- - reads the verified email from auth.users;
-- - locates the invitation only by its HMAC-SHA256 token hash;
-- - locks and revalidates the invitation, organisation, roles and membership;
-- - creates or activates the membership and role assignments;
-- - marks the invitation accepted and appends an audit event atomically.

BEGIN;

CREATE OR REPLACE FUNCTION private.accept_organisation_invitation(
  p_token_hash text
)
RETURNS TABLE (
  invitation_id uuid,
  organisation_id uuid,
  organisation_name text,
  organisation_slug text,
  membership_id uuid,
  invitation_status text,
  role_keys text[],
  job_title text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_auth_email text;
  v_now timestamptz := pg_catalog.clock_timestamp();

  v_invitation public.invitations%ROWTYPE;
  v_organisation public.organisations%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_membership public.organisation_memberships%ROWTYPE;

  v_metadata jsonb;
  v_role_keys text[];
  v_job_title text;
  v_role_key_count bigint;
  v_distinct_role_key_count bigint;
  v_resolved_role_count bigint;
  v_effective_assignment_count bigint;
BEGIN
  v_user_id := private.current_user_id();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL
    OR p_token_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Invitation token hash is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.lower(
    pg_catalog.btrim(auth_user.email)
  )
  INTO v_auth_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_user_id
    AND auth_user.email IS NOT NULL
    AND pg_catalog.btrim(auth_user.email) <> ''
    AND auth_user.email_confirmed_at IS NOT NULL;

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'A verified email identity is required'
      USING ERRCODE = '42501';
  END IF;

  -- Serialise concurrent membership/bootstrap/invitation
  -- operations for the same authenticated identity.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text,
      0
    )
  );

  SELECT invitation_record.*
  INTO v_invitation
  FROM public.invitations AS invitation_record
  WHERE invitation_record.token_hash =
      p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF v_invitation.status <>
      'PENDING'::public.invitation_status
  THEN
    RAISE EXCEPTION 'Invitation is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  IF v_invitation.deleted_at IS NOT NULL
    OR v_invitation.expires_at <= v_now
  THEN
    RAISE EXCEPTION 'Invitation is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.lower(
    pg_catalog.btrim(v_invitation.email)
  ) <> v_auth_email THEN
    RAISE EXCEPTION 'Invitation identity does not match'
      USING ERRCODE = '42501';
  END IF;

  SELECT organisation_record.*
  INTO v_organisation
  FROM public.organisations AS organisation_record
  WHERE organisation_record.id =
      v_invitation.organisation_id
    AND organisation_record.status =
      'ACTIVE'::public.organisation_status
    AND organisation_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_metadata := COALESCE(
    v_invitation.metadata,
    '{}'::jsonb
  );

  IF pg_catalog.jsonb_typeof(v_metadata) <>
      'object'
    OR NOT (v_metadata ? 'roleKeys')
    OR pg_catalog.jsonb_typeof(
      v_metadata -> 'roleKeys'
    ) <> 'array'
  THEN
    RAISE EXCEPTION 'Invitation role metadata is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      v_metadata -> 'roleKeys'
    ) AS role_element(value)
    WHERE pg_catalog.jsonb_typeof(
      role_element.value
    ) <> 'string'
  ) THEN
    RAISE EXCEPTION 'Invitation role metadata is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.array_agg(
      pg_catalog.btrim(role_key.value)
      ORDER BY pg_catalog.btrim(
        role_key.value
      )
    ),
    pg_catalog.count(*),
    pg_catalog.count(
      DISTINCT pg_catalog.btrim(
        role_key.value
      )
    )
  INTO
    v_role_keys,
    v_role_key_count,
    v_distinct_role_key_count
  FROM pg_catalog.jsonb_array_elements_text(
    v_metadata -> 'roleKeys'
  ) AS role_key(value);

  IF v_role_key_count NOT BETWEEN 1 AND 8
    OR v_distinct_role_key_count <>
      v_role_key_count
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_role_keys)
        AS role_key(value)
      WHERE role_key.value !~
        '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    )
  THEN
    RAISE EXCEPTION 'Invitation role metadata is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_metadata ? 'jobTitle' THEN
    IF pg_catalog.jsonb_typeof(
      v_metadata -> 'jobTitle'
    ) <> 'string' THEN
      RAISE EXCEPTION 'Invitation job title is invalid'
        USING ERRCODE = '22023';
    END IF;

    v_job_title := NULLIF(
      pg_catalog.btrim(
        v_metadata ->> 'jobTitle'
      ),
      ''
    );

    IF pg_catalog.char_length(
      COALESCE(v_job_title, '')
    ) > 120
      OR v_job_title ~ '[[:cntrl:]]'
    THEN
      RAISE EXCEPTION 'Invitation job title is invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_job_title := NULL;
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_resolved_role_count
  FROM public.roles AS role_record
  WHERE role_record.organisation_id =
      v_invitation.organisation_id
    AND role_record.key = ANY(v_role_keys)
    AND role_record.scope =
      'ORGANISATION'::public.role_scope
    AND role_record.is_assignable = true
    AND role_record.key <>
      'organisation_owner'
    AND role_record.deleted_at IS NULL;

  IF v_resolved_role_count <>
      v_role_key_count
  THEN
    RAISE EXCEPTION 'Invitation contains unavailable roles'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile_record.*
  INTO v_profile
  FROM public.user_profiles AS profile_record
  WHERE profile_record.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.user_profiles (
      id,
      email,
      status,
      locale,
      timezone,
      is_platform_user,
      created_at,
      updated_at
    )
    VALUES (
      v_user_id,
      v_auth_email,
      'ACTIVE'::public.user_profile_status,
      v_organisation.locale,
      v_organisation.timezone,
      false,
      v_now,
      v_now
    )
    RETURNING *
    INTO v_profile;
  ELSE
    IF v_profile.status <>
        'ACTIVE'::public.user_profile_status
      OR v_profile.deleted_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'User profile is unavailable'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.user_profiles
    SET
      email = v_auth_email,
      updated_at = v_now
    WHERE id = v_user_id
    RETURNING *
    INTO v_profile;
  END IF;

  SELECT membership_record.*
  INTO v_membership
  FROM public.organisation_memberships
    AS membership_record
  WHERE membership_record.organisation_id =
      v_invitation.organisation_id
    AND membership_record.user_profile_id =
      v_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_membership.status <>
        'INVITED'::public.membership_status
      OR v_membership.deleted_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'Organisation membership already exists'
        USING ERRCODE = '55000';
    END IF;

    -- Never activate unexpected pre-provisioned privileges.
    IF EXISTS (
      SELECT 1
      FROM public.role_assignments
        AS existing_assignment
      JOIN public.roles AS existing_role
        ON existing_role.id =
          existing_assignment.role_id
      WHERE existing_assignment.organisation_id =
          v_invitation.organisation_id
        AND existing_assignment.organisation_membership_id =
          v_membership.id
        AND existing_assignment.user_profile_id =
          v_user_id
        AND existing_assignment.revoked_at IS NULL
        AND existing_assignment.deleted_at IS NULL
        AND (
          existing_assignment.valid_until IS NULL
          OR existing_assignment.valid_until >
            v_now
        )
        AND (
          NOT (
            existing_role.key = ANY(v_role_keys)
          )
          OR existing_assignment.valid_from >
            v_now
        )
    ) THEN
      RAISE EXCEPTION 'Membership has unexpected role assignments'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.organisation_memberships
    SET
      status =
        'ACTIVE'::public.membership_status,
      job_title = COALESCE(
        v_job_title,
        v_membership.job_title
      ),
      invited_at = COALESCE(
        v_membership.invited_at,
        GREATEST(
          v_invitation.created_at,
          v_membership.created_at
        )
      ),
      joined_at = v_now,
      suspended_at = NULL,
      suspension_note = NULL,
      left_at = NULL,
      updated_at = v_now
    WHERE id = v_membership.id
    RETURNING *
    INTO v_membership;
  ELSE
    INSERT INTO public.organisation_memberships (
      id,
      organisation_id,
      user_profile_id,
      status,
      job_title,
      invited_at,
      joined_at,
      created_at,
      updated_at
    )
    VALUES (
      pg_catalog.gen_random_uuid(),
      v_invitation.organisation_id,
      v_user_id,
      'ACTIVE'::public.membership_status,
      v_job_title,
      v_invitation.created_at,
      v_now,
      v_invitation.created_at,
      v_now
    )
    RETURNING *
    INTO v_membership;
  END IF;

  INSERT INTO public.role_assignments (
    id,
    role_id,
    user_profile_id,
    organisation_id,
    organisation_membership_id,
    scope,
    valid_from,
    reason,
    granted_by_user_profile_id,
    created_at,
    updated_at
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    role_record.id,
    v_user_id,
    v_invitation.organisation_id,
    v_membership.id,
    'ORGANISATION'::public.assignment_scope,
    v_now,
    'Accepted organisation invitation',
    v_invitation.invited_by_user_profile_id,
    v_now,
    v_now
  FROM public.roles AS role_record
  WHERE role_record.organisation_id =
      v_invitation.organisation_id
    AND role_record.key = ANY(v_role_keys)
    AND role_record.scope =
      'ORGANISATION'::public.role_scope
    AND role_record.is_assignable = true
    AND role_record.key <>
      'organisation_owner'
    AND role_record.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.role_assignments
        AS existing_assignment
      WHERE existing_assignment.role_id =
          role_record.id
        AND existing_assignment.organisation_id =
          v_invitation.organisation_id
        AND existing_assignment.organisation_membership_id =
          v_membership.id
        AND existing_assignment.user_profile_id =
          v_user_id
        AND existing_assignment.revoked_at IS NULL
        AND existing_assignment.deleted_at IS NULL
        AND existing_assignment.valid_from <=
          v_now
        AND (
          existing_assignment.valid_until IS NULL
          OR existing_assignment.valid_until >
            v_now
        )
    );

  SELECT pg_catalog.count(
    DISTINCT role_record.key
  )
  INTO v_effective_assignment_count
  FROM public.role_assignments
    AS effective_assignment
  JOIN public.roles AS role_record
    ON role_record.id =
      effective_assignment.role_id
  WHERE effective_assignment.organisation_id =
      v_invitation.organisation_id
    AND effective_assignment.organisation_membership_id =
      v_membership.id
    AND effective_assignment.user_profile_id =
      v_user_id
    AND effective_assignment.revoked_at IS NULL
    AND effective_assignment.deleted_at IS NULL
    AND effective_assignment.valid_from <=
      v_now
    AND (
      effective_assignment.valid_until IS NULL
      OR effective_assignment.valid_until >
        v_now
    )
    AND role_record.key = ANY(v_role_keys)
    AND role_record.deleted_at IS NULL;

  IF v_effective_assignment_count <>
      v_role_key_count
  THEN
    RAISE EXCEPTION 'Invitation roles could not be assigned'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.invitations
  SET
    organisation_membership_id =
      v_membership.id,
    status =
      'ACCEPTED'::public.invitation_status,
    accepted_by_user_profile_id =
      v_user_id,
    accepted_at = v_now,
    updated_at = v_now
  WHERE id = v_invitation.id
    AND status =
      'PENDING'::public.invitation_status
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation changed during acceptance'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.audit_events (
    id,
    organisation_id,
    actor_type,
    actor_user_profile_id,
    subject_user_profile_id,
    source,
    action,
    resource_type,
    resource_id,
    outcome,
    previous_value,
    new_value
  )
  VALUES (
    pg_catalog.gen_random_uuid(),
    v_invitation.organisation_id,
    'USER'::public.audit_actor_type,
    v_user_id,
    v_user_id,
    'businessos-api',
    'organisation_invitation.accepted',
    'invitation',
    v_invitation.id::text,
    'SUCCESS'::public.audit_outcome,
    pg_catalog.jsonb_build_object(
      'status',
      'PENDING'
    ),
    pg_catalog.jsonb_build_object(
      'status',
      'ACCEPTED',
      'membershipId',
      v_membership.id,
      'roleKeys',
      v_role_keys,
      'jobTitle',
      v_membership.job_title
    )
  );

  RETURN QUERY
  SELECT
    v_invitation.id,
    v_organisation.id,
    v_organisation.name::text,
    v_organisation.slug::text,
    v_membership.id,
    'ACCEPTED'::text,
    v_role_keys,
    v_membership.job_title::text;
END;
$function$;

ALTER FUNCTION private.accept_organisation_invitation(
  text
)
OWNER TO postgres;

REVOKE ALL
ON FUNCTION private.accept_organisation_invitation(
  text
)
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  businessos_policy_reader,
  businessos_app;

GRANT EXECUTE
ON FUNCTION private.accept_organisation_invitation(
  text
)
TO businessos_app;

COMMENT ON FUNCTION private.accept_organisation_invitation(
  text
) IS
  'Atomically accepts one organisation invitation for the authenticated verified-email identity, activates membership and controlled roles, and records an audit event.';

COMMIT;