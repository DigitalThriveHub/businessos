-- Atomically provision a complete workforce identity when an invitation is
-- accepted. Existing pre-workforce invitations remain supported through the
-- locked legacy implementation until they expire or are revoked.

BEGIN;

ALTER FUNCTION private.accept_organisation_invitation(text)
  RENAME TO accept_legacy_organisation_invitation;

REVOKE ALL
ON FUNCTION private.accept_legacy_organisation_invitation(text)
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  businessos_policy_reader,
  businessos_app;

CREATE FUNCTION private.accept_organisation_invitation(
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
  v_plan public.invitation_onboarding_plans%ROWTYPE;
  v_workforce_assignment public.workforce_assignments%ROWTYPE;

  v_role_keys text[];
  v_role_count bigint;
  v_resolved_role_count bigint;
  v_provisioned_role_count bigint;
  v_kpi_count bigint;
BEGIN
  -- Preserve acceptance for invitations issued before workforce onboarding
  -- was introduced. The legacy function performs its own complete validation,
  -- row locking, identity matching and atomic audit write.
  IF NOT EXISTS (
    SELECT 1
    FROM public.invitations AS invitation_record
    JOIN public.invitation_onboarding_plans AS plan_record
      ON plan_record.invitation_id = invitation_record.id
     AND plan_record.organisation_id = invitation_record.organisation_id
     AND plan_record.deleted_at IS NULL
    WHERE invitation_record.token_hash = p_token_hash
  ) THEN
    RETURN QUERY
    SELECT
      legacy_result.invitation_id,
      legacy_result.organisation_id,
      legacy_result.organisation_name,
      legacy_result.organisation_slug,
      legacy_result.membership_id,
      legacy_result.invitation_status,
      legacy_result.role_keys,
      legacy_result.job_title
    FROM private.accept_legacy_organisation_invitation(
      p_token_hash
    ) AS legacy_result;

    RETURN;
  END IF;

  v_user_id := private.current_user_id();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication context is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invitation token hash is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(auth_user.email))
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

  -- Serialise all acceptance/bootstrap activity for this identity.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT invitation_record.*
  INTO v_invitation
  FROM public.invitations AS invitation_record
  WHERE invitation_record.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF v_invitation.status <> 'PENDING'::public.invitation_status THEN
    RAISE EXCEPTION 'Invitation is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  IF v_invitation.deleted_at IS NOT NULL
     OR v_invitation.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invitation is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(v_invitation.email))
     <> v_auth_email THEN
    RAISE EXCEPTION 'Invitation identity does not match'
      USING ERRCODE = '42501';
  END IF;

  SELECT organisation_record.*
  INTO v_organisation
  FROM public.organisations AS organisation_record
  WHERE organisation_record.id = v_invitation.organisation_id
    AND organisation_record.status = 'ACTIVE'::public.organisation_status
    AND organisation_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT plan_record.*
  INTO v_plan
  FROM public.invitation_onboarding_plans AS plan_record
  WHERE plan_record.invitation_id = v_invitation.id
    AND plan_record.organisation_id = v_invitation.organisation_id
    AND plan_record.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
     OR v_plan.status <> 'PENDING'::public.onboarding_plan_status THEN
    RAISE EXCEPTION 'Invitation onboarding plan is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan.created_by_user_profile_id
     IS DISTINCT FROM v_invitation.invited_by_user_profile_id THEN
    RAISE EXCEPTION 'Invitation onboarding authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.job_profiles AS profile_record
    WHERE profile_record.id = v_plan.job_profile_id
      AND profile_record.organisation_id = v_plan.organisation_id
      AND profile_record.is_active = true
      AND profile_record.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Invitation job profile is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan.department_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.departments AS department_record
       WHERE department_record.id = v_plan.department_id
         AND department_record.organisation_id = v_plan.organisation_id
         AND department_record.is_active = true
         AND department_record.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Invitation department is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan.team_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.teams AS team_record
       WHERE team_record.id = v_plan.team_id
         AND team_record.organisation_id = v_plan.organisation_id
         AND team_record.is_active = true
         AND team_record.deleted_at IS NULL
         AND team_record.department_id IS NOT DISTINCT FROM v_plan.department_id
     ) THEN
    RAISE EXCEPTION 'Invitation team is unavailable or misaligned'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan.manager_organisation_membership_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.organisation_memberships AS manager_record
       WHERE manager_record.id = v_plan.manager_organisation_membership_id
         AND manager_record.organisation_id = v_plan.organisation_id
         AND manager_record.status = 'ACTIVE'::public.membership_status
         AND manager_record.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Invitation reporting manager is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan.agent_profile_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.agent_profiles AS agent_record
       WHERE agent_record.id = v_plan.agent_profile_id
         AND agent_record.organisation_id = v_plan.organisation_id
         AND agent_record.is_active = true
         AND agent_record.deleted_at IS NULL
         AND (
           agent_record.department_id IS NULL
           OR agent_record.department_id IS NOT DISTINCT FROM v_plan.department_id
         )
     ) THEN
    RAISE EXCEPTION 'Invitation AI-agent profile is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_plan.is_department_manager = true
     AND v_plan.department_id IS NULL THEN
    RAISE EXCEPTION 'Department manager onboarding requires a department'
      USING ERRCODE = '22023';
  END IF;

  IF v_plan.is_team_lead = true
     AND v_plan.team_id IS NULL THEN
    RAISE EXCEPTION 'Team lead onboarding requires a team'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.array_agg(role_record.key ORDER BY role_record.key),
    pg_catalog.count(*)
  INTO v_role_keys, v_role_count
  FROM public.invitation_onboarding_roles AS planned_role
  JOIN public.roles AS role_record
    ON role_record.id = planned_role.role_id
   AND role_record.organisation_id = planned_role.organisation_id
  WHERE planned_role.onboarding_plan_id = v_plan.id
    AND planned_role.organisation_id = v_plan.organisation_id;

  IF v_role_count NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Invitation onboarding roles are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_resolved_role_count
  FROM public.invitation_onboarding_roles AS planned_role
  JOIN public.roles AS role_record
    ON role_record.id = planned_role.role_id
   AND role_record.organisation_id = planned_role.organisation_id
  WHERE planned_role.onboarding_plan_id = v_plan.id
    AND planned_role.organisation_id = v_plan.organisation_id
    AND role_record.is_assignable = true
    AND role_record.key <> 'organisation_owner'
    AND role_record.deleted_at IS NULL
    AND role_record.scope::text = planned_role.scope::text
    AND (
      (
        planned_role.scope = 'ORGANISATION'::public.assignment_scope
        AND planned_role.department_id IS NULL
        AND planned_role.team_id IS NULL
      )
      OR (
        planned_role.scope = 'DEPARTMENT'::public.assignment_scope
        AND planned_role.department_id = v_plan.department_id
        AND planned_role.team_id IS NULL
      )
      OR (
        planned_role.scope = 'TEAM'::public.assignment_scope
        AND planned_role.department_id IS NULL
        AND planned_role.team_id = v_plan.team_id
      )
    );

  IF v_resolved_role_count <> v_role_count THEN
    RAISE EXCEPTION 'Invitation contains unavailable or mis-scoped roles'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invitation_onboarding_kpis AS planned_kpi
    LEFT JOIN public.kpi_definitions AS definition_record
      ON definition_record.id = planned_kpi.kpi_definition_id
     AND definition_record.organisation_id = planned_kpi.organisation_id
    WHERE planned_kpi.onboarding_plan_id = v_plan.id
      AND planned_kpi.organisation_id = v_plan.organisation_id
      AND (
        definition_record.id IS NULL
        OR definition_record.is_active = false
        OR definition_record.deleted_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Invitation contains an unavailable KPI definition'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invitation_onboarding_kpis AS planned_kpi
    WHERE planned_kpi.onboarding_plan_id = v_plan.id
      AND planned_kpi.organisation_id = v_plan.organisation_id
    GROUP BY planned_kpi.onboarding_plan_id
    HAVING pg_catalog.sum(planned_kpi.weight_percent) > 100
  ) THEN
    RAISE EXCEPTION 'Invitation KPI weighting exceeds 100 percent'
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
    RETURNING * INTO v_profile;
  ELSE
    IF v_profile.status <> 'ACTIVE'::public.user_profile_status
       OR v_profile.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'User profile is unavailable'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.user_profiles
    SET email = v_auth_email,
        updated_at = v_now
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
  END IF;

  SELECT membership_record.*
  INTO v_membership
  FROM public.organisation_memberships AS membership_record
  WHERE membership_record.organisation_id = v_invitation.organisation_id
    AND membership_record.user_profile_id = v_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_membership.status <> 'INVITED'::public.membership_status
       OR v_membership.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Organisation membership already exists'
        USING ERRCODE = '55000';
    END IF;

    -- A pending invitation must not activate unreviewed pre-provisioned access.
    IF EXISTS (
      SELECT 1
      FROM public.role_assignments AS assignment_record
      WHERE assignment_record.organisation_id = v_plan.organisation_id
        AND assignment_record.organisation_membership_id = v_membership.id
        AND assignment_record.revoked_at IS NULL
        AND assignment_record.deleted_at IS NULL
        AND (
          assignment_record.valid_until IS NULL
          OR assignment_record.valid_until > v_now
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.department_memberships AS department_membership
      WHERE department_membership.organisation_id = v_plan.organisation_id
        AND department_membership.organisation_membership_id = v_membership.id
        AND department_membership.deleted_at IS NULL
        AND department_membership.ends_at IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM public.team_memberships AS team_membership
      WHERE team_membership.organisation_id = v_plan.organisation_id
        AND team_membership.organisation_membership_id = v_membership.id
        AND team_membership.deleted_at IS NULL
        AND team_membership.ends_at IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM public.workforce_assignments AS workforce_record
      WHERE workforce_record.organisation_id = v_plan.organisation_id
        AND workforce_record.organisation_membership_id = v_membership.id
        AND workforce_record.status IN (
          'ACTIVE'::public.workforce_assignment_status,
          'SUSPENDED'::public.workforce_assignment_status
        )
        AND workforce_record.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Membership contains unexpected pre-provisioned access'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.organisation_memberships
    SET status = 'ACTIVE'::public.membership_status,
        job_title = v_plan.job_title,
        invited_at = COALESCE(
          v_membership.invited_at,
          GREATEST(v_invitation.created_at, v_membership.created_at)
        ),
        joined_at = v_now,
        suspended_at = NULL,
        suspension_note = NULL,
        left_at = NULL,
        updated_at = v_now
    WHERE id = v_membership.id
    RETURNING * INTO v_membership;
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
      v_plan.job_title,
      v_invitation.created_at,
      v_now,
      v_invitation.created_at,
      v_now
    )
    RETURNING * INTO v_membership;
  END IF;

  IF v_plan.department_id IS NOT NULL THEN
    INSERT INTO public.department_memberships (
      id,
      organisation_id,
      department_id,
      organisation_membership_id,
      is_manager,
      starts_at,
      ends_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      pg_catalog.gen_random_uuid(),
      v_plan.organisation_id,
      v_plan.department_id,
      v_membership.id,
      v_plan.is_department_manager,
      v_plan.starts_at,
      NULL,
      v_now,
      v_now,
      NULL
    )
    ON CONFLICT (department_id, organisation_membership_id)
    DO UPDATE SET
      is_manager = EXCLUDED.is_manager,
      starts_at = EXCLUDED.starts_at,
      ends_at = NULL,
      deleted_at = NULL,
      updated_at = v_now;
  END IF;

  IF v_plan.team_id IS NOT NULL THEN
    INSERT INTO public.team_memberships (
      id,
      organisation_id,
      team_id,
      organisation_membership_id,
      is_lead,
      starts_at,
      ends_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      pg_catalog.gen_random_uuid(),
      v_plan.organisation_id,
      v_plan.team_id,
      v_membership.id,
      v_plan.is_team_lead,
      v_plan.starts_at,
      NULL,
      v_now,
      v_now,
      NULL
    )
    ON CONFLICT (team_id, organisation_membership_id)
    DO UPDATE SET
      is_lead = EXCLUDED.is_lead,
      starts_at = EXCLUDED.starts_at,
      ends_at = NULL,
      deleted_at = NULL,
      updated_at = v_now;
  END IF;

  INSERT INTO public.role_assignments (
    id,
    role_id,
    user_profile_id,
    organisation_id,
    organisation_membership_id,
    department_id,
    team_id,
    scope,
    valid_from,
    reason,
    granted_by_user_profile_id,
    created_at,
    updated_at
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    planned_role.role_id,
    v_user_id,
    v_plan.organisation_id,
    v_membership.id,
    planned_role.department_id,
    planned_role.team_id,
    planned_role.scope,
    v_plan.starts_at,
    'Provisioned from accepted workforce invitation',
    v_invitation.invited_by_user_profile_id,
    v_now,
    v_now
  FROM public.invitation_onboarding_roles AS planned_role
  WHERE planned_role.onboarding_plan_id = v_plan.id
    AND planned_role.organisation_id = v_plan.organisation_id;

  SELECT pg_catalog.count(*)
  INTO v_provisioned_role_count
  FROM public.role_assignments AS assignment_record
  JOIN public.invitation_onboarding_roles AS planned_role
    ON planned_role.role_id = assignment_record.role_id
   AND planned_role.onboarding_plan_id = v_plan.id
   AND planned_role.organisation_id = assignment_record.organisation_id
   AND planned_role.scope = assignment_record.scope
   AND planned_role.department_id IS NOT DISTINCT FROM assignment_record.department_id
   AND planned_role.team_id IS NOT DISTINCT FROM assignment_record.team_id
  WHERE assignment_record.organisation_id = v_plan.organisation_id
    AND assignment_record.organisation_membership_id = v_membership.id
    AND assignment_record.user_profile_id = v_user_id
    AND assignment_record.valid_from = v_plan.starts_at
    AND assignment_record.revoked_at IS NULL
    AND assignment_record.deleted_at IS NULL;

  IF v_provisioned_role_count <> v_role_count THEN
    RAISE EXCEPTION 'Invitation roles could not be provisioned'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.workforce_assignments (
    id,
    organisation_id,
    organisation_membership_id,
    job_profile_id,
    department_id,
    team_id,
    manager_organisation_membership_id,
    agent_profile_id,
    job_title,
    status,
    is_primary,
    starts_at,
    created_by_user_profile_id,
    created_at,
    updated_at
  )
  VALUES (
    pg_catalog.gen_random_uuid(),
    v_plan.organisation_id,
    v_membership.id,
    v_plan.job_profile_id,
    v_plan.department_id,
    v_plan.team_id,
    v_plan.manager_organisation_membership_id,
    v_plan.agent_profile_id,
    v_plan.job_title,
    'ACTIVE'::public.workforce_assignment_status,
    true,
    v_plan.starts_at,
    v_invitation.invited_by_user_profile_id,
    v_now,
    v_now
  )
  RETURNING * INTO v_workforce_assignment;

  INSERT INTO public.workforce_assignment_kpis (
    id,
    organisation_id,
    workforce_assignment_id,
    kpi_definition_id,
    source_job_profile_kpi_id,
    target_value,
    minimum_value,
    maximum_value,
    weight_percent,
    effective_from,
    is_active,
    created_by_user_profile_id,
    created_at,
    updated_at
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    planned_kpi.organisation_id,
    v_workforce_assignment.id,
    planned_kpi.kpi_definition_id,
    planned_kpi.source_job_profile_kpi_id,
    planned_kpi.target_value,
    planned_kpi.minimum_value,
    planned_kpi.maximum_value,
    planned_kpi.weight_percent,
    v_plan.starts_at,
    true,
    v_invitation.invited_by_user_profile_id,
    v_now,
    v_now
  FROM public.invitation_onboarding_kpis AS planned_kpi
  WHERE planned_kpi.onboarding_plan_id = v_plan.id
    AND planned_kpi.organisation_id = v_plan.organisation_id;

  GET DIAGNOSTICS v_kpi_count = ROW_COUNT;

  UPDATE public.invitations
  SET organisation_membership_id = v_membership.id,
      status = 'ACCEPTED'::public.invitation_status,
      accepted_by_user_profile_id = v_user_id,
      accepted_at = v_now,
      updated_at = v_now
  WHERE id = v_invitation.id
    AND status = 'PENDING'::public.invitation_status
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation changed during acceptance'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.invitation_onboarding_plans
  SET status = 'PROVISIONED'::public.onboarding_plan_status,
      provisioned_organisation_membership_id = v_membership.id,
      provisioned_workforce_assignment_id = v_workforce_assignment.id,
      provisioned_at = v_now,
      updated_at = v_now
  WHERE id = v_plan.id
    AND organisation_id = v_plan.organisation_id
    AND status = 'PENDING'::public.onboarding_plan_status
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onboarding plan changed during acceptance'
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
    v_plan.organisation_id,
    'USER'::public.audit_actor_type,
    v_user_id,
    v_user_id,
    'businessos-api',
    'organisation_invitation.workforce_provisioned',
    'invitation',
    v_invitation.id::text,
    'SUCCESS'::public.audit_outcome,
    pg_catalog.jsonb_build_object(
      'status', 'PENDING',
      'onboardingPlanStatus', 'PENDING'
    ),
    pg_catalog.jsonb_build_object(
      'status', 'ACCEPTED',
      'onboardingPlanStatus', 'PROVISIONED',
      'membershipId', v_membership.id,
      'workforceAssignmentId', v_workforce_assignment.id,
      'jobProfileId', v_plan.job_profile_id,
      'departmentId', v_plan.department_id,
      'teamId', v_plan.team_id,
      'managerOrganisationMembershipId',
        v_plan.manager_organisation_membership_id,
      'agentProfileId', v_plan.agent_profile_id,
      'roleKeys', v_role_keys,
      'kpiCount', v_kpi_count,
      'startsAt', v_plan.starts_at,
      'jobTitle', v_plan.job_title
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
    v_plan.job_title::text;
END;
$function$;

ALTER FUNCTION private.accept_organisation_invitation(text)
  OWNER TO postgres;

REVOKE ALL
ON FUNCTION private.accept_organisation_invitation(text)
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  businessos_policy_reader,
  businessos_app;

GRANT EXECUTE
ON FUNCTION private.accept_organisation_invitation(text)
TO businessos_app;

COMMENT ON FUNCTION private.accept_organisation_invitation(text) IS
  'Atomically accepts a verified-email invitation and provisions tenant-scoped membership, department/team placement, roles, workforce assignment, KPI targets and approved AI-agent profile.';

COMMENT ON FUNCTION private.accept_legacy_organisation_invitation(text) IS
  'Compatibility-only acceptance path for invitations issued before workforce onboarding plans were introduced. Not executable by application roles directly.';

COMMIT;