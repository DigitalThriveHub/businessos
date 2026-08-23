"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Banknote,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Plug,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import { commandCentreRequest } from "@/components/command-centre/command-centre-client";
import {
  commandCentreDashboardSchema,
  type CommandCentreDashboard,
} from "@/lib/command-centre";

type Props = { organisationId: string };

function formatMoney(value: string): string {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(minor / 100);
}

function formatDateTime(value: string | null): string {
  if (!value) return "No event yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function label(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

export function CommandCentreWorkspace({ organisationId }: Props) {
  const [dashboard, setDashboard] = useState<CommandCentreDashboard | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const query = new URLSearchParams({ organisationId });
      const result = await commandCentreRequest(
        `/api/command-centre?${query.toString()}`,
        commandCentreDashboardSchema,
      );
      setDashboard(result);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "The command centre could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [organisationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const summary = dashboard?.summary;
  const riskCount = summary
    ? summary.overdueTasks +
      summary.criticalDeadlines7Days +
      summary.slaAtRisk +
      summary.slaBreached +
      summary.pendingApprovals
    : 0;
  const failureCount = summary
    ? summary.integrationFailures24Hours +
      summary.communicationFailures24Hours +
      summary.scannerDeadLetters +
      (dashboard?.serviceHealth.automationDeadLetters ?? 0)
    : 0;

  const metrics = summary
    ? [
        { label: "New enquiries", value: summary.newEnquiries, icon: Inbox },
        { label: "Open matters", value: summary.openMatters, icon: FileText },
        { label: "Overdue tasks", value: summary.overdueTasks, icon: Clock },
        {
          label: "Critical deadlines (7d)",
          value: summary.criticalDeadlines7Days,
          icon: TriangleAlert,
        },
        { label: "SLA at risk", value: summary.slaAtRisk, icon: Activity },
        {
          label: "SLA breached",
          value: summary.slaBreached,
          icon: ShieldAlert,
        },
        {
          label: "Pending approvals",
          value: summary.pendingApprovals,
          icon: CheckCircle2,
        },
        {
          label: "Receivables",
          value: formatMoney(summary.receivableMinor),
          icon: Banknote,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            Management assurance
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Command Centre
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Prioritise urgent work and monitor finance, automation,
            communications, integrations and document security from one
            tenant-controlled view.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          Loading live operational evidence…
        </p>
      ) : null}

      {dashboard ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article
                  key={metric.label}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <Icon className="h-5 w-5 text-slate-600" />
                  <p className="mt-3 text-2xl font-bold">{metric.value}</p>
                  <p className="mt-1 text-sm text-slate-600">{metric.label}</p>
                </article>
              );
            })}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article
              className={
                riskCount > 0
                  ? "rounded-2xl border border-amber-300 bg-amber-50 p-5"
                  : "rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
              }
            >
              <p className="text-sm font-semibold">
                Controlled work requiring attention
              </p>
              <p className="mt-2 text-3xl font-bold">{riskCount}</p>
              <p className="mt-1 text-sm text-slate-700">
                Overdue tasks, near deadlines, SLA risk and approval queues.
              </p>
            </article>
            <article
              className={
                failureCount > 0
                  ? "rounded-2xl border border-red-300 bg-red-50 p-5"
                  : "rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
              }
            >
              <p className="text-sm font-semibold">Operational failures</p>
              <p className="mt-2 text-3xl font-bold">{failureCount}</p>
              <p className="mt-1 text-sm text-slate-700">
                Integration, delivery, scanner and automation failures requiring
                review.
              </p>
            </article>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <section className="space-y-4">
              <h2 className="text-xl font-semibold">Urgent work</h2>
              {dashboard.urgentWork.length ? (
                dashboard.urgentWork.map((item) => (
                  <Link
                    key={`${item.kind}:${item.id}`}
                    href={`/matters/${item.matterId}`}
                    className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-400"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {item.kind} · {label(item.priority)}
                        </p>
                        <h3 className="mt-1 font-semibold">{item.title}</h3>
                      </div>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                        Due {formatDateTime(item.dueAt)}
                      </span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                  No open tasks or deadlines are currently in the urgent window.
                </p>
              )}
            </section>

            <aside className="space-y-4">
              <h2 className="text-xl font-semibold">Service health</h2>
              <article className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <Workflow className="h-5 w-5" />
                  <p className="font-semibold">Automation</p>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {dashboard.serviceHealth.automationDeadLetters} dead-letter
                  runs
                </p>
              </article>
              {dashboard.serviceHealth.integrations.map((integration) => (
                <article
                  key={`${integration.provider}:${integration.name}`}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Plug className="h-5 w-5" />
                      <div>
                        <p className="font-semibold">{integration.name}</p>
                        <p className="text-xs text-slate-500">
                          {integration.provider}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold">
                      {label(integration.status)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    {integration.failed24Hours} failures in 24h · last event{" "}
                    {formatDateTime(integration.lastEventAt)}
                  </p>
                </article>
              ))}
            </aside>
          </div>

          <p className="text-xs text-slate-500">
            Snapshot generated {formatDateTime(dashboard.generatedAt)}.
          </p>
        </>
      ) : null}
    </div>
  );
}
