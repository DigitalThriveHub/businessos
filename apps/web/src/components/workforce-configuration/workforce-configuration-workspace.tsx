"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  Building2,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  type WorkforceConfigurationSnapshot,
  type WorkforceMutation,
  workforceConfigurationSnapshotSchema,
  workforceMutationRequestSchema,
  workforceMutationResultSchema,
} from "@/lib/workforce-configuration";
import { AgentProfilesPanel } from "./agent-profiles-panel";
import { JobProfilesPanel } from "./job-profiles-panel";
import { KpiDefinitionsPanel } from "./kpi-definitions-panel";
import { StructurePanel } from "./structure-panel";
import {
  secondaryButtonClass,
  type RunWorkforceMutation,
} from "./workforce-configuration-ui";

type WorkforceConfigurationWorkspaceProps = {
  organisationId: string;
  canManageStructure: boolean;
  canManageJobProfiles: boolean;
  canManageKpis: boolean;
  canManageAgentProfiles: boolean;
};

type WorkspaceTab = "structure" | "jobs" | "kpis" | "agents";
type ApiMessage = { message?: string | string[] };

const REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error("The secure request timed out. Please try again.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiMessage;
    const message = Array.isArray(body.message)
      ? body.message[0]
      : body.message;

    if (message) {
      return message;
    }
  } catch {
    // Untrusted or malformed upstream data is never rendered.
  }

  if (response.status === 400) {
    return "Check the submitted values and security boundaries, then try again.";
  }

  if (response.status === 401) {
    return "Your secure session has expired. Sign in again.";
  }

  if (response.status === 403) {
    return "Your verified role or security assurance does not permit this change.";
  }

  if (response.status === 409) {
    return "This record changed or still has an active dependency. Refresh and review it before retrying.";
  }

  return "The workforce configuration request could not be completed.";
}

const TABS: Array<{
  key: WorkspaceTab;
  label: string;
  icon: typeof Building2;
}> = [
  { key: "structure", label: "Structure", icon: Building2 },
  { key: "jobs", label: "Job profiles", icon: BriefcaseBusiness },
  { key: "kpis", label: "KPI catalogue", icon: Gauge },
  { key: "agents", label: "AI policies", icon: Bot },
];

export function WorkforceConfigurationWorkspace({
  organisationId,
  canManageStructure,
  canManageJobProfiles,
  canManageKpis,
  canManageAgentProfiles,
}: WorkforceConfigurationWorkspaceProps) {
  const [snapshot, setSnapshot] =
    useState<WorkforceConfigurationSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("structure");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSnapshot = useCallback(
    async (signal?: AbortSignal, showLoading = true): Promise<boolean> => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const query = new URLSearchParams({ organisationId });
        const response = await fetchWithTimeout(
          `/api/workforce-configuration?${query.toString()}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal,
            headers: { Accept: "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const parsed = workforceConfigurationSnapshotSchema.parse(
          await response.json(),
        );
        setSnapshot(parsed);
        setError(null);
        return true;
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return false;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Workforce configuration could not be loaded.",
        );
        return false;
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [organisationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const startRequest = window.setTimeout(() => {
      void loadSnapshot(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(startRequest);
      controller.abort();
    };
  }, [loadSnapshot]);

  const runMutation: RunWorkforceMutation = useCallback(
    async (mutation: WorkforceMutation, successMessage: string) => {
      setPending(true);
      setError(null);
      setNotice(null);

      try {
        const request = workforceMutationRequestSchema.parse({
          organisationId,
          ...mutation,
        });
        const response = await fetchWithTimeout(
          "/api/workforce-configuration/mutations",
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        workforceMutationResultSchema.parse(await response.json());
        const refreshed = await loadSnapshot(undefined, false);

        if (refreshed) {
          setNotice(successMessage);
        }

        return refreshed;
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "The workforce configuration change could not be saved.",
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [loadSnapshot, organisationId],
  );

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              Controlled workforce configuration
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Organisation operating model
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Configure organisation structure, job duties, measurable outcomes
              and bounded AI assistance. Every write is tenant-scoped,
              permission-checked, concurrency-controlled and audited.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            disabled={loading || pending}
            className={secondaryButtonClass}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {snapshot ? (
          <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Departments", snapshot.departments.length],
              ["Job profiles", snapshot.jobProfiles.length],
              ["KPI definitions", snapshot.kpiDefinitions.length],
              ["AI profiles", snapshot.agentProfiles.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium text-slate-500">{label}</dt>
                <dd className="mt-1 text-xl font-semibold text-slate-950">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {notice}
        </div>
      ) : null}

      <nav
        aria-label="Workforce configuration sections"
        className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={active}
              className={
                active
                  ? "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                  : "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              }
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {loading && !snapshot ? (
          <div
            role="status"
            className="flex min-h-64 items-center justify-center gap-3 text-sm text-slate-600"
          >
            <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
            Loading protected workforce configuration…
          </div>
        ) : snapshot ? (
          <>
            {activeTab === "structure" ? (
              <StructurePanel
                snapshot={snapshot}
                canManage={canManageStructure}
                pending={pending}
                runMutation={runMutation}
              />
            ) : null}
            {activeTab === "jobs" ? (
              <JobProfilesPanel
                snapshot={snapshot}
                canManageProfiles={canManageJobProfiles}
                canManageKpis={canManageKpis}
                pending={pending}
                runMutation={runMutation}
              />
            ) : null}
            {activeTab === "kpis" ? (
              <KpiDefinitionsPanel
                snapshot={snapshot}
                canManage={canManageKpis}
                pending={pending}
                runMutation={runMutation}
              />
            ) : null}
            {activeTab === "agents" ? (
              <AgentProfilesPanel
                snapshot={snapshot}
                canManage={canManageAgentProfiles}
                pending={pending}
                runMutation={runMutation}
              />
            ) : null}
          </>
        ) : (
          <div className="min-h-48 text-center text-sm text-slate-600">
            Configuration is unavailable. Use Refresh after resolving the error.
          </div>
        )}
      </div>
    </section>
  );
}