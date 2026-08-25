"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";

import { operationalIntelligenceRequest } from "@/components/operational-intelligence/operational-intelligence-client";
import {
  benchmarkUpdateResultSchema,
  type OperationalIntelligenceDashboard,
} from "@/lib/operational-intelligence";

import {
  EmptyState,
  formatLabel,
  formatMoneyMinor,
  MetricCard,
} from "./operational-intelligence-ui";

type Props = {
  organisationId: string;
  dashboard: OperationalIntelligenceDashboard;
  onRefresh: () => Promise<void>;
};

export function ControlTowerPanel({
  organisationId,
  dashboard,
  onRefresh,
}: Props) {
  const tower = dashboard.controlTower;
  const value = dashboard.value;
  const [benchmarkId, setBenchmarkId] = useState(
    value?.benchmarks[0]?.id ?? "",
  );
  const benchmark = useMemo(
    () =>
      value?.benchmarks.find((item) => item.id === benchmarkId) ??
      value?.benchmarks[0] ??
      null,
    [benchmarkId, value?.benchmarks],
  );
  const [manualMinutes, setManualMinutes] = useState(
    value?.benchmarks[0]?.manualMinutes ?? 0,
  );
  const [automatedMinutes, setAutomatedMinutes] = useState(
    value?.benchmarks[0]?.automatedMinutes ?? 0,
  );
  const [hourlyCostPounds, setHourlyCostPounds] = useState(
    ((Number(value?.benchmarks[0]?.hourlyCostMinor ?? 0) || 0) / 100).toFixed(
      2,
    ),
  );
  const [active, setActive] = useState(value?.benchmarks[0]?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectBenchmark(nextId: string) {
    const next = value?.benchmarks.find((item) => item.id === nextId);
    if (!next) return;
    setBenchmarkId(next.id);
    setManualMinutes(next.manualMinutes);
    setAutomatedMinutes(next.automatedMinutes);
    setHourlyCostPounds((Number(next.hourlyCostMinor) / 100).toFixed(2));
    setActive(next.isActive);
    setMessage(null);
    setError(null);
  }

  async function saveBenchmark(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!benchmark || saving) return;
    const pounds = Number(hourlyCostPounds);
    if (
      !Number.isFinite(pounds) ||
      pounds < 0 ||
      automatedMinutes > manualMinutes
    ) {
      setError("Check the time assumptions and hourly cost before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await operationalIntelligenceRequest(
        "/api/operational-intelligence/mutations",
        benchmarkUpdateResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "benchmark.update",
            organisationId,
            benchmarkId: benchmark.id,
            payload: {
              estimatedManualMinutes: manualMinutes,
              estimatedAutomatedMinutes: automatedMinutes,
              hourlyCostMinor: Math.round(pounds * 100),
              isActive: active,
              expectedVersion: benchmark.version,
            },
          }),
        },
      );
      setMessage("Benchmark updated with audit evidence.");
      await onRefresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The benchmark could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!tower) {
    return (
      <EmptyState>
        Your role does not include management Control Tower access.
      </EmptyState>
    );
  }

  const summary = tower.summary;
  const risk =
    summary.overdueTasks +
    summary.slaAtRisk +
    summary.slaBreached +
    summary.pendingApprovals +
    summary.documentReviewBacklog;
  const metrics = [
    ["New enquiries (30d)", summary.newEnquiriesThirtyDays, "default"],
    ["Conversions (30d)", summary.conversionsThirtyDays, "default"],
    ["Open matters", summary.openMatters, "default"],
    ["Completed (30d)", summary.completedThirtyDays, "success"],
    [
      "Unassigned",
      summary.unassignedMatters,
      summary.unassignedMatters ? "warning" : "success",
    ],
    [
      "No next action",
      summary.noNextAction,
      summary.noNextAction ? "warning" : "success",
    ],
    ["Operational risk", risk, risk ? "danger" : "success"],
    [
      "Document backlog",
      summary.documentReviewBacklog,
      summary.documentReviewBacklog ? "warning" : "success",
    ],
  ] as const;

  return (
    <div className="space-y-4">
      <section
        aria-label="Control Tower summary"
        className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8"
      >
        {metrics.map(([label, metricValue, tone]) => (
          <MetricCard
            key={label}
            label={label}
            value={metricValue}
            tone={tone}
          />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Team workload</h2>
            <p className="text-xs text-slate-500">
              Live assigned work; use it to rebalance, not to rank staff.
            </p>
          </div>
          {tower.workload.length ? (
            <div className="max-h-[40vh] overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Team member</th>
                    <th className="px-4 py-2.5 text-right">Matters</th>
                    <th className="px-4 py-2.5 text-right">Tasks</th>
                    <th className="px-4 py-2.5 text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tower.workload.map((person) => (
                    <tr key={person.userId}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{person.displayName}</p>
                        <p className="text-xs text-slate-500">
                          {person.jobTitle ?? "Team member"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {person.openMatters}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {person.openTasks}
                      </td>
                      <td
                        className={
                          person.overdueTasks
                            ? "px-4 py-3 text-right font-semibold tabular-nums text-red-700"
                            : "px-4 py-3 text-right tabular-nums"
                        }
                      >
                        {person.overdueTasks}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState>No active team workload was returned.</EmptyState>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Pipeline distribution</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            {[
              ["Matter stages", tower.matterStages],
              ["Enquiry stages", tower.enquiryStages],
            ].map(([title, stages]) => (
              <div key={title as string}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {title as string}
                </p>
                <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-auto">
                  {Object.entries(stages as Record<string, number>).map(
                    ([stage, total]) => (
                      <span
                        key={stage}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                      >
                        <span className="capitalize">{formatLabel(stage)}</span>{" "}
                        · <strong>{total}</strong>
                      </span>
                    ),
                  )}
                  {!Object.keys(stages as Record<string, number>).length ? (
                    <span className="text-xs text-slate-500">No records</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {value ? (
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(420px,1.3fr)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Operational value · last {value.periodDays} days
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MetricCard label="Events" value={value.eventCount} />
              <MetricCard
                label="Estimated hours"
                value={(Number(value.estimatedMinutesSaved) / 60).toFixed(1)}
              />
              <MetricCard
                label="Estimated value"
                value={formatMoneyMinor(value.estimatedValueMinor)}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600">
              {value.disclaimer} These figures are management estimates, not
              recognised revenue or guaranteed savings.
            </p>
          </div>

          <div className="border-t border-slate-200 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
            <h2 className="font-semibold">Value benchmark assumptions</h2>
            {dashboard.access.operationalValueManage && benchmark ? (
              <form onSubmit={saveBenchmark} className="mt-3 space-y-3">
                <label className="block text-xs font-medium text-slate-700">
                  Workflow
                  <select
                    value={benchmark.id}
                    onChange={(event) => selectBenchmark(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                  >
                    {value.benchmarks.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="text-xs font-medium text-slate-700">
                    Manual minutes
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={manualMinutes}
                      onChange={(event) =>
                        setManualMinutes(Number(event.target.value))
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Automated minutes
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={automatedMinutes}
                      onChange={(event) =>
                        setAutomatedMinutes(Number(event.target.value))
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Hourly cost (£)
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      step="0.01"
                      value={hourlyCostPounds}
                      onChange={(event) =>
                        setHourlyCostPounds(event.target.value)
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(event) => setActive(event.target.checked)}
                      className="h-4 w-4 rounded"
                    />{" "}
                    Include in estimates
                  </label>
                  <button
                    type="submit"
                    disabled={saving || automatedMinutes > manualMinutes}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save benchmark
                  </button>
                </div>
                {error ? (
                  <p
                    role="alert"
                    className="rounded-lg bg-red-50 p-2 text-sm text-red-800"
                  >
                    {error}
                  </p>
                ) : null}
                {message ? (
                  <p
                    role="status"
                    className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800"
                  >
                    {message}
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                AAL2 operational-value management permission is required to edit
                assumptions.
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
