-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "organisation_status" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "user_profile_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT');

-- CreateEnum
CREATE TYPE "role_scope" AS ENUM ('PLATFORM', 'ORGANISATION', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "assignment_scope" AS ENUM ('PLATFORM', 'ORGANISATION', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "permission_data_scope" AS ENUM ('OWN', 'ASSIGNED', 'TEAM', 'DEPARTMENT', 'ORGANISATION', 'SHARED', 'PLATFORM');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "authentication_assurance_level" AS ENUM ('AAL1', 'AAL2');

-- CreateEnum
CREATE TYPE "support_access_status" AS ENUM ('REQUESTED', 'APPROVED', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'AI_AGENT', 'SERVICE', 'SUPPORT', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "security_severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "security_event_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(250),
    "status" "organisation_status" NOT NULL DEFAULT 'PROVISIONING',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/London',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-GB',
    "country_code" CHAR(2) NOT NULL DEFAULT 'GB',
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_organisations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_settings" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB,
    "secret_reference" VARCHAR(500),
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_organisation_settings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(200),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "avatar_path" VARCHAR(500),
    "status" "user_profile_status" NOT NULL DEFAULT 'ACTIVE',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-GB',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/London',
    "is_platform_user" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_user_profiles" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_memberships" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'INVITED',
    "job_title" VARCHAR(160),
    "employee_ref" VARCHAR(100),
    "invited_at" TIMESTAMPTZ(6),
    "joined_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "suspension_note" TEXT,
    "left_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_organisation_memberships" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_departments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_memberships" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "organisation_membership_id" UUID NOT NULL,
    "is_manager" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_department_memberships" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "department_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_teams" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "organisation_membership_id" UUID NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_team_memberships" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organisation_id" UUID,
    "key" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "scope" "role_scope" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_assignable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_roles" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(180) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "resource" VARCHAR(100) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "data_scope" "permission_data_scope",
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "requires_mfa" BOOLEAN NOT NULL DEFAULT false,
    "allows_ai_use" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_permissions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_role_permissions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "organisation_id" UUID,
    "organisation_membership_id" UUID,
    "department_id" UUID,
    "team_id" UUID,
    "scope" "assignment_scope" NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(6),
    "reason" TEXT,
    "granted_by_user_profile_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_profile_id" UUID,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_role_assignments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "organisation_membership_id" UUID,
    "email" VARCHAR(320) NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'PENDING',
    "invited_by_user_profile_id" UUID NOT NULL,
    "accepted_by_user_profile_id" UUID,
    "revoked_by_user_profile_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_invitations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "active_organisation_id" UUID,
    "active_organisation_membership_id" UUID,
    "auth_session_id" UUID NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'ACTIVE',
    "assurance_level" "authentication_assurance_level" NOT NULL DEFAULT 'AAL1',
    "ip_address" INET,
    "user_agent" TEXT,
    "device_name" VARCHAR(160),
    "mfa_verified_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_profile_id" UUID,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_user_sessions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_grants" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "grantee_user_profile_id" UUID NOT NULL,
    "requested_by_user_profile_id" UUID NOT NULL,
    "approved_by_user_profile_id" UUID,
    "revoked_by_user_profile_id" UUID,
    "status" "support_access_status" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "ticket_reference" VARCHAR(120),
    "permission_keys" VARCHAR(180)[] DEFAULT ARRAY[]::VARCHAR(180)[],
    "starts_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "approved_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "denied_at" TIMESTAMPTZ(6),
    "decision_reason" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_support_access_grants" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisation_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_profile_id" UUID,
    "actor_identifier" VARCHAR(200),
    "subject_user_profile_id" UUID,
    "user_session_id" UUID,
    "support_access_grant_id" UUID,
    "request_id" VARCHAR(100),
    "correlation_id" VARCHAR(100),
    "causation_id" VARCHAR(100),
    "source" VARCHAR(80) NOT NULL,
    "action" VARCHAR(160) NOT NULL,
    "resource_type" VARCHAR(120) NOT NULL,
    "resource_id" VARCHAR(160),
    "outcome" "audit_outcome" NOT NULL,
    "reason" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "previous_value" JSONB,
    "new_value" JSONB,
    "metadata" JSONB,
    "previous_hash" VARCHAR(128),
    "event_hash" VARCHAR(128),

    CONSTRAINT "pk_audit_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisation_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_profile_id" UUID,
    "actor_identifier" VARCHAR(200),
    "subject_user_profile_id" UUID,
    "user_session_id" UUID,
    "support_access_grant_id" UUID,
    "event_type" VARCHAR(160) NOT NULL,
    "severity" "security_severity" NOT NULL,
    "status" "security_event_status" NOT NULL DEFAULT 'OPEN',
    "source" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "request_id" VARCHAR(100),
    "correlation_id" VARCHAR(100),
    "resource_type" VARCHAR(120),
    "resource_id" VARCHAR(160),
    "metadata" JSONB,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_user_profile_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_profile_id" UUID,
    "resolution" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_security_events" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_organisations_slug" ON "organisations"("slug");

-- CreateIndex
CREATE INDEX "ix_organisations_status_deleted" ON "organisations"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_organisations_created_at" ON "organisations"("created_at");

-- CreateIndex
CREATE INDEX "ix_org_settings_org_deleted" ON "organisation_settings"("organisation_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_org_settings_org_key" ON "organisation_settings"("organisation_id", "key");

-- CreateIndex
CREATE INDEX "ix_user_profiles_email" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "ix_user_profiles_status_deleted" ON "user_profiles"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_user_profiles_platform_status" ON "user_profiles"("is_platform_user", "status");

-- CreateIndex
CREATE INDEX "ix_org_memberships_user_status" ON "organisation_memberships"("user_profile_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_org_memberships_org_status" ON "organisation_memberships"("organisation_id", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_org_memberships_org_user" ON "organisation_memberships"("organisation_id", "user_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_org_memberships_id_org" ON "organisation_memberships"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_org_memberships_id_org_user" ON "organisation_memberships"("id", "organisation_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "ix_departments_org_active" ON "departments"("organisation_id", "is_active", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_departments_org_parent" ON "departments"("organisation_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_departments_id_org" ON "departments"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_departments_org_name" ON "departments"("organisation_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_departments_org_code" ON "departments"("organisation_id", "code");

-- CreateIndex
CREATE INDEX "ix_dept_memberships_org_member" ON "department_memberships"("organisation_id", "organisation_membership_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_dept_memberships_org_dept" ON "department_memberships"("organisation_id", "department_id", "is_manager", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dept_memberships_dept_member" ON "department_memberships"("department_id", "organisation_membership_id");

-- CreateIndex
CREATE INDEX "ix_teams_org_department" ON "teams"("organisation_id", "department_id", "is_active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_teams_id_org" ON "teams"("id", "organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_teams_org_name" ON "teams"("organisation_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_teams_org_code" ON "teams"("organisation_id", "code");

-- CreateIndex
CREATE INDEX "ix_team_memberships_org_member" ON "team_memberships"("organisation_id", "organisation_membership_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_team_memberships_org_team" ON "team_memberships"("organisation_id", "team_id", "is_lead", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_team_memberships_team_member" ON "team_memberships"("team_id", "organisation_membership_id");

-- CreateIndex
CREATE INDEX "ix_roles_org_scope" ON "roles"("organisation_id", "scope", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_roles_system_scope" ON "roles"("is_system", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "uq_roles_org_key" ON "roles"("organisation_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_permissions_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "ix_permissions_resource_action" ON "permissions"("resource", "action", "data_scope", "is_active");

-- CreateIndex
CREATE INDEX "ix_permissions_resource_active" ON "permissions"("resource", "is_active", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_permissions_ai_active" ON "permissions"("allows_ai_use", "is_active");

-- CreateIndex
CREATE INDEX "ix_role_permissions_permission_role" ON "role_permissions"("permission_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_role_permissions_role_permission" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "ix_role_assignments_user_effective" ON "role_assignments"("user_profile_id", "scope", "revoked_at", "valid_until");

-- CreateIndex
CREATE INDEX "ix_role_assignments_org_user" ON "role_assignments"("organisation_id", "user_profile_id", "revoked_at", "valid_until");

-- CreateIndex
CREATE INDEX "ix_role_assignments_membership" ON "role_assignments"("organisation_membership_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_role_assignments_department" ON "role_assignments"("department_id", "user_profile_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_role_assignments_team" ON "role_assignments"("team_id", "user_profile_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_role_assignments_role" ON "role_assignments"("role_id", "revoked_at", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invitations_token_hash" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "ix_invitations_org_status_expiry" ON "invitations"("organisation_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_invitations_email_status" ON "invitations"("email", "status");

-- CreateIndex
CREATE INDEX "ix_invitations_inviter_created" ON "invitations"("invited_by_user_profile_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_sessions_auth_session" ON "user_sessions"("auth_session_id");

-- CreateIndex
CREATE INDEX "ix_user_sessions_user_status" ON "user_sessions"("user_profile_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_user_sessions_org_status" ON "user_sessions"("active_organisation_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_user_sessions_last_seen" ON "user_sessions"("last_seen_at");

-- CreateIndex
CREATE INDEX "ix_support_access_org_status" ON "support_access_grants"("organisation_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_support_access_grantee_status" ON "support_access_grants"("grantee_user_profile_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_support_access_requester" ON "support_access_grants"("requested_by_user_profile_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_audit_events_event_hash" ON "audit_events"("event_hash");

-- CreateIndex
CREATE INDEX "ix_audit_events_org_occurred" ON "audit_events"("organisation_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_events_actor_occurred" ON "audit_events"("actor_user_profile_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_events_subject_occurred" ON "audit_events"("subject_user_profile_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_events_resource_occurred" ON "audit_events"("resource_type", "resource_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_events_correlation" ON "audit_events"("correlation_id");

-- CreateIndex
CREATE INDEX "ix_audit_events_action_outcome" ON "audit_events"("action", "outcome", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_security_events_org_status" ON "security_events"("organisation_id", "severity", "status", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_security_events_actor" ON "security_events"("actor_user_profile_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_security_events_subject" ON "security_events"("subject_user_profile_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_security_events_type" ON "security_events"("event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_security_events_correlation" ON "security_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "organisation_settings" ADD CONSTRAINT "fk_org_settings_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "fk_org_memberships_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "fk_org_memberships_user" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "fk_departments_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "fk_departments_parent" FOREIGN KEY ("parent_id", "organisation_id") REFERENCES "departments"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_memberships" ADD CONSTRAINT "fk_dept_memberships_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_memberships" ADD CONSTRAINT "fk_dept_memberships_department" FOREIGN KEY ("department_id", "organisation_id") REFERENCES "departments"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_memberships" ADD CONSTRAINT "fk_dept_memberships_org_member" FOREIGN KEY ("organisation_membership_id", "organisation_id") REFERENCES "organisation_memberships"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "fk_teams_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "fk_teams_department" FOREIGN KEY ("department_id", "organisation_id") REFERENCES "departments"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "fk_team_memberships_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "fk_team_memberships_team" FOREIGN KEY ("team_id", "organisation_id") REFERENCES "teams"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "fk_team_memberships_org_member" FOREIGN KEY ("organisation_membership_id", "organisation_id") REFERENCES "organisation_memberships"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "fk_roles_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_user" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_org" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_org_member" FOREIGN KEY ("organisation_membership_id", "organisation_id", "user_profile_id") REFERENCES "organisation_memberships"("id", "organisation_id", "user_profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_department" FOREIGN KEY ("department_id", "organisation_id") REFERENCES "departments"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_team" FOREIGN KEY ("team_id", "organisation_id") REFERENCES "teams"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_granted_by" FOREIGN KEY ("granted_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "fk_role_assignments_revoked_by" FOREIGN KEY ("revoked_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_org_member" FOREIGN KEY ("organisation_membership_id", "organisation_id") REFERENCES "organisation_memberships"("id", "organisation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_invited_by" FOREIGN KEY ("invited_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_accepted_by" FOREIGN KEY ("accepted_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_invitations_revoked_by" FOREIGN KEY ("revoked_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "fk_user_sessions_user" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "fk_user_sessions_active_org" FOREIGN KEY ("active_organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "fk_user_sessions_active_membership" FOREIGN KEY ("active_organisation_membership_id", "active_organisation_id", "user_profile_id") REFERENCES "organisation_memberships"("id", "organisation_id", "user_profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "fk_user_sessions_revoked_by" FOREIGN KEY ("revoked_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "fk_support_access_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "fk_support_access_grantee" FOREIGN KEY ("grantee_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "fk_support_access_requested_by" FOREIGN KEY ("requested_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "fk_support_access_approved_by" FOREIGN KEY ("approved_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "fk_support_access_revoked_by" FOREIGN KEY ("revoked_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "fk_audit_events_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "fk_audit_events_actor_user" FOREIGN KEY ("actor_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "fk_audit_events_subject_user" FOREIGN KEY ("subject_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "fk_audit_events_session" FOREIGN KEY ("user_session_id") REFERENCES "user_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "fk_audit_events_support_grant" FOREIGN KEY ("support_access_grant_id") REFERENCES "support_access_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_organisation" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_actor_user" FOREIGN KEY ("actor_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_subject_user" FOREIGN KEY ("subject_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_session" FOREIGN KEY ("user_session_id") REFERENCES "user_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_support_grant" FOREIGN KEY ("support_access_grant_id") REFERENCES "support_access_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_acknowledged_by" FOREIGN KEY ("acknowledged_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_resolved_by" FOREIGN KEY ("resolved_by_user_profile_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- BusinessOS Sprint 0 security hardening (PostgreSQL / Supabase)
-- =============================================================================

-- Supabase Auth owns identities; BusinessOS profiles share auth.users UUIDs.
ALTER TABLE public.user_profiles
  ADD CONSTRAINT fk_user_profiles_auth_user
  FOREIGN KEY (id) REFERENCES auth.users(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Lifecycle, state-machine and tenant-boundary checks that Prisma cannot express.
ALTER TABLE public.organisations
  ADD CONSTRAINT ck_organisations_country_code CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT ck_organisations_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.organisation_settings
  ADD CONSTRAINT ck_organisation_settings_version CHECK (version > 0),
  ADD CONSTRAINT ck_organisation_settings_secret_storage CHECK (
    num_nonnulls(value, secret_reference) <= 1
    AND (NOT is_sensitive OR (secret_reference IS NOT NULL AND value IS NULL))
  ),
  ADD CONSTRAINT ck_organisation_settings_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.user_profiles
  ADD CONSTRAINT ck_user_profiles_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.organisation_memberships
  ADD CONSTRAINT ck_organisation_memberships_times CHECK (
    (invited_at IS NULL OR invited_at >= created_at)
    AND (joined_at IS NULL OR joined_at >= created_at)
    AND (suspended_at IS NULL OR suspended_at >= created_at)
    AND (left_at IS NULL OR left_at >= created_at)
    AND updated_at >= created_at
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  ADD CONSTRAINT ck_organisation_memberships_status CHECK (
    (status = 'INVITED' AND joined_at IS NULL AND suspended_at IS NULL AND left_at IS NULL)
    OR (status = 'ACTIVE' AND joined_at IS NOT NULL AND left_at IS NULL)
    OR (status = 'SUSPENDED' AND suspended_at IS NOT NULL AND left_at IS NULL)
    OR (status = 'LEFT' AND left_at IS NOT NULL)
  );

ALTER TABLE public.departments
  ADD CONSTRAINT ck_departments_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  ADD CONSTRAINT ck_departments_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.department_memberships
  ADD CONSTRAINT ck_department_memberships_time CHECK (ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT ck_department_memberships_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.teams
  ADD CONSTRAINT ck_teams_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.team_memberships
  ADD CONSTRAINT ck_team_memberships_time CHECK (ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT ck_team_memberships_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.roles
  ADD CONSTRAINT ck_roles_scope_organisation CHECK (
    (scope = 'PLATFORM' AND organisation_id IS NULL)
    OR (scope IN ('ORGANISATION', 'DEPARTMENT', 'TEAM') AND organisation_id IS NOT NULL)
  ),
  ADD CONSTRAINT ck_roles_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.permissions
  ADD CONSTRAINT ck_permissions_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.role_assignments
  ADD CONSTRAINT ck_role_assignments_scope_target CHECK (
    (scope = 'PLATFORM'
      AND organisation_id IS NULL AND organisation_membership_id IS NULL
      AND department_id IS NULL AND team_id IS NULL)
    OR (scope = 'ORGANISATION'
      AND organisation_id IS NOT NULL AND organisation_membership_id IS NOT NULL
      AND department_id IS NULL AND team_id IS NULL)
    OR (scope = 'DEPARTMENT'
      AND organisation_id IS NOT NULL AND organisation_membership_id IS NOT NULL
      AND department_id IS NOT NULL AND team_id IS NULL)
    OR (scope = 'TEAM'
      AND organisation_id IS NOT NULL AND organisation_membership_id IS NOT NULL
      AND department_id IS NULL AND team_id IS NOT NULL)
  ),
  ADD CONSTRAINT ck_role_assignments_validity
    CHECK (valid_until IS NULL OR valid_until > valid_from),
  ADD CONSTRAINT ck_role_assignments_revocation CHECK (
    (revoked_at IS NULL OR revoked_at >= valid_from)
    AND (revoked_by_user_profile_id IS NULL OR revoked_at IS NOT NULL)
  ),
  ADD CONSTRAINT ck_role_assignments_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.invitations
  ADD CONSTRAINT fk_invitations_accepted_membership
    FOREIGN KEY (organisation_membership_id, organisation_id, accepted_by_user_profile_id)
    REFERENCES public.organisation_memberships(id, organisation_id, user_profile_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT ck_invitations_expiry CHECK (expires_at > created_at),
  ADD CONSTRAINT ck_invitations_acceptance_time
    CHECK (accepted_at IS NULL OR (accepted_at >= created_at AND accepted_at <= expires_at)),
  ADD CONSTRAINT ck_invitations_revocation_time
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  ADD CONSTRAINT ck_invitations_status_fields CHECK (
    (status = 'PENDING'
      AND accepted_at IS NULL AND accepted_by_user_profile_id IS NULL
      AND revoked_at IS NULL AND revoked_by_user_profile_id IS NULL)
    OR (status = 'ACCEPTED'
      AND organisation_membership_id IS NOT NULL
      AND accepted_at IS NOT NULL AND accepted_by_user_profile_id IS NOT NULL
      AND revoked_at IS NULL)
    OR (status = 'REVOKED'
      AND accepted_at IS NULL AND accepted_by_user_profile_id IS NULL
      AND revoked_at IS NOT NULL)
    OR (status = 'EXPIRED'
      AND accepted_at IS NULL AND accepted_by_user_profile_id IS NULL
      AND revoked_at IS NULL)
  ),
  ADD CONSTRAINT ck_invitations_lifecycle
    CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at));

ALTER TABLE public.user_sessions
  ADD CONSTRAINT ck_user_sessions_active_tenant_pair
    CHECK ((active_organisation_id IS NULL) = (active_organisation_membership_id IS NULL)),
  ADD CONSTRAINT ck_user_sessions_expiry CHECK (expires_at > created_at),
  ADD CONSTRAINT ck_user_sessions_last_seen CHECK (last_seen_at >= created_at),
  ADD CONSTRAINT ck_user_sessions_revocation CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
    OR (status IN ('ACTIVE', 'EXPIRED') AND revoked_at IS NULL)
  ),
  ADD CONSTRAINT ck_user_sessions_revoker
    CHECK (revoked_by_user_profile_id IS NULL OR revoked_at IS NOT NULL),
  ADD CONSTRAINT ck_user_sessions_aal2
    CHECK (assurance_level <> 'AAL2' OR mfa_verified_at IS NOT NULL),
  ADD CONSTRAINT ck_user_sessions_lifecycle CHECK (updated_at >= created_at);

ALTER TABLE public.support_access_grants
  ADD CONSTRAINT ck_support_access_time CHECK (
    expires_at > COALESCE(starts_at, created_at)
    AND expires_at <= COALESCE(starts_at, created_at) + interval '24 hours'
  ),
  ADD CONSTRAINT ck_support_access_approver_separation CHECK (
    approved_by_user_profile_id IS NULL
    OR (approved_by_user_profile_id <> grantee_user_profile_id
      AND approved_by_user_profile_id <> requested_by_user_profile_id)
  ),
  ADD CONSTRAINT ck_support_access_approval_pair
    CHECK ((approved_at IS NULL) = (approved_by_user_profile_id IS NULL)),
  ADD CONSTRAINT ck_support_access_activation
    CHECK (activated_at IS NULL OR approved_at IS NOT NULL),
  ADD CONSTRAINT ck_support_access_last_used
    CHECK (last_used_at IS NULL OR (activated_at IS NOT NULL AND last_used_at >= activated_at)),
  ADD CONSTRAINT ck_support_access_revoker
    CHECK (revoked_by_user_profile_id IS NULL OR revoked_at IS NOT NULL),
  ADD CONSTRAINT ck_support_access_status_fields CHECK (
    (status = 'REQUESTED'
      AND approved_at IS NULL AND activated_at IS NULL
      AND denied_at IS NULL AND revoked_at IS NULL)
    OR (status = 'APPROVED'
      AND approved_at IS NOT NULL AND activated_at IS NULL
      AND denied_at IS NULL AND revoked_at IS NULL
      AND cardinality(permission_keys) > 0)
    OR (status = 'ACTIVE'
      AND approved_at IS NOT NULL AND activated_at IS NOT NULL
      AND starts_at IS NOT NULL AND denied_at IS NULL AND revoked_at IS NULL
      AND cardinality(permission_keys) > 0)
    OR (status = 'DENIED'
      AND denied_at IS NOT NULL AND approved_at IS NULL
      AND activated_at IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    OR (status = 'EXPIRED')
  ),
  ADD CONSTRAINT ck_support_access_lifecycle CHECK (updated_at >= created_at);

ALTER TABLE public.audit_events
  ADD CONSTRAINT ck_audit_events_actor_shape CHECK (
    (actor_type <> 'USER' OR actor_user_profile_id IS NOT NULL)
    AND (actor_type <> 'SUPPORT'
      OR (actor_user_profile_id IS NOT NULL AND support_access_grant_id IS NOT NULL))
    AND (actor_type <> 'ANONYMOUS' OR actor_user_profile_id IS NULL)
  );

ALTER TABLE public.security_events
  ADD CONSTRAINT ck_security_events_actor_shape CHECK (
    (actor_type <> 'USER' OR actor_user_profile_id IS NOT NULL)
    AND (actor_type <> 'SUPPORT'
      OR (actor_user_profile_id IS NOT NULL AND support_access_grant_id IS NOT NULL))
    AND (actor_type <> 'ANONYMOUS' OR actor_user_profile_id IS NULL)
  ),
  ADD CONSTRAINT ck_security_events_ack_pair
    CHECK ((acknowledged_at IS NULL) = (acknowledged_by_user_profile_id IS NULL)),
  ADD CONSTRAINT ck_security_events_resolution_pair
    CHECK ((resolved_at IS NULL) = (resolved_by_user_profile_id IS NULL)),
  ADD CONSTRAINT ck_security_events_times CHECK (
    (acknowledged_at IS NULL OR acknowledged_at >= occurred_at)
    AND (resolved_at IS NULL OR resolved_at >= occurred_at)
  ),
  ADD CONSTRAINT ck_security_events_status_fields CHECK (
    (status = 'OPEN' AND acknowledged_at IS NULL AND resolved_at IS NULL)
    OR (status IN ('ACKNOWLEDGED', 'INVESTIGATING')
      AND acknowledged_at IS NOT NULL AND resolved_at IS NULL)
    OR (status IN ('RESOLVED', 'DISMISSED') AND resolved_at IS NOT NULL)
  ),
  ADD CONSTRAINT ck_security_events_lifecycle CHECK (updated_at >= occurred_at);

-- Filtered uniqueness and permission-array lookup.
CREATE UNIQUE INDEX uq_user_profiles_email_active
  ON public.user_profiles (lower(btrim(email))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_roles_platform_key_active
  ON public.roles (key) WHERE organisation_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_invitations_pending_org_email
  ON public.invitations (organisation_id, lower(btrim(email)))
  WHERE status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX ix_support_access_permission_keys
  ON public.support_access_grants USING gin (permission_keys);

-- Concurrency-safe prevention of overlapping active assignments.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SET search_path = public, extensions, pg_catalog;
ALTER TABLE public.role_assignments
  ADD CONSTRAINT ex_role_assignments_platform_overlap
    EXCLUDE USING gist (user_profile_id WITH =, role_id WITH =,
      tstzrange(valid_from, valid_until, '[)') WITH &&)
    WHERE (scope = 'PLATFORM' AND revoked_at IS NULL AND deleted_at IS NULL),
  ADD CONSTRAINT ex_role_assignments_organisation_overlap
    EXCLUDE USING gist (organisation_id WITH =, user_profile_id WITH =, role_id WITH =,
      tstzrange(valid_from, valid_until, '[)') WITH &&)
    WHERE (scope = 'ORGANISATION' AND revoked_at IS NULL AND deleted_at IS NULL),
  ADD CONSTRAINT ex_role_assignments_department_overlap
    EXCLUDE USING gist (department_id WITH =, user_profile_id WITH =, role_id WITH =,
      tstzrange(valid_from, valid_until, '[)') WITH &&)
    WHERE (scope = 'DEPARTMENT' AND revoked_at IS NULL AND deleted_at IS NULL),
  ADD CONSTRAINT ex_role_assignments_team_overlap
    EXCLUDE USING gist (team_id WITH =, user_profile_id WITH =, role_id WITH =,
      tstzrange(valid_from, valid_until, '[)') WITH &&)
    WHERE (scope = 'TEAM' AND revoked_at IS NULL AND deleted_at IS NULL);
RESET search_path;

-- Dedicated, non-login roles. Provision a password-bearing runtime login separately.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'businessos_app') THEN
    CREATE ROLE businessos_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'businessos_policy_reader') THEN
    CREATE ROLE businessos_policy_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO businessos_app, businessos_policy_reader;

-- NestJS sets these values with set_config(name, value, true) in one transaction.
CREATE OR REPLACE FUNCTION private.current_user_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION private.current_organisation_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('app.organisation_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION private.current_support_grant_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(pg_catalog.current_setting('app.support_grant_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION private.current_aal()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.aal', true), ''), 'AAL1')
$function$;

REVOKE ALL ON FUNCTION private.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_organisation_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_support_grant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_aal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO businessos_app, businessos_policy_reader;
GRANT EXECUTE ON FUNCTION private.current_organisation_id() TO businessos_app, businessos_policy_reader;
GRANT EXECUTE ON FUNCTION private.current_support_grant_id() TO businessos_app, businessos_policy_reader;
GRANT EXECUTE ON FUNCTION private.current_aal() TO businessos_app, businessos_policy_reader;

GRANT USAGE ON SCHEMA public TO businessos_policy_reader;
GRANT SELECT ON public.organisations, public.user_profiles,
  public.organisation_memberships, public.roles, public.permissions,
  public.role_permissions, public.role_assignments, public.support_access_grants
TO businessos_policy_reader;

-- Boolean-only RLS helpers, owned by a narrow policy-reader role.
GRANT CREATE ON SCHEMA private TO businessos_policy_reader;
GRANT businessos_policy_reader TO postgres;

CREATE OR REPLACE FUNCTION private.has_active_membership(p_organisation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id IS NOT NULL
    AND private.current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organisation_memberships AS membership
      JOIN public.organisations AS organisation ON organisation.id = membership.organisation_id
      JOIN public.user_profiles AS profile ON profile.id = membership.user_profile_id
      WHERE membership.organisation_id = p_organisation_id
        AND membership.user_profile_id = private.current_user_id()
        AND membership.status::text = 'ACTIVE'
        AND membership.deleted_at IS NULL
        AND profile.status::text = 'ACTIVE'
        AND profile.deleted_at IS NULL
        AND organisation.status::text IN ('PROVISIONING', 'ACTIVE')
        AND organisation.deleted_at IS NULL
    )
$function$;

CREATE OR REPLACE FUNCTION private.is_current_org_member(p_organisation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_organisation_id = private.current_organisation_id()
    AND private.has_active_membership(p_organisation_id)
$function$;

CREATE OR REPLACE FUNCTION private.profile_is_in_current_org(p_user_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT private.is_current_org_member(private.current_organisation_id())
    AND EXISTS (
      SELECT 1 FROM public.organisation_memberships AS membership
      WHERE membership.organisation_id = private.current_organisation_id()
        AND membership.user_profile_id = p_user_profile_id
        AND membership.status::text IN ('INVITED', 'ACTIVE', 'SUSPENDED')
        AND membership.deleted_at IS NULL
    )
$function$;

CREATE OR REPLACE FUNCTION private.has_platform_permission(p_permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT private.current_user_id() IS NOT NULL
    AND private.current_organisation_id() IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      JOIN public.role_assignments AS assignment ON assignment.user_profile_id = profile.id
      JOIN public.roles AS role_record ON role_record.id = assignment.role_id
      JOIN public.role_permissions AS role_permission ON role_permission.role_id = role_record.id
      JOIN public.permissions AS permission ON permission.id = role_permission.permission_id
      WHERE profile.id = private.current_user_id()
        AND profile.is_platform_user = true
        AND profile.status::text = 'ACTIVE' AND profile.deleted_at IS NULL
        AND assignment.scope::text = 'PLATFORM' AND assignment.organisation_id IS NULL
        AND assignment.revoked_at IS NULL AND assignment.deleted_at IS NULL
        AND assignment.valid_from <= pg_catalog.now()
        AND (assignment.valid_until IS NULL OR assignment.valid_until > pg_catalog.now())
        AND role_record.scope::text = 'PLATFORM'
        AND role_record.organisation_id IS NULL AND role_record.deleted_at IS NULL
        AND permission.key = p_permission_key
        AND permission.is_active = true AND permission.deleted_at IS NULL
        AND (NOT permission.requires_mfa OR private.current_aal() = 'AAL2')
    )
$function$;

CREATE OR REPLACE FUNCTION private.has_support_permission(
  p_organisation_id uuid,
  p_permission_key text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.support_access_grants AS grant_record
    JOIN public.user_profiles AS profile ON profile.id = grant_record.grantee_user_profile_id
    JOIN public.permissions AS permission ON permission.key = p_permission_key
    WHERE grant_record.id = private.current_support_grant_id()
      AND grant_record.organisation_id = p_organisation_id
      AND p_organisation_id = private.current_organisation_id()
      AND grant_record.grantee_user_profile_id = private.current_user_id()
      AND grant_record.status::text = 'ACTIVE'
      AND grant_record.starts_at <= pg_catalog.now()
      AND grant_record.expires_at > pg_catalog.now()
      AND grant_record.revoked_at IS NULL
      AND p_permission_key::varchar = ANY(grant_record.permission_keys)
      AND profile.is_platform_user = true
      AND profile.status::text = 'ACTIVE' AND profile.deleted_at IS NULL
      AND permission.is_active = true AND permission.deleted_at IS NULL
      AND private.current_aal() = 'AAL2'
  )
$function$;

ALTER FUNCTION private.has_active_membership(uuid) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.is_current_org_member(uuid) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.profile_is_in_current_org(uuid) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.has_platform_permission(text) OWNER TO businessos_policy_reader;
ALTER FUNCTION private.has_support_permission(uuid, text) OWNER TO businessos_policy_reader;
REVOKE CREATE ON SCHEMA private FROM businessos_policy_reader;

REVOKE ALL ON FUNCTION private.has_active_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_current_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.profile_is_in_current_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_platform_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_support_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_active_membership(uuid) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.is_current_org_member(uuid) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.profile_is_in_current_org(uuid) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.has_platform_permission(text) TO businessos_app;
GRANT EXECUTE ON FUNCTION private.has_support_permission(uuid, text) TO businessos_app;

-- Generic immutable-column guard used by security-boundary tables.
CREATE OR REPLACE FUNCTION private.enforce_immutable_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF (pg_catalog.to_jsonb(OLD) -> column_name)
       IS DISTINCT FROM (pg_catalog.to_jsonb(NEW) -> column_name) THEN
      RAISE EXCEPTION 'security-boundary column %.% is immutable', TG_TABLE_NAME, column_name
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_role_assignment_boundary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE role_scope_text text; role_organisation_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;

  SELECT role_record.scope::text, role_record.organisation_id
    INTO role_scope_text, role_organisation_id
  FROM public.roles AS role_record
  WHERE role_record.id = NEW.role_id
    AND role_record.deleted_at IS NULL AND role_record.is_assignable = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment requires an active assignable role'; END IF;
  IF role_scope_text <> NEW.scope::text THEN RAISE EXCEPTION 'role scope must equal assignment scope'; END IF;

  IF NEW.scope::text = 'PLATFORM' THEN
    IF role_organisation_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_profiles AS profile
      WHERE profile.id = NEW.user_profile_id AND profile.is_platform_user = true
        AND profile.status::text = 'ACTIVE' AND profile.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'platform assignment requires an active platform identity'; END IF;
  ELSE
    IF role_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION 'role and assignment must belong to the same organisation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organisation_memberships AS membership
      WHERE membership.id = NEW.organisation_membership_id
        AND membership.organisation_id = NEW.organisation_id
        AND membership.user_profile_id = NEW.user_profile_id
        AND membership.status::text IN ('INVITED', 'ACTIVE')
        AND membership.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'assignment requires a matching current membership'; END IF;
    IF NEW.scope::text = 'DEPARTMENT' AND NOT EXISTS (
      SELECT 1 FROM public.department_memberships AS membership
      WHERE membership.department_id = NEW.department_id
        AND membership.organisation_membership_id = NEW.organisation_membership_id
        AND membership.organisation_id = NEW.organisation_id
        AND membership.deleted_at IS NULL
        AND (membership.ends_at IS NULL OR membership.ends_at > pg_catalog.now())
    ) THEN RAISE EXCEPTION 'department assignment requires matching membership'; END IF;
    IF NEW.scope::text = 'TEAM' AND NOT EXISTS (
      SELECT 1 FROM public.team_memberships AS membership
      WHERE membership.team_id = NEW.team_id
        AND membership.organisation_membership_id = NEW.organisation_membership_id
        AND membership.organisation_id = NEW.organisation_id
        AND membership.deleted_at IS NULL
        AND (membership.ends_at IS NULL OR membership.ends_at > pg_catalog.now())
    ) THEN RAISE EXCEPTION 'team assignment requires matching membership'; END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_invitation_security()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE accepted_email text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text <> 'PENDING' THEN RAISE EXCEPTION 'new invitations must start PENDING'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organisation_memberships AS membership
      WHERE membership.organisation_id = NEW.organisation_id
        AND membership.user_profile_id = NEW.invited_by_user_profile_id
        AND membership.status::text = 'ACTIVE' AND membership.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'inviter must be an active organisation member'; END IF;
  ELSE
    IF OLD.status::text IN ('ACCEPTED', 'REVOKED', 'EXPIRED')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal invitation status cannot change';
    END IF;
  END IF;
  IF NEW.status::text = 'EXPIRED' AND NEW.expires_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'invitation cannot expire early';
  END IF;
  IF NEW.status::text = 'ACCEPTED' THEN
    SELECT profile.email INTO accepted_email FROM public.user_profiles AS profile
    WHERE profile.id = NEW.accepted_by_user_profile_id AND profile.deleted_at IS NULL;
    IF accepted_email IS NULL OR lower(btrim(accepted_email)) <> lower(btrim(NEW.email)) THEN
      RAISE EXCEPTION 'accepting profile must match the invited email';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_support_access_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE total_keys integer; distinct_keys integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = NEW.grantee_user_profile_id AND profile.is_platform_user = true
      AND profile.status::text = 'ACTIVE' AND profile.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'support grantee must be an active platform identity'; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.organisation_memberships AS membership
      WHERE membership.organisation_id = NEW.organisation_id
        AND membership.user_profile_id = NEW.requested_by_user_profile_id
        AND membership.status::text = 'ACTIVE' AND membership.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.user_profiles AS profile
      WHERE profile.id = NEW.requested_by_user_profile_id AND profile.is_platform_user = true
        AND profile.status::text = 'ACTIVE' AND profile.deleted_at IS NULL)
  ) THEN RAISE EXCEPTION 'support requester must be an active tenant or platform identity'; END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(NEW.permission_keys) AS permission_key
    WHERE permission_key IS NULL OR btrim(permission_key) = '') THEN
    RAISE EXCEPTION 'support permission keys cannot be blank';
  END IF;
  SELECT count(*), count(DISTINCT permission_key) INTO total_keys, distinct_keys
  FROM pg_catalog.unnest(NEW.permission_keys) AS permission_key;
  IF total_keys <> distinct_keys THEN RAISE EXCEPTION 'support permission keys must be unique'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(NEW.permission_keys) AS permission_key
    WHERE NOT EXISTS (SELECT 1 FROM public.permissions AS permission
      WHERE permission.key = permission_key
        AND permission.is_active = true AND permission.deleted_at IS NULL)
  ) THEN RAISE EXCEPTION 'support grant has an unknown or inactive permission'; END IF;

  IF NEW.status::text IN ('APPROVED', 'ACTIVE') AND NOT EXISTS (
    SELECT 1 FROM public.organisation_memberships AS membership
    WHERE membership.organisation_id = NEW.organisation_id
      AND membership.user_profile_id = NEW.approved_by_user_profile_id
      AND membership.status::text = 'ACTIVE' AND membership.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'support approver must be an active organisation member'; END IF;
  IF NEW.status::text = 'ACTIVE'
     AND (NEW.starts_at > pg_catalog.now() OR NEW.expires_at <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'active support access must be inside its approved window';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status::text <> 'REQUESTED' THEN
    RAISE EXCEPTION 'new support grants must start REQUESTED';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status::text IN ('DENIED', 'REVOKED', 'EXPIRED')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal support status cannot change';
    END IF;
    IF OLD.status::text = 'REQUESTED'
       AND NEW.status::text NOT IN ('REQUESTED', 'APPROVED', 'DENIED', 'REVOKED') THEN
      RAISE EXCEPTION 'invalid support transition from REQUESTED';
    END IF;
    IF OLD.status::text = 'APPROVED'
       AND NEW.status::text NOT IN ('APPROVED', 'ACTIVE', 'REVOKED', 'EXPIRED') THEN
      RAISE EXCEPTION 'invalid support transition from APPROVED';
    END IF;
    IF OLD.status::text = 'ACTIVE'
       AND NEW.status::text NOT IN ('ACTIVE', 'REVOKED', 'EXPIRED') THEN
      RAISE EXCEPTION 'invalid support transition from ACTIVE';
    END IF;
    IF OLD.status::text <> 'REQUESTED'
       AND NEW.permission_keys IS DISTINCT FROM OLD.permission_keys THEN
      RAISE EXCEPTION 'approved support permissions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.validate_event_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE session_user_id uuid; session_organisation_id uuid;
        grant_user_id uuid; grant_organisation_id uuid;
BEGIN
  IF NEW.user_session_id IS NOT NULL THEN
    SELECT session_record.user_profile_id, session_record.active_organisation_id
      INTO session_user_id, session_organisation_id
    FROM public.user_sessions AS session_record WHERE session_record.id = NEW.user_session_id;
    IF NEW.actor_user_profile_id IS NOT NULL
       AND session_user_id IS DISTINCT FROM NEW.actor_user_profile_id THEN
      RAISE EXCEPTION 'event session owner must equal actor';
    END IF;
    IF NEW.organisation_id IS NOT NULL
       AND session_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION 'event session must belong to event organisation';
    END IF;
  END IF;
  IF NEW.support_access_grant_id IS NOT NULL THEN
    SELECT grant_record.grantee_user_profile_id, grant_record.organisation_id
      INTO grant_user_id, grant_organisation_id
    FROM public.support_access_grants AS grant_record
    WHERE grant_record.id = NEW.support_access_grant_id;
    IF grant_user_id IS DISTINCT FROM NEW.actor_user_profile_id
       OR grant_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
      RAISE EXCEPTION 'event support grant must match actor and organisation';
    END IF;
  END IF;
  IF private.current_organisation_id() IS NOT NULL
     AND NEW.organisation_id IS DISTINCT FROM private.current_organisation_id() THEN
    RAISE EXCEPTION 'event organisation differs from transaction context';
  END IF;
  IF NEW.actor_type::text IN ('USER', 'SUPPORT')
     AND private.current_user_id() IS NOT NULL
     AND NEW.actor_user_profile_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'event actor differs from transaction context';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.reject_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN RAISE EXCEPTION 'audit_events are append-only'; END
$function$;

CREATE OR REPLACE FUNCTION private.protect_security_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'security_events cannot be deleted or truncated';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id
     OR OLD.actor_type IS DISTINCT FROM NEW.actor_type
     OR OLD.actor_user_profile_id IS DISTINCT FROM NEW.actor_user_profile_id
     OR OLD.actor_identifier IS DISTINCT FROM NEW.actor_identifier
     OR OLD.subject_user_profile_id IS DISTINCT FROM NEW.subject_user_profile_id
     OR OLD.user_session_id IS DISTINCT FROM NEW.user_session_id
     OR OLD.support_access_grant_id IS DISTINCT FROM NEW.support_access_grant_id
     OR OLD.event_type IS DISTINCT FROM NEW.event_type
     OR OLD.severity IS DISTINCT FROM NEW.severity
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.ip_address IS DISTINCT FROM NEW.ip_address
     OR OLD.user_agent IS DISTINCT FROM NEW.user_agent
     OR OLD.request_id IS DISTINCT FROM NEW.request_id
     OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
     OR OLD.resource_type IS DISTINCT FROM NEW.resource_type
     OR OLD.resource_id IS DISTINCT FROM NEW.resource_id
     OR OLD.metadata IS DISTINCT FROM NEW.metadata THEN
    RAISE EXCEPTION 'security event occurrence evidence is immutable';
  END IF;
  IF OLD.status::text IN ('RESOLVED', 'DISMISSED')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal security event status cannot change';
  END IF;
  IF OLD.status::text = 'INVESTIGATING'
     AND NEW.status::text NOT IN ('INVESTIGATING', 'RESOLVED', 'DISMISSED') THEN
    RAISE EXCEPTION 'invalid security event transition';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_immutable_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_role_assignment_boundary() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_invitation_security() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_support_access_grant() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.validate_event_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reject_audit_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_security_event() FROM PUBLIC;

-- Immutable security-boundary identifiers.
CREATE TRIGGER organisations_immutable BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id');
CREATE TRIGGER organisation_settings_immutable BEFORE UPDATE ON public.organisation_settings
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id', 'organisation_id');
CREATE TRIGGER user_profiles_immutable BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id');
CREATE TRIGGER organisation_memberships_immutable BEFORE UPDATE ON public.organisation_memberships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id', 'organisation_id', 'user_profile_id');
CREATE TRIGGER departments_immutable BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id', 'organisation_id');
CREATE TRIGGER department_memberships_immutable BEFORE UPDATE ON public.department_memberships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'department_id', 'organisation_membership_id');
CREATE TRIGGER teams_immutable BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id', 'organisation_id');
CREATE TRIGGER team_memberships_immutable BEFORE UPDATE ON public.team_memberships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'team_id', 'organisation_membership_id');
CREATE TRIGGER roles_immutable BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'scope', 'is_system');
CREATE TRIGGER permissions_immutable BEFORE UPDATE ON public.permissions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'key', 'resource', 'action', 'data_scope', 'is_sensitive', 'requires_mfa', 'allows_ai_use');
CREATE TRIGGER role_permissions_immutable BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns('id', 'role_id', 'permission_id');
CREATE TRIGGER role_assignments_immutable BEFORE UPDATE ON public.role_assignments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'role_id', 'user_profile_id', 'organisation_id',
    'organisation_membership_id', 'department_id', 'team_id', 'scope',
    'valid_from', 'valid_until', 'reason', 'granted_by_user_profile_id');
CREATE TRIGGER invitations_immutable BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'email', 'token_hash', 'invited_by_user_profile_id', 'expires_at');
CREATE TRIGGER user_sessions_immutable BEFORE UPDATE ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'user_profile_id', 'auth_session_id', 'created_at');
CREATE TRIGGER support_access_grants_immutable BEFORE UPDATE ON public.support_access_grants
  FOR EACH ROW EXECUTE FUNCTION private.enforce_immutable_columns(
    'id', 'organisation_id', 'grantee_user_profile_id',
    'requested_by_user_profile_id', 'reason', 'created_at');

CREATE TRIGGER role_assignments_validate BEFORE INSERT OR UPDATE ON public.role_assignments
  FOR EACH ROW EXECUTE FUNCTION private.validate_role_assignment_boundary();
CREATE TRIGGER invitations_validate BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION private.validate_invitation_security();
CREATE TRIGGER support_access_grants_validate BEFORE INSERT OR UPDATE ON public.support_access_grants
  FOR EACH ROW EXECUTE FUNCTION private.validate_support_access_grant();
CREATE TRIGGER audit_events_validate_context BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.validate_event_context();
CREATE TRIGGER security_events_validate_context BEFORE INSERT ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION private.validate_event_context();
CREATE TRIGGER audit_events_reject_update_delete BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_audit_event_mutation();
CREATE TRIGGER audit_events_reject_truncate BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.reject_audit_event_mutation();
CREATE TRIGGER security_events_protect_update_delete BEFORE UPDATE OR DELETE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION private.protect_security_event();
CREATE TRIGGER security_events_reject_truncate BEFORE TRUNCATE ON public.security_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.protect_security_event();

-- Lock the exposed public schema. Frontend clients use Supabase Auth only;
-- BusinessOS data is accessed through NestJS using a NOBYPASSRLS runtime role.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO businessos_app;
GRANT USAGE ON TYPE public.organisation_status, public.user_profile_status,
  public.membership_status, public.role_scope, public.assignment_scope,
  public.permission_data_scope, public.invitation_status, public.session_status,
  public.authentication_assurance_level, public.support_access_status,
  public.audit_actor_type, public.audit_outcome, public.security_severity,
  public.security_event_status
TO businessos_app, businessos_policy_reader;

GRANT SELECT, UPDATE ON public.organisations TO businessos_app;
GRANT SELECT, INSERT, UPDATE ON public.organisation_settings, public.user_profiles,
  public.organisation_memberships, public.departments, public.department_memberships,
  public.teams, public.team_memberships, public.roles, public.role_assignments,
  public.invitations, public.user_sessions, public.support_access_grants
TO businessos_app;
GRANT SELECT ON public.permissions TO businessos_app;
GRANT SELECT, INSERT, DELETE ON public.role_permissions TO businessos_app;
GRANT SELECT, INSERT ON public.audit_events TO businessos_app;
GRANT SELECT, INSERT, UPDATE ON public.security_events TO businessos_app;

-- RLS is mandatory on all 17 Sprint 0 tables.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organisations', 'organisation_settings', 'user_profiles',
    'organisation_memberships', 'departments', 'department_memberships',
    'teams', 'team_memberships', 'roles', 'permissions', 'role_permissions',
    'role_assignments', 'invitations', 'user_sessions',
    'support_access_grants', 'audit_events', 'security_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$rls$;

-- Policy-reader policies avoid recursive RLS inside authorization helpers.
CREATE POLICY policy_reader_organisations ON public.organisations
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_profiles ON public.user_profiles
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_memberships ON public.organisation_memberships
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_roles ON public.roles
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_permissions ON public.permissions
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_role_permissions ON public.role_permissions
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_role_assignments ON public.role_assignments
  FOR SELECT TO businessos_policy_reader USING (true);
CREATE POLICY policy_reader_support_grants ON public.support_access_grants
  FOR SELECT TO businessos_policy_reader USING (true);

-- Organisation switcher and current-tenant access.
CREATE POLICY organisations_select ON public.organisations
  FOR SELECT TO businessos_app
  USING (private.has_active_membership(id)
    OR private.has_platform_permission('platform.organisation.read'));
CREATE POLICY organisations_update ON public.organisations
  FOR UPDATE TO businessos_app
  USING (private.is_current_org_member(id))
  WITH CHECK (private.is_current_org_member(id));

CREATE POLICY organisation_settings_tenant ON public.organisation_settings
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id)
    OR private.has_support_permission(organisation_id, 'organisation.settings.read'))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO businessos_app
  USING (id = private.current_user_id()
    OR private.profile_is_in_current_org(id)
    OR private.has_platform_permission('platform.user.read'));
CREATE POLICY user_profiles_insert_self ON public.user_profiles
  FOR INSERT TO businessos_app WITH CHECK (id = private.current_user_id());
CREATE POLICY user_profiles_update_self ON public.user_profiles
  FOR UPDATE TO businessos_app
  USING (id = private.current_user_id()) WITH CHECK (id = private.current_user_id());

CREATE POLICY organisation_memberships_select ON public.organisation_memberships
  FOR SELECT TO businessos_app
  USING (user_profile_id = private.current_user_id()
    OR private.is_current_org_member(organisation_id));
CREATE POLICY organisation_memberships_write ON public.organisation_memberships
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY departments_tenant ON public.departments
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id)
    OR private.has_support_permission(organisation_id, 'department.read'))
  WITH CHECK (private.is_current_org_member(organisation_id));
CREATE POLICY department_memberships_tenant ON public.department_memberships
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));
CREATE POLICY teams_tenant ON public.teams
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id)
    OR private.has_support_permission(organisation_id, 'team.read'))
  WITH CHECK (private.is_current_org_member(organisation_id));
CREATE POLICY team_memberships_tenant ON public.team_memberships
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY roles_select ON public.roles
  FOR SELECT TO businessos_app
  USING ((organisation_id IS NOT NULL AND private.is_current_org_member(organisation_id))
    OR (organisation_id IS NULL AND private.has_platform_permission('platform.role.read')));
CREATE POLICY roles_tenant_write ON public.roles
  FOR ALL TO businessos_app
  USING (organisation_id IS NOT NULL AND scope <> 'PLATFORM' AND is_system = false
    AND private.is_current_org_member(organisation_id))
  WITH CHECK (organisation_id IS NOT NULL AND scope <> 'PLATFORM' AND is_system = false
    AND private.is_current_org_member(organisation_id));

CREATE POLICY permissions_read ON public.permissions
  FOR SELECT TO businessos_app USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT TO businessos_app
  USING (EXISTS (
    SELECT 1 FROM public.roles AS role_record
    WHERE role_record.id = role_id
      AND ((role_record.organisation_id IS NOT NULL
          AND private.is_current_org_member(role_record.organisation_id))
        OR (role_record.organisation_id IS NULL
          AND private.has_platform_permission('platform.role.read')))
  ));
CREATE POLICY role_permissions_tenant_write ON public.role_permissions
  FOR ALL TO businessos_app
  USING (EXISTS (
    SELECT 1 FROM public.roles AS role_record
    WHERE role_record.id = role_id
      AND role_record.organisation_id IS NOT NULL
      AND role_record.scope <> 'PLATFORM' AND role_record.is_system = false
      AND private.is_current_org_member(role_record.organisation_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.roles AS role_record
    WHERE role_record.id = role_id
      AND role_record.organisation_id IS NOT NULL
      AND role_record.scope <> 'PLATFORM' AND role_record.is_system = false
      AND private.is_current_org_member(role_record.organisation_id)
  ));

CREATE POLICY role_assignments_select ON public.role_assignments
  FOR SELECT TO businessos_app
  USING ((organisation_id IS NOT NULL AND private.is_current_org_member(organisation_id))
    OR (scope = 'PLATFORM' AND user_profile_id = private.current_user_id()));
CREATE POLICY role_assignments_tenant_write ON public.role_assignments
  FOR ALL TO businessos_app
  USING (organisation_id IS NOT NULL AND scope <> 'PLATFORM'
    AND private.is_current_org_member(organisation_id))
  WITH CHECK (organisation_id IS NOT NULL AND scope <> 'PLATFORM'
    AND private.is_current_org_member(organisation_id));

CREATE POLICY invitations_tenant ON public.invitations
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY user_sessions_select ON public.user_sessions
  FOR SELECT TO businessos_app
  USING (user_profile_id = private.current_user_id()
    OR (active_organisation_id IS NOT NULL
      AND private.is_current_org_member(active_organisation_id)));
CREATE POLICY user_sessions_insert_self ON public.user_sessions
  FOR INSERT TO businessos_app
  WITH CHECK (user_profile_id = private.current_user_id()
    AND (active_organisation_id IS NULL
      OR private.is_current_org_member(active_organisation_id)));
CREATE POLICY user_sessions_update_self ON public.user_sessions
  FOR UPDATE TO businessos_app
  USING (user_profile_id = private.current_user_id())
  WITH CHECK (user_profile_id = private.current_user_id()
    AND (active_organisation_id IS NULL
      OR private.is_current_org_member(active_organisation_id)));

CREATE POLICY support_access_grants_select ON public.support_access_grants
  FOR SELECT TO businessos_app
  USING (private.is_current_org_member(organisation_id)
    OR grantee_user_profile_id = private.current_user_id());
CREATE POLICY support_access_grants_tenant_write ON public.support_access_grants
  FOR ALL TO businessos_app
  USING (private.is_current_org_member(organisation_id))
  WITH CHECK (private.is_current_org_member(organisation_id));

CREATE POLICY audit_events_select ON public.audit_events
  FOR SELECT TO businessos_app
  USING ((organisation_id IS NOT NULL
      AND (private.is_current_org_member(organisation_id)
        OR private.has_support_permission(organisation_id, 'audit.read')))
    OR (organisation_id IS NULL AND private.has_platform_permission('platform.audit.read')));
CREATE POLICY audit_events_insert ON public.audit_events
  FOR INSERT TO businessos_app
  WITH CHECK ((organisation_id IS NOT NULL
      AND (private.is_current_org_member(organisation_id)
        OR private.has_support_permission(organisation_id, 'audit.write')))
    OR (organisation_id IS NULL AND private.has_platform_permission('platform.audit.write')));

CREATE POLICY security_events_select ON public.security_events
  FOR SELECT TO businessos_app
  USING ((organisation_id IS NOT NULL
      AND (private.is_current_org_member(organisation_id)
        OR private.has_support_permission(organisation_id, 'security.read')))
    OR (organisation_id IS NULL AND private.has_platform_permission('platform.security.read')));
CREATE POLICY security_events_insert ON public.security_events
  FOR INSERT TO businessos_app
  WITH CHECK ((organisation_id IS NOT NULL
      AND (private.is_current_org_member(organisation_id)
        OR private.has_support_permission(organisation_id, 'security.write')))
    OR (organisation_id IS NULL AND private.has_platform_permission('platform.security.write')));
CREATE POLICY security_events_update ON public.security_events
  FOR UPDATE TO businessos_app
  USING (organisation_id IS NOT NULL
    AND (private.is_current_org_member(organisation_id)
      OR private.has_support_permission(organisation_id, 'security.manage')))
  WITH CHECK (organisation_id IS NOT NULL
    AND (private.is_current_org_member(organisation_id)
      OR private.has_support_permission(organisation_id, 'security.manage')));

-- Future tables default to no public/Data API access. Each future migration must
-- still grant its runtime privileges and add explicit RLS policies.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
