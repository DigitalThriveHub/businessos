"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ChartNoAxesCombined,
  FileSearch2,
  ListTodo,
  RefreshCw,
} from "lucide-react";

import { operationalIntelligenceRequest } from "@/components/operational-intelligence/operational-intelligence-client";
import {
  operationalIntelligenceDashboardSchema,
  type OperationalIntelligenceDashboard,
} from "@/lib/operational-intelligence";

import { ControlTowerPanel } from "./control-tower-panel";
import { DocumentsPanel } from "./documents-panel";
import { MyWorkPanel } from "./my-work-panel";

export type OperationalIntelligenceView =
  "my-work" | "documents" | "control-tower";

type Props = {
  organisationId: string;
  view: OperationalIntelligenceView;
};

const views = [
  { key: "my-work", label: "My Work", href: "/my-work", icon: ListTodo },
  {
    key: "documents",
    label: "Documents",
    href: "/documents",
    icon: FileSearch2,
  },
  {
    key: "control-tower",
    label: "Control Tower",
    href: "/control-tower",
    icon: ChartNoAxesCombined,
  },
] as const;

const viewCopy: Record<
  OperationalIntelligenceView,
  { eyebrow: string; title: string; description: string }
> = {
  "my-work": {
    eyebrow: "Personal operations",
    title: "My Work",
    description:
      "One prioritised queue for assigned tasks, deadlines, approvals and customer dependencies.",
  },
  documents: {
    eyebrow: "Human-controlled intelligence",
    title: "Document review",
    description:
      "Triage clean documents, verify extracted evidence and apply controlled decisions.",
  },
  "control-tower": {
    eyebrow: "Management assurance",
    title: "Control Tower",
    description:
      "Monitor demand, workload, operational risk and configurable value evidence without exporting data.",
  },
};

export function OperationalIntelligenceWorkspace({
  organisationId,
  view,
}: Props) {
  const [dashboard, setDashboard] =
    useState<OperationalIntelligenceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ organisationId });
      const result = await operationalIntelligenceRequest(
        `/api/operational-intelligence?${query.toString()}`,
        operationalIntelligenceDashboardSchema,
      );
      setDashboard(result);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Operational intelligence is temporarily unavailable.",
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

  const copy = viewCopy[view];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-blue-700">{copy.eyebrow}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">
            {copy.title}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
            {copy.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {dashboard ? (
            <p className="hidden text-xs text-slate-500 sm:block">
              Live as of{" "}
              {new Intl.DateTimeFormat("en-GB", {
                timeStyle: "short",
              }).format(new Date(dashboard.generatedAt))}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            Refresh
          </button>
        </div>
      </header>

      <nav
        aria-label="Operational intelligence"
        className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"
      >
        {views.map((item) => {
          const Icon = item.icon;
          const active = item.key === view;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white"
                  : "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{error} Existing data has not been changed.</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loading && !dashboard ? (
        <div
          role="status"
          className="grid animate-pulse gap-2 sm:grid-cols-3 xl:grid-cols-6"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className="h-20 rounded-xl border border-slate-200 bg-white"
            />
          ))}
          <span className="sr-only">Loading operational information…</span>
        </div>
      ) : null}

      {dashboard ? (
        <>
          {view === "my-work" ? <MyWorkPanel data={dashboard.myWork} /> : null}
          {view === "documents" ? (
            <DocumentsPanel
              organisationId={organisationId}
              dashboard={dashboard}
              onRefresh={refresh}
            />
          ) : null}
          {view === "control-tower" ? (
            <ControlTowerPanel
              organisationId={organisationId}
              dashboard={dashboard}
              onRefresh={refresh}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
