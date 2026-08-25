import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const project = resolve(scriptDirectory, "..");
const apiRequire = createRequire(join(project, "apps/api/package.json"));
const pgliteModule = await import(
  pathToFileURL(apiRequire.resolve("@electric-sql/pglite")).href
);
const btreeModule = await import(
  pathToFileURL(apiRequire.resolve("@electric-sql/pglite/contrib/btree_gist"))
    .href
);
const { PGlite } = pgliteModule;
const { btree_gist: btreeGist } = btreeModule;
const database = await PGlite.create({ extensions: { btree_gist: btreeGist } });

try {
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE businessos_runtime;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT jsonb_build_object() $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text,
      public boolean,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text,
      name text,
      metadata jsonb
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  `);

  const directory = join(project, "supabase/migrations");
  const migrations = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let migrationsPassed = true;
  for (const migration of migrations) {
    try {
      await database.exec(readFileSync(join(directory, migration), "utf8"));
      process.stdout.write(`PASS ${migration}\n`);
    } catch (error) {
      process.stderr.write(`FAIL ${migration}\n`);
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      migrationsPassed = false;
      process.exitCode = 1;
      break;
    }
  }
  if (migrationsPassed) {
    const organisationId = "10000000-0000-4000-8000-000000000001";
    const firstUserId = "10000000-0000-4000-8000-000000000002";
    const secondUserId = "10000000-0000-4000-8000-000000000003";
    const firstMembershipId = "10000000-0000-4000-8000-000000000004";
    const secondMembershipId = "10000000-0000-4000-8000-000000000005";
    const roleId = "10000000-0000-4000-8000-000000000006";
    await database.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
        ('${firstUserId}', 'gate-n-recorder@example.invalid', now()),
        ('${secondUserId}', 'gate-n-reviewer@example.invalid', now());
      INSERT INTO public.organisations (
        id, slug, name, status, updated_at
      ) VALUES (
        '${organisationId}', 'gate-n-smoke', 'Gate N Smoke', 'ACTIVE', now()
      );
      INSERT INTO public.user_profiles (
        id, email, display_name, status, updated_at
      ) VALUES
        ('${firstUserId}', 'gate-n-recorder@example.invalid', 'Recorder', 'ACTIVE', now()),
        ('${secondUserId}', 'gate-n-reviewer@example.invalid', 'Reviewer', 'ACTIVE', now());
      INSERT INTO public.organisation_memberships (
        id, organisation_id, user_profile_id, status, invited_at,
        joined_at, created_at, updated_at
      ) VALUES
        ('${firstMembershipId}', '${organisationId}', '${firstUserId}', 'ACTIVE', now(), now(), now(), now()),
        ('${secondMembershipId}', '${organisationId}', '${secondUserId}', 'ACTIVE', now(), now(), now(), now());
      INSERT INTO public.roles (
        id, organisation_id, key, name, scope, is_system,
        is_assignable, updated_at
      ) VALUES (
        '${roleId}', '${organisationId}', 'system_administrator',
        'System Administrator', 'ORGANISATION', true, true, now()
      );
      INSERT INTO public.role_permissions (id, role_id, permission_id)
      SELECT gen_random_uuid(), '${roleId}', permission.id
      FROM public.permissions AS permission
      WHERE permission.key IN (
        'compliance.read', 'compliance.manage', 'incidents.read',
        'incidents.manage', 'retention.read', 'retention.manage',
        'assurance.read', 'assurance.manage', 'release.approve'
      );
      INSERT INTO public.role_assignments (
        id, role_id, user_profile_id, organisation_id,
        organisation_membership_id, scope, reason, created_at, updated_at
      ) VALUES
        (gen_random_uuid(), '${roleId}', '${firstUserId}', '${organisationId}',
          '${firstMembershipId}', 'ORGANISATION', 'Gate N runtime smoke', now(), now()),
        (gen_random_uuid(), '${roleId}', '${secondUserId}', '${organisationId}',
          '${secondMembershipId}', 'ORGANISATION', 'Gate N runtime smoke', now(), now());
      SELECT set_config('app.organisation_id', '${organisationId}', false);
      SELECT set_config('app.user_id', '${firstUserId}', false);
      SELECT set_config('app.aal', 'AAL2', false);
    `);

    const rightResult = await database.query(`
      SELECT private.create_data_subject_request(
        'ACCESS', 'Runtime Test Person', 'runtime-person@example.invalid',
        NULL, NULL, NULL,
        'Runtime smoke verifies the controlled data-right workflow.', NULL
      ) AS result
    `);
    const right = rightResult.rows[0]?.result;
    if (!right?.id || right.status !== "RECEIVED" || right.version !== 1) {
      throw new Error(
        "Gate N data-right runtime smoke returned invalid evidence.",
      );
    }
    const extensionResult = await database.query(`
      SELECT private.extend_data_subject_request(
        '${right.id}', now() + interval '2 months',
        'Runtime smoke verifies the controlled complexity extension workflow.',
        'runtime://extension-notice', ${right.version}
      ) AS result
    `);
    const extension = extensionResult.rows[0]?.result;
    if (
      extension?.version !== 2 ||
      extension?.notificationReferenceRecorded !== true
    ) {
      throw new Error("Gate N deadline-extension runtime smoke failed.");
    }
    const holdResult = await database.query(`
      SELECT private.create_legal_hold(
        'ORGANISATION', NULL,
        'Runtime smoke verifies that legal hold overrides disposition.',
        now(), NULL
      ) AS result
    `);
    const hold = holdResult.rows[0]?.result;
    const policyResult = await database.query(`
      SELECT private.upsert_retention_policy(
        'runtime.data_right', 'Runtime data-right policy',
        'data_subject_request', 'request completed', 30, 'DELETE',
        'Runtime-only policy used to prove legal-hold enforcement.', true, NULL
      ) AS result
    `);
    const policy = policyResult.rows[0]?.result;
    const reviewResult = await database.query(`
      SELECT private.create_retention_review(
        'data_subject_request', '${right.id}', '${policy.id}',
        now() + interval '1 day', NULL
      ) AS result
    `);
    const review = reviewResult.rows[0]?.result;
    const decisionResult = await database.query(`
      SELECT private.decide_retention_review(
        '${review.id}', 'APPROVED', 'DELETE',
        'Runtime smoke attempts disposition while a legal hold is active.',
        NULL, ${review.version}
      ) AS result
    `);
    if (decisionResult.rows[0]?.result?.status !== "BLOCKED") {
      throw new Error(
        "Gate N legal-hold runtime smoke did not block disposition.",
      );
    }
    await database.query(`
      SELECT private.release_legal_hold(
        '${hold.id}', 'Runtime smoke completed and the test hold can be released.',
        ${hold.version}
      )
    `);

    let excessiveValidityBlocked = false;
    try {
      await database.query(`
        SELECT private.record_assurance_evidence(
          'security.vulnerability_scan', 'Current vulnerability scan',
          'SECURITY', 'immutable://runtime/vulnerability-scan',
          '${"c".repeat(64)}', 'Runtime Scanner', 'Independent Runtime Ltd',
          '{"environment":"isolated-smoke"}'::jsonb,
          now() - interval '1 hour', now() + interval '365 days',
          'Runtime smoke must reject an evidence validity window that is too long.', 1
        )
      `);
    } catch (error) {
      excessiveValidityBlocked = String(error).includes(
        "maximum validity window",
      );
    }
    if (!excessiveValidityBlocked) {
      throw new Error("Gate N evidence-freshness runtime smoke failed.");
    }

    const evidenceResult = await database.query(`
      SELECT private.record_assurance_evidence(
        'backup.restore', 'Independent backup restoration exercise',
        'RESILIENCE', 'immutable://runtime/restore', '${"a".repeat(64)}',
        'Runtime Recorder', 'Independent Runtime Ltd',
        '{"environment":"isolated-smoke"}'::jsonb,
        now() - interval '1 hour', now() + interval '30 days',
        'Runtime smoke evidence only; never valid for a real release.', 1
      ) AS result
    `);
    const evidence = evidenceResult.rows[0]?.result;
    let selfReviewBlocked = false;
    try {
      await database.query(`
        SELECT private.review_assurance_evidence(
          '${evidence.id}', 'PASS',
          'The recorder incorrectly attempts to review their own evidence.',
          ${evidence.version}
        )
      `);
    } catch (error) {
      selfReviewBlocked = String(error).includes(
        "reviewed by a different AAL2 user",
      );
    }
    if (!selfReviewBlocked) {
      throw new Error("Gate N separation-of-duties runtime smoke failed.");
    }
    await database.exec(`
      SELECT set_config('app.user_id', '${secondUserId}', false);
    `);
    const reviewedResult = await database.query(`
      SELECT private.review_assurance_evidence(
        '${evidence.id}', 'PASS',
        'Independent runtime reviewer checked the reference and hash.',
        ${evidence.version}
      ) AS result
    `);
    if (reviewedResult.rows[0]?.result?.status !== "PASS") {
      throw new Error("Gate N independent evidence review smoke failed.");
    }

    let approvalBlocked = false;
    try {
      await database.query(`
        SELECT private.decide_production_release(
          'runtime-release', 'PRODUCTION', 'APPROVED',
          'Runtime smoke must not approve with mandatory blockers present.', NULL
        )
      `);
    } catch (error) {
      approvalBlocked = String(error).includes(
        "blocked by unresolved controls",
      );
    }
    if (!approvalBlocked) {
      throw new Error("Gate N release blocker runtime smoke failed.");
    }
    const dashboardResult = await database.query(
      "SELECT private.get_compliance_assurance_dashboard() AS dashboard",
    );
    const dashboard = dashboardResult.rows[0]?.dashboard;
    if (
      dashboard?.access?.assuranceLevel !== "AAL2" ||
      dashboard?.summary?.mandatoryEvidenceTotal < 12 ||
      dashboard?.summary?.releaseEligible !== false
    ) {
      throw new Error(
        "Gate N dashboard runtime smoke returned invalid evidence.",
      );
    }
    await database.query(`
      SELECT private.transition_data_subject_request(
        '${right.id}', 'WITHDRAWN', 'NOT_STARTED',
        'Runtime smoke request withdrawn after all controls were verified.',
        'runtime://withdrawn', NULL, ${extension.version}
      )
    `);

    process.stdout.write(
      `PASS ${migrations.length} migrations and Gate N runtime controls executed.\n`,
    );
  }
} finally {
  await database.close();
}
