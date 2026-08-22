"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Gauge, Pencil, Plus } from "lucide-react";

import {
  KPI_DIRECTIONS,
  KPI_FREQUENCIES,
  KPI_VALUE_TYPES,
  type KpiDefinition,
  type WorkforceConfigurationSnapshot,
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

type KpiDefinitionsPanelProps = {
  snapshot: WorkforceConfigurationSnapshot;
  canManage: boolean;
  pending: boolean;
  runMutation: RunWorkforceMutation;
};

const LABELS: Record<string, string> = {
  NUMBER: "Number",
  PERCENTAGE: "Percentage",
  CURRENCY: "Currency",
  DURATION_SECONDS: "Duration (seconds)",
  RATING: "Rating",
  HIGHER_IS_BETTER: "Higher is better",
  LOWER_IS_BETTER: "Lower is better",
  TARGET_RANGE: "Target range",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
  CASE_BASED: "Case based",
};

function KpiDefinitionForm({
  definition,
  snapshot,
  pending,
  runMutation,
  onCancel,
}: {
  definition: KpiDefinition | null;
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
      valueType: fieldText(data, "valueType") as KpiDefinition["valueType"],
      direction: fieldText(data, "direction") as KpiDefinition["direction"],
      frequency: fieldText(data, "frequency") as KpiDefinition["frequency"],
      unitLabel: nullableText(data, "unitLabel"),
      currencyCode: nullableText(data, "currencyCode"),
      measurementSource: fieldText(data, "measurementSource"),
      isActive: data.get("isActive") === "on",
    };
    const successful = await runMutation(
      definition
        ? {
            operation: "kpi_definition.update",
            kpiDefinitionId: definition.id,
            payload: {
              ...common,
              expectedUpdatedAt: definition.updatedAt,
            },
          }
        : {
            operation: "kpi_definition.create",
            payload: {
              key: fieldText(data, "key"),
              departmentId: nullableText(data, "departmentId"),
              ...common,
            },
          },
      definition ? "KPI definition updated." : "KPI definition created.",
    );

    if (successful) {
      formElement.reset();
      onCancel();
    }
  }

  return (
    <form
      key={definition?.id ?? "new-kpi-definition"}
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="text-base font-semibold text-slate-950">
          {definition ? "Edit KPI definition" : "Create KPI definition"}
        </legend>

        {definition ? (
          <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
            Protected key: <span className="font-mono">{definition.key}</span>
          </div>
        ) : (
          <label className="block text-sm font-medium text-slate-800">
            Protected key
            <input
              name="key"
              required
              maxLength={120}
              placeholder="cases.completed"
              className={inputClass}
            />
          </label>
        )}

        {!definition ? (
          <label className="block text-sm font-medium text-slate-800">
            Department scope
            <select name="departmentId" defaultValue="" className={inputClass}>
              <option value="">Organisation-wide KPI</option>
              {snapshot.departments
                .filter((department) => department.isActive)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800">
            Name
            <input
              name="name"
              required
              maxLength={180}
              defaultValue={definition?.name ?? ""}
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-medium text-slate-800">
            Measurement source
            <input
              name="measurementSource"
              required
              maxLength={120}
              defaultValue={definition?.measurementSource ?? ""}
              placeholder="Case management system"
              className={inputClass}
            />
          </label>
        </div>

        <label className="block text-sm font-medium text-slate-800">
          Description
          <textarea
            name="description"
            required
            maxLength={4_000}
            defaultValue={definition?.description ?? ""}
            className={textareaClass}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm font-medium text-slate-800">
            Value type
            <select
              name="valueType"
              defaultValue={definition?.valueType ?? "NUMBER"}
              className={inputClass}
            >
              {KPI_VALUE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800">
            Direction
            <select
              name="direction"
              defaultValue={definition?.direction ?? "HIGHER_IS_BETTER"}
              className={inputClass}
            >
              {KPI_DIRECTIONS.map((value) => (
                <option key={value} value={value}>
                  {LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800">
            Review frequency
            <select
              name="frequency"
              defaultValue={definition?.frequency ?? "MONTHLY"}
              className={inputClass}
            >
              {KPI_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800">
            Unit label
            <input
              name="unitLabel"
              maxLength={40}
              defaultValue={definition?.unitLabel ?? ""}
              placeholder="cases, %, minutes"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-medium text-slate-800">
            Currency code (currency KPIs only)
            <input
              name="currencyCode"
              maxLength={3}
              defaultValue={definition?.currencyCode ?? ""}
              placeholder="GBP"
              className={inputClass}
            />
          </label>
        </div>

        <CheckboxField
          name="isActive"
          label="Active KPI definition"
          description="Archiving is blocked while live job, workforce or pending-onboarding targets use it."
          defaultChecked={definition?.isActive ?? true}
        />

        <div className="flex flex-wrap gap-2">
          <SaveButton pending={pending} creating={!definition} />
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function KpiDefinitionsPanel({
  snapshot,
  canManage,
  pending,
  runMutation,
}: KpiDefinitionsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const editingDefinition = useMemo(
    () => snapshot.kpiDefinitions.find((item) => item.id === editingId) ?? null,
    [editingId, snapshot.kpiDefinitions],
  );
  const departmentNames = useMemo(
    () => new Map(snapshot.departments.map((item) => [item.id, item.name])),
    [snapshot.departments],
  );

  return (
    <div className="space-y-5">
      <SectionHeading
        title="KPI catalogue"
        description="Define measurable outcomes once, then assign effective-dated targets and weights to job profiles. Historical links are retained when a definition is archived."
        action={
          canManage ? (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setShowForm(true);
              }}
              className={primaryButtonClass}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              New KPI
            </button>
          ) : undefined
        }
      />

      {showForm && canManage ? (
        <KpiDefinitionForm
          definition={editingDefinition}
          snapshot={snapshot}
          pending={pending}
          runMutation={runMutation}
          onCancel={() => {
            setEditingId(null);
            setShowForm(false);
          }}
        />
      ) : null}

      {snapshot.kpiDefinitions.length === 0 ? (
        <EmptyState>
          Create a KPI definition before assigning measurable targets to roles.
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {snapshot.kpiDefinitions.map((definition) => (
            <article
              key={definition.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <Gauge aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-950">
                      {definition.name}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {definition.key}
                    </p>
                  </div>
                </div>
                <ActiveBadge active={definition.isActive} />
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-600">
                {definition.description}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-slate-500">Measurement</dt>
                  <dd className="mt-1 font-medium text-slate-800">
                    {LABELS[definition.valueType]} · {LABELS[definition.direction]}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Frequency</dt>
                  <dd className="mt-1 font-medium text-slate-800">
                    {LABELS[definition.frequency]}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Scope</dt>
                  <dd className="mt-1 font-medium text-slate-800">
                    {definition.departmentId
                      ? departmentNames.get(definition.departmentId) ?? "Department"
                      : "Organisation"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Source</dt>
                  <dd className="mt-1 font-medium text-slate-800">
                    {definition.measurementSource}
                  </dd>
                </div>
              </dl>

              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(definition.id);
                    setShowForm(true);
                  }}
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
    </div>
  );
}