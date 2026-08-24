"use client";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgePoundSterling,
  BriefcaseBusiness,
  Clock,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import {
  lifecycleDashboardSchema,
  type LifecycleDashboard,
} from "@/lib/service-lifecycle";
type Props = { organisationId: string };
const money = (minor: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    Number(minor) / 100,
  );
export function ServiceLifecycleWorkspace({ organisationId }: Props) {
  const [data, setData] = useState<LifecycleDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    const response = await fetch(
      `/api/service-lifecycle?organisationId=${encodeURIComponent(organisationId)}`,
      { cache: "no-store" },
    );
    const body: unknown = await response.json();
    if (!response.ok) {
      setError("The lifecycle workspace could not be loaded.");
      return;
    }
    setData(lifecycleDashboardSchema.parse(body));
  }, [organisationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  const metrics = data
    ? [
        {
          label: "Payment pending",
          value: data.summary.paymentPending,
          icon: Clock,
        },
        {
          label: "Active engagements",
          value: data.summary.activeEngagements,
          icon: BriefcaseBusiness,
        },
        {
          label: "Overdue instalments",
          value: data.summary.overdueInstalments,
          icon: AlertTriangle,
        },
        {
          label: "Submission blocked",
          value: data.summary.submissionBlocked,
          icon: LockKeyhole,
        },
        {
          label: "Fees agreed",
          value: money(data.summary.professionalFeesMinor),
          icon: BadgePoundSterling,
        },
        {
          label: "Cash collected",
          value: money(data.summary.cashCollectedMinor),
          icon: BadgePoundSterling,
        },
        {
          label: "Outstanding fees",
          value: money(data.summary.outstandingProfessionalFeesMinor),
          icon: AlertTriangle,
        },
      ]
    : [];
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            Client-to-income control
          </p>
          <h1 className="mt-1 text-3xl font-bold">Service lifecycle</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Engagement, instalment, legal-work and submission clearance across
            sales, casework, solicitors, finance and management.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-2xl border bg-white p-5">
            <Icon className="h-5 w-5 text-slate-600" />
            <p className="mt-3 text-2xl font-bold">{value}</p>
            <p className="text-sm text-slate-600">{label}</p>
          </article>
        ))}
      </section>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Controlled work queue</h2>
        </div>
        <div className="divide-y">
          {data?.workQueue.length ? (
            data.workQueue.map((item) => {
              const paid = Number(item.paidMinor),
                work = Number(item.requiredBeforeWorkMinor),
                submission = Number(item.requiredBeforeSubmissionMinor);
              const blockers = [
                !item.readiness.ownerAssigned && "Caseworker not assigned",
                !item.readiness.supervisorAssigned && "Solicitor not assigned",
                !item.readiness.conflictCleared && "Conflict check incomplete",
                !item.readiness.amlCleared && "AML incomplete",
                !item.readiness.clientCareAccepted && "Terms not accepted",
                !item.readiness.legalWorkCleared && "Deposit not cleared",
                !item.readiness.submissionApproved &&
                  "Submission approval missing",
                item.readiness.openExceptions > 0 &&
                  `${item.readiness.openExceptions} open exception(s)`,
              ].filter((value): value is string => Boolean(value));
              return (
                <article
                  key={item.engagementId}
                  className="grid gap-3 p-5 lg:grid-cols-[1.4fr_.8fr_.8fr_.8fr]"
                >
                  <div>
                    <p className="font-semibold">
                      {item.matterNumber} · {item.title}
                    </p>
                    <p className="text-sm capitalize text-slate-600">
                      {item.matterStatus.replaceAll("_", " ").toLowerCase()} ·{" "}
                      {item.status.replaceAll("_", " ").toLowerCase()}
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      {blockers.length
                        ? blockers.join(" · ")
                        : "All current controls cleared"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Collected</p>
                    <p className="font-semibold">{money(item.paidMinor)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Legal work</p>
                    <p
                      className={
                        paid >= work
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-red-700"
                      }
                    >
                      {paid >= work ? "Cleared" : "Blocked"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Submission</p>
                    <p
                      className={
                        paid >= submission
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-red-700"
                      }
                    >
                      {paid >= submission ? "Cleared" : "Blocked"}
                    </p>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="p-6 text-sm text-slate-600">
              No active service engagements.
            </p>
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Controlled exceptions</h2>
          <p className="mt-1 text-sm text-slate-600">
            Issues that prevent unsafe progression until evidenced resolution.
          </p>
        </div>
        <div className="divide-y">
          {data?.exceptions.length ? (
            data.exceptions.map((item) => (
              <article key={item.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">
                    {item.severity}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {item.category.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 font-semibold">{item.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.dueAt
                    ? `Due ${new Date(item.dueAt).toLocaleString("en-GB")}`
                    : "No due date recorded"}
                </p>
              </article>
            ))
          ) : (
            <p className="p-6 text-sm text-slate-600">No open exceptions.</p>
          )}
        </div>
      </section>
    </div>
  );
}
