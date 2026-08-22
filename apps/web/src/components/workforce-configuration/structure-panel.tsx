"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Users } from "lucide-react";

import type {
  WorkforceConfigurationSnapshot,
  WorkforceDepartment,
  WorkforceTeam,
} from "@/lib/workforce-configuration";
import {
  ActiveBadge,
  CheckboxField,
  EmptyState,
  SaveButton,
  SectionHeading,
  fieldText,
  inputClass,
  nullableText,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
  type RunWorkforceMutation,
} from "./workforce-configuration-ui";

type StructurePanelProps = {
  snapshot: WorkforceConfigurationSnapshot;
  canManage: boolean;
  pending: boolean;
  runMutation: RunWorkforceMutation;
};

function DepartmentForm({
  department,
  departments,
  pending,
  runMutation,
  onCancel,
}: {
  department: WorkforceDepartment | null;
  departments: WorkforceDepartment[];
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const payload = {
      name: fieldText(data, "name"),
      code: nullableText(data, "code"),
      description: nullableText(data, "description"),
      parentId: nullableText(data, "parentId"),
      isActive: data.get("isActive") === "on",
      ...(department ? { expectedUpdatedAt: department.updatedAt } : {}),
    };
    const successful = await runMutation(
      department
        ? {
            operation: "department.update",
            departmentId: department.id,
            payload: {
              ...payload,
              expectedUpdatedAt: department.updatedAt,
            },
          }
        : { operation: "department.create", payload },
      department ? "Department updated." : "Department created.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={department?.id ?? "new-department"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="text-base font-semibold text-slate-950">
          {department ? "Edit department" : "Create department"}
        </legend>

        <label className="block text-sm font-medium text-slate-800">
          Name
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={department?.name ?? ""}
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Code
          <input
            name="code"
            maxLength={50}
            defaultValue={department?.code ?? ""}
            placeholder="CLIENT-SERVICES"
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Parent department
          <select
            name="parentId"
            defaultValue={department?.parentId ?? ""}
            className={inputClass}
          >
            <option value="">No parent department</option>
            {departments
              .filter(
                (option) => option.isActive && option.id !== department?.id,
              )
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Description
          <textarea
            name="description"
            maxLength={4_000}
            defaultValue={department?.description ?? ""}
            className={textareaClass}
          />
        </label>

        <CheckboxField
          name="isActive"
          label="Active department"
          description="Archiving is blocked while active teams, people, roles, profiles or onboarding plans depend on it."
          defaultChecked={department?.isActive ?? true}
        />

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!department} />
          <button
            type="button"
            onClick={onCancel}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function TeamForm({
  team,
  departments,
  pending,
  runMutation,
  onCancel,
}: {
  team: WorkforceTeam | null;
  departments: WorkforceDepartment[];
  pending: boolean;
  runMutation: RunWorkforceMutation;
  onCancel: () => void;
}) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const payload = {
      name: fieldText(data, "name"),
      code: nullableText(data, "code"),
      description: nullableText(data, "description"),
      departmentId: nullableText(data, "departmentId"),
      isActive: data.get("isActive") === "on",
    };
    const successful = await runMutation(
      team
        ? {
            operation: "team.update",
            teamId: team.id,
            payload: { ...payload, expectedUpdatedAt: team.updatedAt },
          }
        : { operation: "team.create", payload },
      team ? "Team updated." : "Team created.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={team?.id ?? "new-team"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="text-base font-semibold text-slate-950">
          {team ? "Edit team" : "Create team"}
        </legend>

        <label className="block text-sm font-medium text-slate-800">
          Name
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={team?.name ?? ""}
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Code
          <input
            name="code"
            maxLength={50}
            defaultValue={team?.code ?? ""}
            placeholder="CASEWORK-A"
            className={inputClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Department
          <select
            name="departmentId"
            defaultValue={team?.departmentId ?? ""}
            className={inputClass}
          >
            <option value="">Organisation-wide team</option>
            {departments
              .filter((department) => department.isActive)
              .map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Description
          <textarea
            name="description"
            maxLength={4_000}
            defaultValue={team?.description ?? ""}
            className={textareaClass}
          />
        </label>

        <CheckboxField
          name="isActive"
          label="Active team"
          description="Teams with active members, assignments, roles or onboarding plans cannot be archived or moved."
          defaultChecked={team?.isActive ?? true}
        />

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!team} />
          <button
            type="button"
            onClick={onCancel}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function StructurePanel({
  snapshot,
  canManage,
  pending,
  runMutation,
}: StructurePanelProps) {
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(
    null,
  );
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [showDepartmentForm, setShowDepartmentForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);

  const editingDepartment = useMemo(
    () =>
      snapshot.departments.find(
        (department) => department.id === editingDepartmentId,
      ) ?? null,
    [editingDepartmentId, snapshot.departments],
  );
  const editingTeam = useMemo(
    () => snapshot.teams.find((team) => team.id === editingTeamId) ?? null,
    [editingTeamId, snapshot.teams],
  );
  const departmentNames = useMemo(
    () => new Map(snapshot.departments.map((item) => [item.id, item.name])),
    [snapshot.departments],
  );

  function editDepartment(departmentId: string) {
    setEditingDepartmentId(departmentId);
    setShowDepartmentForm(true);
  }

  function editTeam(teamId: string) {
    setEditingTeamId(teamId);
    setShowTeamForm(true);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeading
          title="Departments"
          description="Model reporting lines and access boundaries. Department hierarchy changes are cycle-checked and tenant-scoped."
          action={
            canManage ? (
              <button
                type="button"
                onClick={() => {
                  setEditingDepartmentId(null);
                  setShowDepartmentForm(true);
                }}
                className={primaryButtonClass}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                New department
              </button>
            ) : undefined
          }
        />

        {showDepartmentForm && canManage ? (
          <DepartmentForm
            department={editingDepartment}
            departments={snapshot.departments}
            pending={pending}
            runMutation={runMutation}
            onCancel={() => {
              setEditingDepartmentId(null);
              setShowDepartmentForm(false);
            }}
          />
        ) : null}

        {snapshot.departments.length === 0 ? (
          <EmptyState>Create the first department to begin modelling work.</EmptyState>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {snapshot.departments.map((department) => (
              <article
                key={department.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                      <Building2 aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-950">
                        {department.name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {department.code ?? "No code"}
                        {department.parentId
                          ? ` · Reports to ${
                              departmentNames.get(department.parentId) ??
                              "another department"
                            }`
                          : " · Top level"}
                      </p>
                    </div>
                  </div>
                  <ActiveBadge active={department.isActive} />
                </div>
                {department.description ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {department.description}
                  </p>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => editDepartment(department.id)}
                    className={`${secondaryButtonClass} mt-4`}
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                    Edit
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-8">
        <SectionHeading
          title="Teams"
          description="Create operational teams within departments. Moving a team is blocked while live workforce dependencies exist."
          action={
            canManage ? (
              <button
                type="button"
                onClick={() => {
                  setEditingTeamId(null);
                  setShowTeamForm(true);
                }}
                className={primaryButtonClass}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                New team
              </button>
            ) : undefined
          }
        />

        {showTeamForm && canManage ? (
          <TeamForm
            team={editingTeam}
            departments={snapshot.departments}
            pending={pending}
            runMutation={runMutation}
            onCancel={() => {
              setEditingTeamId(null);
              setShowTeamForm(false);
            }}
          />
        ) : null}

        {snapshot.teams.length === 0 ? (
          <EmptyState>Create teams when work needs a smaller operational unit.</EmptyState>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {snapshot.teams.map((team) => (
              <article
                key={team.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                      <Users aria-hidden="true" className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-950">{team.name}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {team.code ?? "No code"} · {team.departmentId
                          ? departmentNames.get(team.departmentId) ?? "Department"
                          : "Organisation-wide"}
                      </p>
                    </div>
                  </div>
                  <ActiveBadge active={team.isActive} />
                </div>
                {team.description ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {team.description}
                  </p>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => editTeam(team.id)}
                    className={`${secondaryButtonClass} mt-4`}
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                    Edit
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}