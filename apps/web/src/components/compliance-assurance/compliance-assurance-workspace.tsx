"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  FileLock2,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
} from "lucide-react";

import {
  AssuranceActionDialog,
  type AssuranceAction,
} from "@/components/compliance-assurance/assurance-action-dialog";
import { complianceRequest } from "@/components/compliance-assurance/compliance-assurance-client";
import {
  complianceAssuranceDashboardSchema,
  complianceMutationResultSchema,
  dataSubjectExportCandidateSchema,
  type ComplianceAssuranceDashboard,
} from "@/lib/compliance-assurance";

type Props = { organisationId: string };
type Tab = "overview" | "rights" | "incidents" | "retention" | "evidence";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "rights", label: "Data rights" },
  { key: "incidents", label: "Incidents" },
  { key: "retention", label: "Retention" },
  { key: "evidence", label: "Release evidence" },
];

function display(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Status({ value }: { value: string }) {
  const danger = ["FAIL", "BLOCKED", "CRITICAL", "OVERDUE", "EXPIRED"].includes(
    value,
  );
  const good = ["PASS", "COMPLETED", "CLOSED", "RESOLVED", "APPROVED"].includes(
    value,
  );
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${danger ? "bg-red-100 text-red-800" : good ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
    >
      {display(value)}
    </span>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

export function ComplianceAssuranceWorkspace({ organisationId }: Props) {
  const [dashboard, setDashboard] =
    useState<ComplianceAssuranceDashboard | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<AssuranceAction | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ organisationId });
      const result = await complianceRequest(
        `/api/compliance-assurance?${query}`,
        complianceAssuranceDashboardSchema,
      );
      setDashboard(result);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Assurance information is unavailable.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [organisationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openAction = (next: AssuranceAction) => {
    setActionError(null);
    setAction(next);
  };

  async function mutate(
    operation: string,
    identifiers: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    setBusy(true);
    setActionError(null);
    try {
      await complianceRequest(
        "/api/compliance-assurance/mutations",
        complianceMutationResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation,
            organisationId,
            ...identifiers,
            payload,
          }),
        },
      );
      setAction(null);
      setNotice("The governed action was recorded successfully.");
      await refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "The action could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportCandidate(requestId: string, reference: string) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ organisationId, requestId });
      const candidate = await complianceRequest(
        `/api/compliance-assurance?${query}`,
        dataSubjectExportCandidateSchema,
      );
      const blob = new Blob([JSON.stringify(candidate, null, 2)], {
        type: "application/json",
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${reference}-review-candidate.json`;
      anchor.click();
      URL.revokeObjectURL(href);
      setNotice(
        "A review candidate was downloaded. It was not sent to the person automatically.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The review candidate could not be built.",
      );
    } finally {
      setBusy(false);
    }
  }

  const summaries = useMemo(
    () =>
      dashboard
        ? [
            {
              label: "Open rights",
              value: dashboard.summary.openRights,
              alert: dashboard.summary.rightsOverdue > 0,
            },
            {
              label: "Due in 7 days",
              value: dashboard.summary.rightsDueSevenDays,
              alert: dashboard.summary.rightsDueSevenDays > 0,
            },
            {
              label: "Open incidents",
              value: dashboard.summary.openIncidents,
              alert: dashboard.summary.openIncidents > 0,
            },
            {
              label: "72h clocks",
              value: dashboard.summary.notificationClocks,
              alert: dashboard.summary.notificationClocks > 0,
            },
            {
              label: "Retention due",
              value: dashboard.summary.dueRetentionReviews,
              alert: dashboard.summary.dueRetentionReviews > 0,
            },
            {
              label: "Release blockers",
              value: dashboard.summary.releaseBlockerCount,
              alert: dashboard.summary.releaseBlockerCount > 0,
            },
          ]
        : [],
    [dashboard],
  );

  return (
    <div className="space-y-4" data-testid="assurance-workspace">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            UK compliance & production assurance
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">
            Assurance centre
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
            Manage data rights, incident clocks, retention, legal holds and
            immutable release evidence in one governed workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />{" "}
          Refresh
        </button>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{error} Existing data has not been changed.</span>
          <button
            className="font-semibold underline"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      {loading && !dashboard ? (
        <div
          role="status"
          className="grid animate-pulse grid-cols-2 gap-2 lg:grid-cols-6"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className="h-20 rounded-xl border border-slate-200 bg-white"
            />
          ))}
          <span className="sr-only">Loading assurance centre…</span>
        </div>
      ) : null}

      {dashboard ? (
        <>
          <section
            aria-label="Assurance summary"
            className="grid grid-cols-2 gap-2 lg:grid-cols-6"
          >
            {summaries.map((item) => (
              <div
                key={item.label}
                className={`rounded-xl border bg-white p-3 ${item.alert ? "border-amber-300" : "border-slate-200"}`}
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {item.label}
                </p>
                <p
                  className={`mt-1 text-2xl font-bold ${item.alert ? "text-amber-800" : "text-slate-950"}`}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </section>

          <nav
            aria-label="Assurance areas"
            className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"
          >
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? "page" : undefined}
                className={
                  tab === item.key
                    ? "h-9 shrink-0 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white"
                    : "h-9 shrink-0 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                }
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab === "overview" ? (
            <Overview
              dashboard={dashboard}
              setTab={setTab}
              openAction={openAction}
            />
          ) : null}
          {tab === "rights" ? (
            <Rights
              dashboard={dashboard}
              busy={busy}
              openAction={openAction}
              exportCandidate={exportCandidate}
            />
          ) : null}
          {tab === "incidents" ? (
            <Incidents dashboard={dashboard} openAction={openAction} />
          ) : null}
          {tab === "retention" ? (
            <Retention dashboard={dashboard} openAction={openAction} />
          ) : null}
          {tab === "evidence" ? (
            <Evidence dashboard={dashboard} openAction={openAction} />
          ) : null}

          {action ? (
            <AssuranceActionDialog
              action={action}
              dashboard={dashboard}
              busy={busy}
              error={actionError}
              onClose={() => !busy && setAction(null)}
              onSubmit={mutate}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Overview({
  dashboard,
  setTab,
  openAction,
}: {
  dashboard: ComplianceAssuranceDashboard;
  setTab: (tab: Tab) => void;
  openAction: (action: AssuranceAction) => void;
}) {
  const completion =
    dashboard.summary.mandatoryEvidenceTotal > 0
      ? Math.round(
          (dashboard.summary.mandatoryEvidencePassed /
            dashboard.summary.mandatoryEvidenceTotal) *
            100,
        )
      : 0;
  const cards = [
    {
      title: "Data rights",
      description: `${dashboard.summary.openRights} open; ${dashboard.summary.rightsOverdue} overdue`,
      icon: Scale,
      tab: "rights" as Tab,
    },
    {
      title: "Incident response",
      description: `${dashboard.summary.notificationClocks} notification clocks require attention`,
      icon: ShieldAlert,
      tab: "incidents" as Tab,
    },
    {
      title: "Retention & holds",
      description: `${dashboard.summary.activeLegalHolds} active holds; ${dashboard.summary.dueRetentionReviews} reviews due`,
      icon: FileLock2,
      tab: "retention" as Tab,
    },
    {
      title: "Production evidence",
      description: `${dashboard.summary.mandatoryEvidencePassed}/${dashboard.summary.mandatoryEvidenceTotal} controls passed (${completion}%)`,
      icon: BadgeCheck,
      tab: "evidence" as Tab,
    },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
      <section className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              type="button"
              key={card.title}
              onClick={() => setTab(card.tab)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm"
            >
              <Icon className="h-5 w-5 text-blue-700" />
              <h2 className="mt-3 font-bold">{card.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{card.description}</p>
            </button>
          );
        })}
      </section>
      <section
        className={`rounded-xl border p-4 ${dashboard.assurance.releaseEligible ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className={`mt-0.5 h-5 w-5 ${dashboard.assurance.releaseEligible ? "text-emerald-700" : "text-amber-800"}`}
          />
          <div>
            <h2 className="font-bold">
              {dashboard.assurance.releaseEligible
                ? "Evidence gate eligible"
                : "Production release blocked"}
            </h2>
            <p className="mt-1 text-sm leading-5">
              {dashboard.assurance.releaseEligible
                ? "All recorded mandatory controls are current. An authorised independent release decision is still required."
                : `${dashboard.assurance.blockers.length} unresolved controls prevent approval.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={!dashboard.access.releaseApprove}
          onClick={() => openAction({ kind: "release.decide" })}
          className="mt-4 h-9 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Record release decision
        </button>
        <p className="mt-3 text-xs leading-4 text-slate-600">
          {dashboard.assurance.certificationBoundary}
        </p>
      </section>
    </div>
  );
}

function Rights({
  dashboard,
  busy,
  openAction,
  exportCandidate,
}: {
  dashboard: ComplianceAssuranceDashboard;
  busy: boolean;
  openAction: (action: AssuranceAction) => void;
  exportCandidate: (id: string, reference: string) => Promise<void>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3">
        <div>
          <h2 className="font-bold">Data-subject requests</h2>
          <p className="text-xs text-slate-500">
            One-month target, identity control and reviewed export candidates.
          </p>
        </div>
        <button
          disabled={!dashboard.access.rightsManage}
          onClick={() => openAction({ kind: "right.create" })}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> New request
        </button>
      </div>
      {dashboard.rights.length === 0 ? (
        <div className="p-3">
          <Empty>No data-right requests have been recorded.</Empty>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Reference / person</th>
                <th className="p-3">Right</th>
                <th className="p-3">Status</th>
                <th className="p-3">Deadline</th>
                <th className="p-3">Owner</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard.rights.map((item) => (
                <tr key={item.id}>
                  <td className="p-3">
                    <p className="font-semibold">{item.requestReference}</p>
                    <p className="text-xs text-slate-500">{item.subjectName}</p>
                  </td>
                  <td className="p-3">{display(item.requestType)}</td>
                  <td className="p-3">
                    <Status value={item.status} />
                    <p className="mt-1 text-xs text-slate-500">
                      ID: {display(item.identityStatus)}
                    </p>
                  </td>
                  <td
                    className={`p-3 ${item.daysRemaining < 0 ? "font-bold text-red-700" : ""}`}
                  >
                    {date(item.effectiveDueAt)}
                    <p className="text-xs">
                      {item.daysRemaining < 0
                        ? `${Math.abs(item.daysRemaining)} days overdue`
                        : `${item.daysRemaining} days left`}
                    </p>
                  </td>
                  <td className="p-3">{item.ownerName ?? "Unassigned"}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={!dashboard.access.rightsManage}
                        onClick={() =>
                          openAction({ kind: "right.transition", item })
                        }
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                      >
                        Update
                      </button>
                      {!item.extendedDueAt &&
                      !["COMPLETED", "REFUSED", "WITHDRAWN"].includes(
                        item.status,
                      ) ? (
                        <button
                          disabled={!dashboard.access.rightsManage}
                          onClick={() =>
                            openAction({ kind: "right.extend", item })
                          }
                          className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                        >
                          Extend
                        </button>
                      ) : null}
                      {["ACCESS", "PORTABILITY"].includes(item.requestType) ? (
                        <button
                          disabled={busy || !dashboard.access.rightsManage}
                          onClick={() =>
                            void exportCandidate(item.id, item.requestReference)
                          }
                          className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                        >
                          Export candidate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Incidents({
  dashboard,
  openAction,
}: {
  dashboard: ComplianceAssuranceDashboard;
  openAction: (action: AssuranceAction) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3">
        <div>
          <h2 className="font-bold">Privacy incidents</h2>
          <p className="text-xs text-slate-500">
            Containment, risk assessment and 72-hour notification evidence.
          </p>
        </div>
        <button
          disabled={!dashboard.access.incidentsManage}
          onClick={() => openAction({ kind: "incident.create" })}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Record incident
        </button>
      </div>
      {!dashboard.access.incidentsRead ? (
        <div className="p-3">
          <Empty>Incident permission is required.</Empty>
        </div>
      ) : dashboard.incidents.length === 0 ? (
        <div className="p-3">
          <Empty>No privacy incidents have been recorded.</Empty>
        </div>
      ) : (
        <div className="grid gap-2 p-3 lg:grid-cols-2">
          {dashboard.incidents.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-slate-200 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-500">
                    {item.incidentReference}
                  </p>
                  <h3 className="font-bold">{item.title}</h3>
                </div>
                <Status value={item.severity} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Status value={item.status} />
                <Status value={item.notificationDecision} />
              </div>
              {item.notificationDeadlineAt ? (
                <p
                  className={`mt-3 flex items-center gap-2 text-sm ${Number(item.notificationHoursRemaining) < 0 ? "font-bold text-red-700" : "text-slate-600"}`}
                >
                  <Clock3 className="h-4 w-4" /> Notification deadline{" "}
                  {date(item.notificationDeadlineAt)}
                </p>
              ) : null}
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                {item.description}
              </p>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {item.approximatePeopleAffected} people ·{" "}
                  {item.ownerName ?? "Unassigned"}
                </span>
                <button
                  disabled={!dashboard.access.incidentsManage}
                  onClick={() => openAction({ kind: "incident.update", item })}
                  className="rounded-lg border px-2.5 py-1.5 font-semibold text-slate-800 disabled:opacity-40"
                >
                  Update
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Retention({
  dashboard,
  openAction,
}: {
  dashboard: ComplianceAssuranceDashboard;
  openAction: (action: AssuranceAction) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b p-3">
          <div>
            <h2 className="font-bold">Retention policies</h2>
            <p className="text-xs text-slate-500">
              Disposition is reviewed; this gate never auto-deletes.
            </p>
          </div>
          <button
            disabled={!dashboard.access.retentionManage}
            onClick={() => openAction({ kind: "policy.upsert" })}
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Add policy
          </button>
        </div>
        <div className="divide-y">
          {dashboard.retention.policies.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div>
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-slate-500">
                  {item.resourceType} · {item.retentionDays} days ·{" "}
                  {display(item.action)}
                </p>
              </div>
              <button
                disabled={!dashboard.access.retentionManage}
                onClick={() => openAction({ kind: "policy.upsert", item })}
                className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
              >
                Edit
              </button>
            </div>
          ))}
          {dashboard.retention.policies.length === 0 ? (
            <div className="p-3">
              <Empty>No retention policies are configured.</Empty>
            </div>
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b p-3">
          <div>
            <h2 className="font-bold">Legal holds</h2>
            <p className="text-xs text-slate-500">
              Active holds override destructive dispositions.
            </p>
          </div>
          <button
            disabled={!dashboard.access.retentionManage}
            onClick={() => openAction({ kind: "hold.create" })}
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Create hold
          </button>
        </div>
        <div className="divide-y">
          {dashboard.retention.legalHolds.map((item) => (
            <div key={item.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {display(item.scopeType)} hold
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                    {item.reason}
                  </p>
                </div>
                {item.releasedAt ? (
                  <Status value="RELEASED" />
                ) : (
                  <button
                    disabled={!dashboard.access.retentionManage}
                    onClick={() => openAction({ kind: "hold.release", item })}
                    className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                  >
                    Release
                  </button>
                )}
              </div>
            </div>
          ))}
          {dashboard.retention.legalHolds.length === 0 ? (
            <div className="p-3">
              <Empty>No legal holds are active or recorded.</Empty>
            </div>
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white xl:col-span-2">
        <div className="flex items-center justify-between border-b p-3">
          <div>
            <h2 className="font-bold">Disposition reviews</h2>
            <p className="text-xs text-slate-500">
              Legal-hold check, policy alignment and execution evidence are
              enforced.
            </p>
          </div>
          <button
            disabled={
              !dashboard.access.retentionManage ||
              dashboard.retention.policies.length === 0
            }
            onClick={() => openAction({ kind: "retention-review.create" })}
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Schedule review
          </button>
        </div>
        {dashboard.retention.reviews.length === 0 ? (
          <div className="p-3">
            <Empty>No retention reviews are due.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Policy / record</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Due</th>
                  <th className="p-3">Hold</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dashboard.retention.reviews.map((item) => (
                  <tr key={item.id}>
                    <td className="p-3">
                      <p className="font-semibold">{item.policyName}</p>
                      <p className="text-xs text-slate-500">
                        {item.resourceType} · {item.resourceId}
                      </p>
                    </td>
                    <td className="p-3">
                      <Status value={item.status} />
                    </td>
                    <td className="p-3">{date(item.dueAt)}</td>
                    <td className="p-3">
                      {item.legalHoldId ? "Active" : "None"}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        disabled={
                          !dashboard.access.retentionManage ||
                          ["COMPLETED", "CANCELLED"].includes(item.status)
                        }
                        onClick={() =>
                          openAction({ kind: "retention-review.decide", item })
                        }
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                      >
                        Decide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Evidence({
  dashboard,
  openAction,
}: {
  dashboard: ComplianceAssuranceDashboard;
  openAction: (action: AssuranceAction) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b p-3">
          <div>
            <h2 className="font-bold">Production evidence</h2>
            <p className="text-xs text-slate-500">
              Hash-bound submission plus independent AAL2 review.
            </p>
          </div>
          <button
            disabled={!dashboard.access.assuranceManage}
            onClick={() => openAction({ kind: "evidence.record" })}
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Add evidence
          </button>
        </div>
        {dashboard.assurance.evidence.length === 0 ? (
          <div className="p-3">
            <Empty>Assurance evidence permission is required.</Empty>
          </div>
        ) : (
          <div className="divide-y">
            {dashboard.assurance.evidence.map((item) => (
              <article key={item.id} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-500">
                      {item.evidenceKey}
                    </p>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.assessorName ?? "Not submitted"}
                      {item.expiresAt
                        ? ` · expires ${date(item.expiresAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Status value={item.effectiveStatus} />
                    {item.status === "SUBMITTED" ? (
                      <button
                        disabled={!dashboard.access.assuranceManage}
                        onClick={() =>
                          openAction({ kind: "evidence.review", item })
                        }
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                      >
                        Review
                      </button>
                    ) : (
                      <button
                        disabled={!dashboard.access.assuranceManage}
                        onClick={() =>
                          openAction({ kind: "evidence.record", item })
                        }
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                      >
                        Submit
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <aside className="space-y-3">
        <section
          className={`rounded-xl border p-4 ${dashboard.assurance.releaseEligible ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
        >
          <h2 className="font-bold">
            {dashboard.assurance.releaseEligible
              ? "No recorded blockers"
              : `${dashboard.assurance.blockers.length} release blockers`}
          </h2>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {dashboard.assurance.blockers.map((item) => (
              <div
                key={`${item.code}:${item.subject}`}
                className="rounded-lg bg-white/80 p-2.5"
              >
                <p className="text-xs font-bold text-slate-800">
                  {display(item.code)} · {item.subject}
                </p>
                <p className="mt-1 text-xs leading-4 text-slate-600">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <button
            disabled={!dashboard.access.releaseApprove}
            onClick={() => openAction({ kind: "release.decide" })}
            className="mt-3 w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Record release decision
          </button>
        </section>
        {dashboard.assurance.latestRelease ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">
              Latest decision
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="font-semibold">
                {dashboard.assurance.latestRelease.releaseReference}
              </p>
              <Status value={dashboard.assurance.latestRelease.decision} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {date(dashboard.assurance.latestRelease.decidedAt)}
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
