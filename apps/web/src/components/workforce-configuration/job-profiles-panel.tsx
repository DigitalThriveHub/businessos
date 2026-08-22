"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Gauge,
  Pencil,
  Plus,
} from "lucide-react";

import type {
  JobProfile,
  JobProfileDuty,
  JobProfileKpi,
  WorkforceConfigurationSnapshot,
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
  nullableText,
  numeric,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
  toDateTimeLocal,
  toIsoDateTime,
  type RunWorkforceMutation,
} from "./workforce-configuration-ui";

type JobProfilesPanelProps = {
  snapshot: WorkforceConfigurationSnapshot;
  canManageProfiles: boolean;
  canManageKpis: boolean;
  pending: boolean;
  runMutation: RunWorkforceMutation;
};

function JobProfileForm({
  profile,
  snapshot,
  pending,
  runMutation,
  onCancel,
}: {
  profile: JobProfile | null;
  snapshot: WorkforceConfigurationSnapshot;
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const successful = await runMutation(
      profile
        ? {
            operation: "job_profile.update",
            jobProfileId: profile.id,
            payload: {
              name: fieldText(data, "name"),
              description: nullableText(data, "description"),
              purpose: nullableText(data, "purpose"),
              isManagerial: checked(data, "isManagerial"),
              isActive: checked(data, "isActive"),
              expectedVersion: profile.version,
            },
          }
        : {
            operation: "job_profile.create",
            payload: {
              key: fieldText(data, "key"),
              name: fieldText(data, "name"),
              description: nullableText(data, "description"),
              purpose: nullableText(data, "purpose"),
              departmentId: nullableText(data, "departmentId"),
              isManagerial: checked(data, "isManagerial"),
              isActive: false,
            },
          },
      profile ? "Job profile updated." : "Draft job profile created.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={profile?.id ?? "new-job-profile"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="text-base font-semibold text-slate-950">
          {profile ? "Edit job profile" : "Create draft job profile"}
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
                placeholder="immigration-case-worker"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-slate-800">
              Department scope
              <select name="departmentId" defaultValue="" className={inputClass}>
                <option value="">Organisation-wide role</option>
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
          Role name
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={profile?.name ?? ""}
            className={inputClass}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800">
            Description
            <textarea
              name="description"
              maxLength={4_000}
              defaultValue={profile?.description ?? ""}
              className={textareaClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Purpose
            <textarea
              name="purpose"
              maxLength={4_000}
              defaultValue={profile?.purpose ?? ""}
              className={textareaClass}
            />
          </label>
        </div>

        <CheckboxField
          name="isManagerial"
          label="Managerial job profile"
          description="Allows onboarding plans using this profile to carry management responsibility."
          defaultChecked={profile?.isManagerial ?? false}
        />

        {profile ? (
          <CheckboxField
            name="isActive"
            label="Active job profile"
            description="Activation requires an active duty. Archiving is blocked while live workforce or onboarding assignments depend on it."
            defaultChecked={profile.isActive}
          />
        ) : (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            New profiles are created as drafts. Add at least one duty, review KPI
            targets, then activate the profile.
          </p>
        )}

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

function DutyForm({
  profile,
  duty,
  pending,
  runMutation,
  onCancel,
}: {
  profile: JobProfile;
  duty: JobProfileDuty | null;
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const common = {
      title: fieldText(data, "title"),
      description: fieldText(data, "description"),
      position: numeric(data, "position"),
      isCritical: checked(data, "isCritical"),
      requiresEvidence: checked(data, "requiresEvidence"),
      isActive: checked(data, "isActive"),
    };
    const successful = await runMutation(
      duty
        ? {
            operation: "job_profile_duty.update",
            jobProfileId: profile.id,
            dutyId: duty.id,
            payload: { ...common, expectedUpdatedAt: duty.updatedAt },
          }
        : {
            operation: "job_profile_duty.create",
            jobProfileId: profile.id,
            payload: { code: fieldText(data, "code"), ...common },
          },
      duty ? "Duty updated." : "Duty added.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={duty?.id ?? "new-duty"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="font-semibold text-slate-950">
          {duty ? "Edit duty" : "Add duty"}
        </legend>

        {!duty ? (
          <label className="block text-sm font-medium text-slate-800">
            Protected duty code
            <input
              name="code"
              required
              maxLength={120}
              placeholder="verify-client-evidence"
              className={inputClass}
            />
          </label>
        ) : (
          <p className="text-sm text-slate-600">
            Protected code: <span className="font-mono">{duty.code}</span>
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
          <label className="block text-sm font-medium text-slate-800">
            Duty title
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={duty?.title ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Position
            <input
              name="position"
              type="number"
              min={1}
              max={32_767}
              required
              defaultValue={duty?.position ?? profile.duties.length + 1}
              className={inputClass}
            />
          </label>
        </div>

        <label className="block text-sm font-medium text-slate-800">
          Expected duty and evidence standard
          <textarea
            name="description"
            required
            maxLength={4_000}
            defaultValue={duty?.description ?? ""}
            className={textareaClass}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <CheckboxField
            name="isCritical"
            label="Critical duty"
            defaultChecked={duty?.isCritical ?? false}
          />
          <CheckboxField
            name="requiresEvidence"
            label="Evidence required"
            defaultChecked={duty?.requiresEvidence ?? false}
          />
          <CheckboxField
            name="isActive"
            label="Active duty"
            defaultChecked={duty?.isActive ?? true}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!duty} />
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function ProfileKpiForm({
  profile,
  assignment,
  snapshot,
  pending,
  runMutation,
  onCancel,
}: {
  profile: JobProfile;
  assignment: JobProfileKpi | null;
  snapshot: WorkforceConfigurationSnapshot;
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  const compatibleDefinitions = snapshot.kpiDefinitions.filter(
    (definition) =>
      definition.isActive &&
      (!definition.departmentId || definition.departmentId === profile.departmentId),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const common = {
      targetValue: nullableText(data, "targetValue"),
      minimumValue: nullableText(data, "minimumValue"),
      maximumValue: nullableText(data, "maximumValue"),
      weightPercent: numeric(data, "weightPercent"),
    };
    const successful = await runMutation(
      assignment
        ? {
            operation: "job_profile_kpi.update",
            jobProfileId: profile.id,
            assignmentId: assignment.id,
            payload: {
              ...common,
              endsAt: toIsoDateTime(fieldText(data, "endsAt")) ?? null,
              expectedUpdatedAt: assignment.updatedAt,
            },
          }
        : {
            operation: "job_profile_kpi.create",
            jobProfileId: profile.id,
            payload: {
              kpiDefinitionId: fieldText(data, "kpiDefinitionId"),
              ...common,
              startsAt: toIsoDateTime(fieldText(data, "startsAt")),
              endsAt: toIsoDateTime(fieldText(data, "endsAt")) ?? null,
            },
          },
      assignment ? "KPI target updated." : "KPI target assigned.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  const definition = assignment
    ? snapshot.kpiDefinitions.find(
        (item) => item.id === assignment.kpiDefinitionId,
      )
    : null;

  return (
    <form
      key={assignment?.id ?? "new-profile-kpi"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="font-semibold text-slate-950">
          {assignment ? "Edit KPI target" : "Assign KPI target"}
        </legend>

        {assignment ? (
          <p className="text-sm text-slate-600">
            KPI: <span className="font-medium">{definition?.name ?? "KPI"}</span>
            {assignment.endsAt ? " · This assignment has ended" : ""}
          </p>
        ) : (
          <label className="block text-sm font-medium text-slate-800">
            KPI definition
            <select name="kpiDefinitionId" required className={inputClass}>
              <option value="">Select a KPI</option>
              {compatibleDefinitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium text-slate-800">
            Target
            <input
              name="targetValue"
              inputMode="decimal"
              defaultValue={assignment?.targetValue ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Minimum
            <input
              name="minimumValue"
              inputMode="decimal"
              defaultValue={assignment?.minimumValue ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Maximum
            <input
              name="maximumValue"
              inputMode="decimal"
              defaultValue={assignment?.maximumValue ?? ""}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Weight %
            <input
              name="weightPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              required
              defaultValue={assignment?.weightPercent ?? "0"}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {!assignment ? (
            <label className="block text-sm font-medium text-slate-800">
              Effective from
              <input name="startsAt" type="datetime-local" className={inputClass} />
            </label>
          ) : (
            <div className="text-sm text-slate-600">
              <span className="block font-medium text-slate-800">Effective from</span>
              <span className="mt-2 block">{new Date(assignment.startsAt).toLocaleString("en-GB")}</span>
            </div>
          )}
          <label className="block text-sm font-medium text-slate-800">
            Effective until (optional)
            <input
              name="endsAt"
              type="datetime-local"
              defaultValue={toDateTimeLocal(assignment?.endsAt ?? null)}
              className={inputClass}
            />
          </label>
        </div>

        <p className="text-xs leading-5 text-slate-600">
          Overlapping KPI weights are validated across effective time windows and
          cannot exceed 100%. Ended assignments cannot be reopened.
        </p>

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!assignment} />
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function JobProfilesPanel({
  snapshot,
  canManageProfiles,
  canManageKpis,
  pending,
  runMutation,
}: JobProfilesPanelProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    snapshot.jobProfiles[0]?.id ?? "",
  );
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [editingDutyId, setEditingDutyId] = useState<string | null>(null);
  const [showDutyForm, setShowDutyForm] = useState(false);
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null);
  const [showKpiForm, setShowKpiForm] = useState(false);

  const selectedProfile = useMemo(
    () =>
      snapshot.jobProfiles.find((profile) => profile.id === selectedProfileId) ??
      snapshot.jobProfiles[0] ??
      null,
    [selectedProfileId, snapshot.jobProfiles],
  );
  const editingDuty =
    selectedProfile?.duties.find((duty) => duty.id === editingDutyId) ?? null;
  const editingKpi =
    selectedProfile?.kpis.find((kpi) => kpi.id === editingKpiId) ?? null;
  const departmentNames = useMemo(
    () => new Map(snapshot.departments.map((item) => [item.id, item.name])),
    [snapshot.departments],
  );
  const kpiNames = useMemo(
    () => new Map(snapshot.kpiDefinitions.map((item) => [item.id, item.name])),
    [snapshot.kpiDefinitions],
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Job profiles, duties and targets"
        description="Define what each role exists to achieve, its evidence-bearing duties and effective KPI targets. Profile and child changes use optimistic version control."
        action={
          canManageProfiles ? (
            <button
              type="button"
              onClick={() => {
                setCreatingProfile(true);
                setShowProfileForm(true);
              }}
              className={primaryButtonClass}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              New job profile
            </button>
          ) : undefined
        }
      />

      {showProfileForm && canManageProfiles ? (
        <JobProfileForm
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

      {snapshot.jobProfiles.length === 0 ? (
        <EmptyState>
          Create a draft job profile, add a duty, then activate it for onboarding.
        </EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {snapshot.jobProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setShowDutyForm(false);
                  setShowKpiForm(false);
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
                  {profile.duties.filter((duty) => duty.isActive).length} duties ·{" "}
                  {profile.kpis.filter((kpi) => !kpi.endsAt).length} KPI targets ·{" "}
                  {profile.isActive ? "active" : "draft/archived"}
                </span>
              </button>
            ))}
          </aside>

          {selectedProfile ? (
            <section className="min-w-0 space-y-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <BriefcaseBusiness aria-hidden="true" className="h-5 w-5" />
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
                          "Department role"
                        : "Organisation-wide role"}
                      {selectedProfile.isManagerial ? " · Managerial" : ""} ·
                      version {selectedProfile.version}
                    </p>
                  </div>
                </div>
                {canManageProfiles ? (
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

              {selectedProfile.purpose || selectedProfile.description ? (
                <div className="grid gap-3 text-sm leading-6 text-slate-600 md:grid-cols-2">
                  <p>{selectedProfile.purpose ?? "No purpose recorded."}</p>
                  <p>{selectedProfile.description ?? "No description recorded."}</p>
                </div>
              ) : null}

              <div className="space-y-3 border-t border-slate-200 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 font-semibold text-slate-950">
                      <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
                      Duties
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Ordered responsibilities, evidence and criticality.
                    </p>
                  </div>
                  {canManageProfiles ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDutyId(null);
                        setShowDutyForm(true);
                      }}
                      className={secondaryButtonClass}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      Add duty
                    </button>
                  ) : null}
                </div>

                {showDutyForm && canManageProfiles ? (
                  <DutyForm
                    profile={selectedProfile}
                    duty={editingDuty}
                    pending={pending}
                    runMutation={runMutation}
                    onCancel={() => {
                      setEditingDutyId(null);
                      setShowDutyForm(false);
                    }}
                  />
                ) : null}

                {selectedProfile.duties.length === 0 ? (
                  <EmptyState>No duties have been recorded for this role.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {selectedProfile.duties.map((duty) => (
                      <article
                        key={duty.id}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h5 className="font-medium text-slate-900">
                              {duty.position}. {duty.title}
                            </h5>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                              {duty.description}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              {duty.isCritical ? "Critical" : "Standard"} ·{" "}
                              {duty.requiresEvidence
                                ? "Evidence required"
                                : "Evidence optional"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <ActiveBadge active={duty.isActive} />
                            {canManageProfiles ? (
                              <button
                                type="button"
                                aria-label={`Edit ${duty.title}`}
                                onClick={() => {
                                  setEditingDutyId(duty.id);
                                  setShowDutyForm(true);
                                }}
                                className={secondaryButtonClass}
                              >
                                <Pencil aria-hidden="true" className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 font-semibold text-slate-950">
                      <Gauge aria-hidden="true" className="h-4 w-4" />
                      KPI targets
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Effective targets with a maximum combined weight of 100%.
                    </p>
                  </div>
                  {canManageProfiles && canManageKpis ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKpiId(null);
                        setShowKpiForm(true);
                      }}
                      disabled={snapshot.kpiDefinitions.length === 0}
                      className={secondaryButtonClass}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      Assign KPI
                    </button>
                  ) : null}
                </div>

                {showKpiForm && canManageProfiles && canManageKpis ? (
                  <ProfileKpiForm
                    profile={selectedProfile}
                    assignment={editingKpi}
                    snapshot={snapshot}
                    pending={pending}
                    runMutation={runMutation}
                    onCancel={() => {
                      setEditingKpiId(null);
                      setShowKpiForm(false);
                    }}
                  />
                ) : null}

                {selectedProfile.kpis.length === 0 ? (
                  <EmptyState>No KPI targets have been assigned to this role.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {selectedProfile.kpis.map((assignment) => (
                      <article
                        key={assignment.id}
                        className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center"
                      >
                        <div>
                          <h5 className="font-medium text-slate-900">
                            {kpiNames.get(assignment.kpiDefinitionId) ?? "KPI"}
                          </h5>
                          <p className="mt-1 text-xs text-slate-500">
                            Target {assignment.targetValue ?? "—"} · Weight{" "}
                            {assignment.weightPercent}% ·{" "}
                            {assignment.endsAt ? "Ended" : "Current"}
                          </p>
                        </div>
                        {canManageProfiles && canManageKpis ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKpiId(assignment.id);
                              setShowKpiForm(true);
                            }}
                            className={secondaryButtonClass}
                          >
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                            Edit target
                          </button>
                        ) : null}
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