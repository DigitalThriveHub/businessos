"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Bot, Pencil, Plus, ShieldCheck } from "lucide-react";

import {
  AGENT_AUTHORITY_LEVELS,
  PERMISSION_DATA_SCOPES,
  type AgentAuthorityLevel,
  type AgentPolicy,
  type AgentProfile,
  type PermissionDataScope,
  type WorkforceConfigurationSnapshot,
} from "@/lib/workforce-configuration";
import {
  ActiveBadge,
  CheckboxField,
  EmptyState,
  SaveButton,
  SectionHeading,
  checked,
  fieldText,
  inputClass,
  numeric,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
  type RunWorkforceMutation,
} from "./workforce-configuration-ui";

type AgentProfilesPanelProps = {
  snapshot: WorkforceConfigurationSnapshot;
  canManage: boolean;
  pending: boolean;
  runMutation: RunWorkforceMutation;
};

const LABELS: Record<string, string> = {
  DISABLED: "Disabled",
  READ: "Read",
  DRAFT: "Draft",
  PROPOSE: "Propose",
  EXECUTE_WITH_APPROVAL: "Execute with approval",
  EXECUTE_AUTOMATIC: "Execute automatically",
  OWN: "Own records",
  ASSIGNED: "Assigned records",
  TEAM: "Team",
  DEPARTMENT: "Department",
  ORGANISATION: "Organisation",
  SHARED: "Explicitly shared",
  PLATFORM: "Platform",
};

function AgentProfileForm({
  profile,
  snapshot,
  pending,
  runMutation,
  onCancel,
}: {
  profile: AgentProfile | null;
  snapshot: WorkforceConfigurationSnapshot;
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const common = {
      name: fieldText(data, "name"),
      description: fieldText(data, "description"),
      behaviourInstructions: fieldText(data, "behaviourInstructions"),
      authorityCeiling: fieldText(
        data,
        "authorityCeiling",
      ) as AgentAuthorityLevel,
      requiresHumanReview: checked(data, "requiresHumanReview"),
      isActive: checked(data, "isActive"),
    };
    const successful = await runMutation(
      profile
        ? {
            operation: "agent_profile.update",
            agentProfileId: profile.id,
            payload: { ...common, expectedVersion: profile.version },
          }
        : {
            operation: "agent_profile.create",
            payload: {
              key: fieldText(data, "key"),
              departmentId: fieldText(data, "departmentId") || null,
              ...common,
            },
          },
      profile ? "AI-agent profile updated." : "AI-agent profile created.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={profile?.id ?? "new-agent-profile"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="text-base font-semibold text-slate-950">
          {profile ? "Edit AI-agent profile" : "Create AI-agent profile"}
        </legend>

        {profile ? (
          <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
            Protected key: <span className="font-mono">{profile.key}</span> ·
            version {profile.version}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-800">
              Protected key
              <input
                name="key"
                required
                maxLength={120}
                placeholder="case-worker-assistant"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-slate-800">
              Department scope
              <select name="departmentId" defaultValue="" className={inputClass}>
                <option value="">Organisation-wide profile</option>
                {snapshot.departments
                  .filter((department) => department.isActive)
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}

        <label className="block text-sm font-medium text-slate-800">
          Profile name
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={profile?.name ?? ""}
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Business purpose and limits
          <textarea
            name="description"
            required
            maxLength={4_000}
            defaultValue={profile?.description ?? ""}
            className={textareaClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Behaviour instructions
          <textarea
            name="behaviourInstructions"
            required
            maxLength={20_000}
            defaultValue={profile?.behaviourInstructions ?? ""}
            className={`${textareaClass} min-h-44 font-mono text-xs leading-6`}
          />
          <span className="mt-2 block text-xs leading-5 text-slate-500">
            Define permitted objectives, evidence requirements, escalation rules,
            prohibited actions and when the agent must stop.
          </span>
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Maximum authority ceiling
          <select
            name="authorityCeiling"
            defaultValue={profile?.authorityCeiling ?? "PROPOSE"}
            className={inputClass}
          >
            {AGENT_AUTHORITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {LABELS[level]}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <CheckboxField
            name="requiresHumanReview"
            label="Human review required"
            description="Automatic execution cannot be combined with per-action human review; use execute-with-approval instead."
            defaultChecked={profile?.requiresHumanReview ?? true}
          />
          <CheckboxField
            name="isActive"
            label="Active AI-agent profile"
            description="Archiving is blocked while workforce or pending onboarding plans use this profile."
            defaultChecked={profile?.isActive ?? true}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!profile} />
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function AgentPolicyForm({
  profile,
  policy,
  snapshot,
  pending,
  runMutation,
  onCancel,
}: {
  profile: AgentProfile;
  policy: AgentPolicy | null;
  snapshot: WorkforceConfigurationSnapshot;
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  const [configurationError, setConfigurationError] = useState<string | null>(
    null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    let configuration: Record<string, unknown>;

    try {
      const value: unknown = JSON.parse(fieldText(data, "configuration") || "{}");

      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Configuration must be an object.");
      }

      configuration = value as Record<string, unknown>;
      setConfigurationError(null);
    } catch {
      setConfigurationError("Enter a valid JSON object. Arrays are not allowed.");
      return;
    }

    const common = {
      requiredPermissionKey: fieldText(data, "requiredPermissionKey"),
      authorityLevel: fieldText(data, "authorityLevel") as AgentAuthorityLevel,
      maximumDataScope: fieldText(
        data,
        "maximumDataScope",
      ) as PermissionDataScope,
      requiresApproval: checked(data, "requiresApproval"),
      requiresMfa: checked(data, "requiresMfa"),
      maxActionsPerRun: numeric(data, "maxActionsPerRun"),
      configuration,
      isActive: checked(data, "isActive"),
    };
    const successful = await runMutation(
      policy
        ? {
            operation: "agent_policy.update",
            agentProfileId: profile.id,
            policyId: policy.id,
            payload: { ...common, expectedUpdatedAt: policy.updatedAt },
          }
        : {
            operation: "agent_policy.create",
            agentProfileId: profile.id,
            payload: { toolKey: fieldText(data, "toolKey"), ...common },
          },
      policy ? "AI policy updated." : "AI policy created.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={policy?.id ?? "new-agent-policy"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="font-semibold text-slate-950">
          {policy ? "Edit tool policy" : "Add tool policy"}
        </legend>

        {policy ? (
          <p className="text-sm text-slate-600">
            Protected tool key: <span className="font-mono">{policy.toolKey}</span>
          </p>
        ) : (
          <label className="block text-sm font-medium text-slate-800">
            Protected tool key
            <input
              name="toolKey"
              required
              maxLength={160}
              placeholder="crm.clients.read"
              className={inputClass}
            />
          </label>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800">
            Required human permission
            <select
              name="requiredPermissionKey"
              required
              defaultValue={policy?.requiredPermissionKey ?? ""}
              className={inputClass}
            >
              <option value="">Select an AI-approved permission</option>
              {snapshot.aiPermissions.map((permission) => (
                <option key={permission.key} value={permission.key}>
                  {permission.name} ({permission.key})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800">
            Authority level
            <select
              name="authorityLevel"
              defaultValue={policy?.authorityLevel ?? "READ"}
              className={inputClass}
            >
              {AGENT_AUTHORITY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LABELS[level]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800">
            Maximum data scope
            <select
              name="maximumDataScope"
              defaultValue={policy?.maximumDataScope ?? "ASSIGNED"}
              className={inputClass}
            >
              {PERMISSION_DATA_SCOPES.filter(
                (scope) => scope !== "PLATFORM",
              ).map((scope) => (
                <option key={scope} value={scope}>
                  {LABELS[scope]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Maximum actions per run
            <input
              name="maxActionsPerRun"
              type="number"
              min={1}
              max={250}
              required
              defaultValue={policy?.maxActionsPerRun ?? 25}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <CheckboxField
            name="requiresApproval"
            label="Approval required"
            description="Mandatory for execute-with-approval; prohibited for automatic execution."
            defaultChecked={policy?.requiresApproval ?? true}
          />
          <CheckboxField
            name="requiresMfa"
            label="MFA required"
            description="Cannot be weaker than the underlying permission."
            defaultChecked={policy?.requiresMfa ?? true}
          />
          <CheckboxField
            name="isActive"
            label="Active policy"
            defaultChecked={policy?.isActive ?? true}
          />
        </div>

        <label className="block text-sm font-medium text-slate-800">
          Tool configuration (JSON object)
          <textarea
            name="configuration"
            spellCheck={false}
            defaultValue={JSON.stringify(policy?.configuration ?? {}, null, 2)}
            aria-invalid={configurationError ? true : undefined}
            aria-describedby={configurationError ? "policy-json-error" : undefined}
            className={`${textareaClass} min-h-36 font-mono text-xs leading-6`}
          />
        </label>
        {configurationError ? (
          <p id="policy-json-error" role="alert" className="text-sm text-red-700">
            {configurationError}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-slate-600">
          Do not store credentials or secrets here. Configuration is capped at 16
          KiB; audit events record key names, never configuration values.
        </p>

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!policy} />
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function AgentProfilesPanel({
  snapshot,
  canManage,
  pending,
  runMutation,
}: AgentProfilesPanelProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    snapshot.agentProfiles[0]?.id ?? "",
  );
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [showPolicyForm, setShowPolicyForm] = useState(false);

  const selectedProfile = useMemo(
    () =>
      snapshot.agentProfiles.find(
        (profile) => profile.id === selectedProfileId,
      ) ?? snapshot.agentProfiles[0] ?? null,
    [selectedProfileId, snapshot.agentProfiles],
  );
  const editingPolicy =
    selectedProfile?.policies.find((policy) => policy.id === editingPolicyId) ??
    null;
  const departmentNames = useMemo(
    () => new Map(snapshot.departments.map((item) => [item.id, item.name])),
    [snapshot.departments],
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        title="AI-agent profiles and tool policies"
        description="Set explicit behavioural instructions and maximum authority. Runtime access remains the intersection of this policy, the employee’s effective permissions, data scope, approval and MFA."
        action={
          canManage ? (
            <button
              type="button"
              onClick={() => {
                setCreatingProfile(true);
                setShowProfileForm(true);
              }}
              className={primaryButtonClass}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              New AI profile
            </button>
          ) : undefined
        }
      />

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
        <div className="flex gap-3">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            These records define maximum authority only. They do not bypass RBAC,
            tenant RLS, consent, legal basis, retention, human approval or runtime
            safety checks.
          </p>
        </div>
      </div>

      {snapshot.aiPermissions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          No business permission is currently approved for AI use. This is a safe
          default: add tool policies only after the corresponding deterministic
          workflow, runtime adapter, approval control and monitoring are live.
        </div>
      ) : null}

      {showProfileForm && canManage ? (
        <AgentProfileForm
          profile={creatingProfile ? null : selectedProfile}
          snapshot={snapshot}
          pending={pending}
          runMutation={runMutation}
          onCancel={() => {
            setCreatingProfile(false);
            setShowProfileForm(false);
          }}
        />
      ) : null}

      {snapshot.agentProfiles.length === 0 ? (
        <EmptyState>
          Create an AI-agent profile before assigning one during workforce onboarding.
        </EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {snapshot.agentProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setShowPolicyForm(false);
                }}
                className={
                  selectedProfile?.id === profile.id
                    ? "w-full rounded-xl bg-slate-950 p-4 text-left text-white shadow-sm"
                    : "w-full rounded-xl border border-slate-200 bg-white p-4 text-left text-slate-900 transition hover:border-slate-300 hover:shadow-sm"
                }
              >
                <span className="block font-semibold">{profile.name}</span>
                <span
                  className={`mt-1 block text-xs ${
                    selectedProfile?.id === profile.id
                      ? "text-slate-300"
                      : "text-slate-500"
                  }`}
                >
                  {LABELS[profile.authorityCeiling]} · {profile.policies.length}{" "}
                  policies · {profile.isActive ? "active" : "archived"}
                </span>
              </button>
            ))}
          </aside>

          {selectedProfile ? (
            <section className="min-w-0 space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <Bot aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">
                        {selectedProfile.name}
                      </h3>
                      <ActiveBadge active={selectedProfile.isActive} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedProfile.departmentId
                        ? departmentNames.get(selectedProfile.departmentId) ??
                          "Department profile"
                        : "Organisation-wide"}
                      {" · "}
                      {LABELS[selectedProfile.authorityCeiling]} · version{" "}
                      {selectedProfile.version}
                    </p>
                  </div>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingProfile(false);
                      setShowProfileForm(true);
                    }}
                    className={secondaryButtonClass}
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                    Edit profile
                  </button>
                ) : null}
              </div>

              <p className="text-sm leading-6 text-slate-600">
                {selectedProfile.description}
              </p>
              <details className="rounded-xl border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-900">
                  Review behaviour instructions
                </summary>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">
                  {selectedProfile.behaviourInstructions}
                </pre>
              </details>

              <div className="space-y-3 border-t border-slate-200 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-slate-950">Tool policies</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Permission, scope, approval, MFA and action-rate boundaries.
                    </p>
                  </div>
                  {canManage && selectedProfile.isActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPolicyId(null);
                        setShowPolicyForm(true);
                      }}
                      disabled={snapshot.aiPermissions.length === 0}
                      className={secondaryButtonClass}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      Add policy
                    </button>
                  ) : null}
                </div>

                {showPolicyForm && canManage && selectedProfile.isActive ? (
                  <AgentPolicyForm
                    profile={selectedProfile}
                    policy={editingPolicy}
                    snapshot={snapshot}
                    pending={pending}
                    runMutation={runMutation}
                    onCancel={() => {
                      setEditingPolicyId(null);
                      setShowPolicyForm(false);
                    }}
                  />
                ) : null}

                {selectedProfile.policies.length === 0 ? (
                  <EmptyState>
                    No tool is available to this profile until an explicit policy
                    is added.
                  </EmptyState>
                ) : (
                  <div className="space-y-2">
                    {selectedProfile.policies.map((policy) => (
                      <article
                        key={policy.id}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h5 className="font-mono text-sm font-semibold text-slate-900">
                                {policy.toolKey}
                              </h5>
                              <ActiveBadge active={policy.isActive} />
                            </div>
                            <p className="mt-2 text-xs leading-5 text-slate-600">
                              {policy.requiredPermissionKey} ·{" "}
                              {LABELS[policy.authorityLevel]} ·{" "}
                              {LABELS[policy.maximumDataScope]} · max{" "}
                              {policy.maxActionsPerRun} actions/run
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {policy.requiresApproval
                                ? "Approval required"
                                : "No per-action approval"}
                              {" · "}
                              {policy.requiresMfa ? "MFA required" : "MFA not required"}
                            </p>
                          </div>
                          {canManage && selectedProfile.isActive ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPolicyId(policy.id);
                                setShowPolicyForm(true);
                              }}
                              className={secondaryButtonClass}
                            >
                              <Pencil aria-hidden="true" className="h-4 w-4" />
                              Edit
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}