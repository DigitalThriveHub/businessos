"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  pilotReadinessSchema,
  type PilotReadiness,
} from "@/lib/pilot-readiness";

type Props = { organisationId: string; canManage: boolean };
const roleScenarios: Record<string, string> = {
  Client:
    "Submit information, accept terms, pay, upload documents, message the firm and view progress",
  Sales:
    "Qualify an enquiry, issue engagement terms, collect the initial payment and hand over",
  Administrator:
    "Match identities, route work, schedule activity and control duplicate records",
  Caseworker:
    "Request and review documents, complete tasks, update the matter and prepare solicitor review",
  Solicitor:
    "Review evidence, approve legal progression and return controlled instructions",
  Finance:
    "Issue a VAT-correct invoice, allocate payment and verify the balanced ledger",
  Manager:
    "Monitor workload, SLA breaches, approvals, exceptions and audited overrides",
  Director:
    "Review conversion, cash collected, outstanding revenue, risk and operational capacity",
};

export function PilotReadinessWorkspace({ organisationId, canManage }: Props) {
  const [data, setData] = useState<PilotReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [role, setRole] = useState("Client");
  const [note, setNote] = useState("");
  const [defect, setDefect] = useState({
    affectedRole: "Client",
    severity: "MEDIUM",
    title: "",
    detail: "",
    reproductionSteps: "",
  });
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError(null);
    const response = await fetch(
      `/api/pilot-readiness?organisationId=${encodeURIComponent(organisationId)}`,
      { cache: "no-store" },
    );
    const body: unknown = await response.json();
    if (!response.ok) {
      setError("Pilot readiness could not be loaded.");
      return;
    }
    setData(pilotReadinessSchema.parse(body));
  }, [organisationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const recorded = useMemo(
    () =>
      new Map(data?.roleAcceptances.map((item) => [item.roleName, item]) ?? []),
    [data],
  );
  async function mutate(body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/pilot-readiness/mutations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json();
      if (!response.ok)
        throw new Error(
          typeof responseBody?.message === "string"
            ? responseBody.message
            : "The change failed.",
        );
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "The change failed.");
    } finally {
      setBusy(null);
    }
  }
  async function recordAcceptance(status: "PASS" | "FAIL" | "BLOCKED") {
    if (note.trim().length < 10) {
      setError("Record at least ten characters of real test evidence.");
      return;
    }
    const existing = recorded.get(role);
    await mutate(
      {
        operation: "acceptance.record",
        organisationId,
        payload: {
          key: `role.${role.toLowerCase()}`,
          roleName: role,
          scenarioName: roleScenarios[role],
          status,
          evidenceNote: note.trim(),
          expectedVersion: existing?.version,
        },
      },
      `role-${role}`,
    );
    setNote("");
  }
  async function createDefect() {
    await mutate(
      { operation: "feedback.create", organisationId, payload: defect },
      "defect",
    );
    setDefect({
      affectedRole: "Client",
      severity: "MEDIUM",
      title: "",
      detail: "",
      reproductionSteps: "",
    });
  }
  async function resolveDefect(
    id: string,
    version: number,
    status: "RESOLVED" | "ACCEPTED_RISK",
  ) {
    const resolution = resolutions[id]?.trim() ?? "";
    if (resolution.length < 10) {
      setError(
        "Record at least ten characters explaining the resolution or accepted risk.",
      );
      return;
    }
    await mutate(
      {
        operation: "feedback.resolve",
        organisationId,
        feedbackId: id,
        payload: {
          status,
          resolution,
          expectedVersion: version,
        },
      },
      `resolve-${id}`,
    );
    setResolutions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700">
            Evidence-backed launch control
          </p>
          <h1 className="mt-1 text-3xl font-bold">Local pilot readiness</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            A pilot is ready only when system controls pass, all eight
            stakeholder journeys are evidenced and no high or critical defect
            remains open.
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
      <section
        className={`rounded-2xl border p-6 ${data?.summary.readyForPilot ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
      >
        <div className="flex items-center gap-3">
          {data?.summary.readyForPilot ? (
            <ShieldCheck className="h-7 w-7 text-emerald-700" />
          ) : (
            <AlertTriangle className="h-7 w-7 text-amber-700" />
          )}
          <div>
            <h2 className="text-xl font-bold">
              {data?.summary.readyForPilot
                ? "Ready for controlled local pilot"
                : "Pilot launch is blocked"}
            </h2>
            <p className="text-sm">
              System {data?.summary.systemChecksReady ?? 0}/
              {data?.summary.systemChecksTotal ?? 12} · Roles{" "}
              {data?.summary.roleAcceptancesPassed ?? 0}/
              {data?.summary.roleAcceptancesRequired ?? 8} · High/critical
              defects {data?.summary.openHighCriticalDefects ?? 0}
            </p>
          </div>
        </div>
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Automated readiness controls</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {data?.systemChecks.map((item) => (
            <article
              key={item.key}
              className="flex gap-3 rounded-xl border p-4"
            >
              {item.ready ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              )}
              <div>
                <p className="font-semibold">{item.title}</p>
                <p className="text-xs font-medium text-slate-500">
                  {item.category.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Stakeholder acceptance</h2>
          <div className="mt-4 space-y-2">
            {data?.requiredRoles.map((name) => {
              const item = recorded.get(name);
              return (
                <button
                  key={name}
                  onClick={() => setRole(name)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${role === name ? "border-slate-950" : ""}`}
                >
                  <span>
                    <strong>{name}</strong>
                    <span className="block text-xs text-slate-600">
                      {roleScenarios[name]}
                    </span>
                  </span>
                  <span className="ml-3 text-xs font-bold">
                    {item?.status ?? "NOT TESTED"}
                  </span>
                </button>
              );
            })}
          </div>
          {canManage ? (
            <div className="mt-5 border-t pt-5">
              <label className="text-sm font-semibold" htmlFor="pilot-evidence">
                Evidence for {role}
              </label>
              <textarea
                id="pilot-evidence"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-2 min-h-24 w-full rounded-xl border p-3 text-sm"
                placeholder="Who tested it, what they completed and the observed result"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void recordAcceptance("PASS")}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Pass
                </button>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void recordAcceptance("FAIL")}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Fail
                </button>
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void recordAcceptance("BLOCKED")}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Blocked
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Pilot defect register</h2>
          <div className="mt-4 space-y-3">
            {data?.feedback.length ? (
              data.feedback.map((item) => (
                <article key={item.id} className="rounded-xl border p-4">
                  <div className="flex justify-between gap-3">
                    <p className="font-semibold">{item.title}</p>
                    <span className="text-xs font-bold">
                      {item.severity} · {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
                  {item.resolution ? (
                    <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">
                      <strong>Resolution:</strong> {item.resolution}
                    </p>
                  ) : null}
                  {canManage &&
                  (item.status === "OPEN" || item.status === "TRIAGED") ? (
                    <div className="mt-3 border-t pt-3">
                      <textarea
                        aria-label={`Resolution for ${item.title}`}
                        value={resolutions[item.id] ?? ""}
                        onChange={(event) =>
                          setResolutions({
                            ...resolutions,
                            [item.id]: event.target.value,
                          })
                        }
                        className="min-h-20 w-full rounded-lg border p-2 text-sm"
                        placeholder="Resolution evidence, or the reason and owner for accepting the risk"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void resolveDefect(
                              item.id,
                              item.version,
                              "RESOLVED",
                            )
                          }
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"
                        >
                          Resolve
                        </button>
                        <button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void resolveDefect(
                              item.id,
                              item.version,
                              "ACCEPTED_RISK",
                            )
                          }
                          className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white"
                        >
                          Accept risk
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="text-sm text-slate-600">
                No pilot defects recorded.
              </p>
            )}
          </div>
          <div className="mt-5 border-t pt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                aria-label="Affected role"
                value={defect.affectedRole}
                onChange={(e) =>
                  setDefect({ ...defect, affectedRole: e.target.value })
                }
                className="rounded-xl border p-3"
              >
                {Object.keys(roleScenarios).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <select
                aria-label="Severity"
                value={defect.severity}
                onChange={(e) =>
                  setDefect({ ...defect, severity: e.target.value })
                }
                className="rounded-xl border p-3"
              >
                <option>LOW</option>
                <option>MEDIUM</option>
                <option>HIGH</option>
                <option>CRITICAL</option>
              </select>
            </div>
            <input
              aria-label="Defect title"
              value={defect.title}
              onChange={(e) => setDefect({ ...defect, title: e.target.value })}
              className="mt-3 w-full rounded-xl border p-3"
              placeholder="Defect title"
            />
            <textarea
              aria-label="Defect detail"
              value={defect.detail}
              onChange={(e) => setDefect({ ...defect, detail: e.target.value })}
              className="mt-3 min-h-20 w-full rounded-xl border p-3"
              placeholder="Expected versus actual result"
            />
            <textarea
              aria-label="Reproduction steps"
              value={defect.reproductionSteps}
              onChange={(e) =>
                setDefect({ ...defect, reproductionSteps: e.target.value })
              }
              className="mt-3 min-h-20 w-full rounded-xl border p-3"
              placeholder="Exact reproduction steps"
            />
            <button
              disabled={Boolean(busy)}
              onClick={() => void createDefect()}
              className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            >
              Record defect
            </button>
          </div>
        </div>
      </section>
      <footer className="rounded-2xl border bg-slate-950 p-5 text-sm text-white">
        <p className="font-semibold">Launch rule</p>
        <p className="mt-1 text-slate-300">
          Do not mark a scenario passed from assumption. Each role must use the
          system with realistic data and record observed evidence. Hosting,
          external security testing and production credentials remain separate
          paid launch evidence.
        </p>
      </footer>
    </div>
  );
}
