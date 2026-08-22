"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  TimerReset,
} from "lucide-react";

import { automationControlRequest } from "@/components/automation-control/automation-control-client";
import {
  type Approval,
  type AutomationControl,
  type AutomationWorkItem,
  type SlaPolicy,
  approvalDecisionResultSchema,
  automationControlSchema,
  completedWorkItemSchema,
  slaPolicySchema,
} from "@/lib/automation-control";

type OperationsWorkspaceProps = {
  organisationId: string;
  canComplete: boolean;
  canDecideApprovals: boolean;
  canManageSla: boolean;
};

type SlaPolicyEditorProps = {
  policy: SlaPolicy;
  saving: boolean;
  onSave: (input: {
    expectedVersion: number;
    targetSeconds: number;
    warningSeconds: number;
    isActive: boolean;
  }) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The operations request could not be completed.";
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null): string {
  if (!value) return "No deadline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function relativeDeadline(value: string | null): string {
  if (!value) return "No deadline";
  const dueAt = new Date(value).getTime();
  if (Number.isNaN(dueAt)) return "Deadline unavailable";

  const difference = dueAt - Date.now();
  const absolute = Math.abs(difference);
  const minutes = Math.max(1, Math.round(absolute / 60_000));
  const duration =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1_440
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1_440)}d`;

  return difference < 0 ? `Overdue by ${duration}` : `Due in ${duration}`;
}

function statusClass(status: string): string {
  switch (status) {
    case "BREACHED":
    case "FAILED":
    case "DEAD_LETTER":
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "AT_RISK":
    case "URGENT":
    case "EXPIRED":
      return "bg-amber-100 text-amber-900";
    case "SUCCEEDED":
    case "COMPLETED":
    case "SATISFIED":
    case "APPROVED":
      return "bg-emerald-100 text-emerald-800";
    case "PENDING":
    case "READY":
    case "RUNNING":
    case "ACTIVE":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function priorityClass(priority: string): string {
  switch (priority) {
    case "URGENT":
      return "bg-red-100 text-red-800";
    case "HIGH":
      return "bg-orange-100 text-orange-800";
    case "NORMAL":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function riskClass(risk: string): string {
  switch (risk) {
    case "CRITICAL":
      return "bg-red-100 text-red-800";
    case "HIGH":
      return "bg-orange-100 text-orange-800";
    case "MEDIUM":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function Badge({ value, className }: { value: string; className: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {titleCase(value)}
    </span>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
      {children}
    </p>
  );
}

function SlaPolicyEditor({ policy, saving, onSave }: SlaPolicyEditorProps) {
  const [targetMinutes, setTargetMinutes] = useState(
    String(Math.round(policy.targetSeconds / 60)),
  );
  const [warningMinutes, setWarningMinutes] = useState(
    String(Math.round(policy.warningSeconds / 60)),
  );
  const [isActive, setIsActive] = useState(policy.isActive);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = Number(targetMinutes);
    const warning = Number(warningMinutes);

    if (!Number.isInteger(target) || target < 1 || target > 43_200) {
      setValidationError("Target must be between 1 and 43,200 minutes.");
      return;
    }
    if (!Number.isInteger(warning) || warning < 0 || warning > target) {
      setValidationError("Warning must be a whole number from 0 to the target.");
      return;
    }

    setValidationError(null);
    await onSave({
      expectedVersion: policy.version,
      targetSeconds: target * 60,
      warningSeconds: warning * 60,
      isActive,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-2xl border border-slate-200 p-5 lg:grid-cols-[minmax(0,1fr)_140px_140px_auto_auto] lg:items-end"
    >
      <div>
        <p className="font-semibold text-slate-950">{policy.name}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          {policy.description}
        </p>
        <p className="mt-1 text-xs text-slate-500">{policy.timezone}</p>
      </div>

      <label className="text-sm font-medium text-slate-700">
        Target (minutes)
        <input
          aria-label={`${policy.name} target minutes`}
          type="number"
          min="1"
          max="43200"
          step="1"
          value={targetMinutes}
          onChange={(event) => setTargetMinutes(event.target.value)}
          disabled={saving}
          className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
        />
      </label>

      <label className="text-sm font-medium text-slate-700">
        Warning (minutes)
        <input
          aria-label={`${policy.name} warning minutes`}
          type="number"
          min="0"
          max="43200"
          step="1"
          value={warningMinutes}
          onChange={(event) => setWarningMinutes(event.target.value)}
          disabled={saving}
          className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200 disabled:opacity-60"
        />
      </label>

      <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          disabled={saving}
          className="h-4 w-4 rounded border-slate-300"
        />
        Active
      </label>

      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save policy"}
      </button>

      {validationError ? (
        <p className="text-sm text-red-700 lg:col-span-5" role="alert">
          {validationError}
        </p>
      ) : null}
    </form>
  );
}

export function OperationsWorkspace({
  organisationId,
  canComplete,
  canDecideApprovals,
  canManageSla,
}: OperationsWorkspaceProps) {
  const [control, setControl] = useState<AutomationControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadControl = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams({ organisationId });
        const response = await automationControlRequest(
          `/api/automation-control?${query.toString()}`,
          automationControlSchema,
          { signal },
        );
        setControl(response);
      } catch (loadError) {
        if (!signal?.aborted) setError(errorMessage(loadError));
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [organisationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadControl(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadControl]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!mutatingId && document.visibilityState === "visible") {
        void loadControl(undefined, true);
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadControl, mutatingId]);

  async function completeWorkItem(item: AutomationWorkItem) {
    const completionNote = window.prompt(
      `Completion evidence for “${item.title}” (optional):`,
      "Initial response completed and recorded.",
    );
    if (completionNote === null) return;

    setMutatingId(item.id);
    setError(null);
    setNotice(null);
    try {
      await automationControlRequest(
        "/api/automation-control/mutations",
        completedWorkItemSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "action.complete",
            organisationId,
            actionId: item.id,
            payload: {
              expectedVersion: item.version,
              completionNote: completionNote.trim() || undefined,
            },
          }),
        },
      );
      setNotice(`Completed: ${item.title}`);
      await loadControl(undefined, true);
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setMutatingId(null);
    }
  }

  async function decideApproval(
    approval: Approval,
    decision: "APPROVED" | "REJECTED",
  ) {
    const reason = window.prompt(
      `${decision === "APPROVED" ? "Approval" : "Rejection"} reason:`,
      "Reviewed against the business record and control requirements.",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("A decision reason of at least three characters is required.");
      return;
    }

    setMutatingId(approval.id);
    setError(null);
    setNotice(null);
    try {
      await automationControlRequest(
        "/api/automation-control/mutations",
        approvalDecisionResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "approval.decide",
            organisationId,
            approvalId: approval.id,
            payload: {
              expectedVersion: approval.version,
              decision,
              reason: reason.trim(),
            },
          }),
        },
      );
      setNotice(
        `${approval.title} was ${decision === "APPROVED" ? "approved" : "rejected"}.`,
      );
      await loadControl(undefined, true);
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setMutatingId(null);
    }
  }

  async function savePolicy(
    policy: SlaPolicy,
    input: {
      expectedVersion: number;
      targetSeconds: number;
      warningSeconds: number;
      isActive: boolean;
    },
  ) {
    setMutatingId(policy.id);
    setError(null);
    setNotice(null);
    try {
      await automationControlRequest(
        "/api/automation-control/mutations",
        slaPolicySchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "sla-policy.update",
            organisationId,
            policyId: policy.id,
            payload: input,
          }),
        },
      );
      setNotice(`${policy.name} was updated.`);
      await loadControl(undefined, true);
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setMutatingId(null);
    }
  }

  const summary = control?.summary ?? {
    readyWorkItems: 0,
    atRiskSlas: 0,
    breachedSlas: 0,
    pendingApprovals: 0,
    openEscalations: 0,
  };

  return (
    <div className="space-y-7">
      <section className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-9">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">
              Deterministic operations control
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Operations
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-300">
              Complete assigned work, protect response deadlines, review
              approvals and see escalation evidence across the organisation.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadControl(undefined, true)}
            disabled={refreshing || loading}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      <section
        aria-label="Operations summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        {[
          {
            label: "Ready work",
            value: summary.readyWorkItems,
            icon: CheckCircle2,
            colour: "text-blue-700",
          },
          {
            label: "SLA at risk",
            value: summary.atRiskSlas,
            icon: Clock3,
            colour: "text-amber-700",
          },
          {
            label: "SLA breached",
            value: summary.breachedSlas,
            icon: AlertTriangle,
            colour: "text-red-700",
          },
          {
            label: "Pending approvals",
            value: summary.pendingApprovals,
            icon: ShieldCheck,
            colour: "text-violet-700",
          },
          {
            label: "Open escalations",
            value: summary.openEscalations,
            icon: Activity,
            colour: "text-orange-700",
          },
        ].map(({ label, value, icon: Icon, colour }) => (
          <article
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <Icon aria-hidden="true" className={`h-5 w-5 ${colour}`} />
            <p className="mt-4 text-2xl font-semibold text-slate-950">{value}</p>
            <p className="mt-1 text-sm text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Work queue</h2>
            <p className="mt-1 text-sm text-slate-600">
              Human work generated by active workflow versions.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {control ? `Updated ${formatDateTime(control.generatedAt)}` : "Loading"}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          {loading && !control ? <EmptyState>Loading controlled work…</EmptyState> : null}
          {!loading && control?.workItems.length === 0 ? (
            <EmptyState>No open workflow work items.</EmptyState>
          ) : null}
          {control?.workItems.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-slate-200 p-5"
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge value={item.priority} className={priorityClass(item.priority)} />
                    <Badge value={item.status} className={statusClass(item.status)} />
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {titleCase(item.subjectType)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-950">
                    {item.title}
                  </h3>
                  <p className="mt-1 font-medium text-slate-700">
                    {item.subjectLabel}
                  </p>
                  {item.description ? (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                      {item.description}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                    <span>{item.workflowName}</span>
                    <span>{item.ownerName ?? "Organisation queue"}</span>
                    <span title={formatDateTime(item.dueAt)}>
                      {relativeDeadline(item.dueAt)}
                    </span>
                  </div>
                </div>

                {canComplete ? (
                  <button
                    type="button"
                    aria-label={`Complete ${item.title}`}
                    onClick={() => void completeWorkItem(item)}
                    disabled={mutatingId !== null}
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                    {mutatingId === item.id ? "Completing…" : "Complete"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-7 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <TimerReset aria-hidden="true" className="h-5 w-5 text-slate-700" />
            <div>
              <h2 className="text-xl font-semibold">SLA monitor</h2>
              <p className="mt-1 text-sm text-slate-600">
                Active, at-risk and breached service targets.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {control?.slas.length === 0 ? (
              <EmptyState>No active SLA instances.</EmptyState>
            ) : null}
            {control?.slas.map((sla) => (
              <article key={sla.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-950">{sla.subjectLabel}</p>
                  <Badge value={sla.status} className={statusClass(sla.status)} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{sla.policyName}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span>{sla.ownerName ?? "Organisation queue"}</span>
                  <span className={sla.status === "BREACHED" ? "font-semibold text-red-700" : ""}>
                    {relativeDeadline(sla.dueAt)}
                  </span>
                  <span>{formatDateTime(sla.dueAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Activity aria-hidden="true" className="h-5 w-5 text-slate-700" />
            <div>
              <h2 className="text-xl font-semibold">Escalations</h2>
              <p className="mt-1 text-sm text-slate-600">
                Recorded escalation evidence requiring attention.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {control?.escalations.length === 0 ? (
              <EmptyState>No open escalation events.</EmptyState>
            ) : null}
            {control?.escalations.map((escalation) => (
              <article
                key={escalation.id}
                className="rounded-xl border border-orange-200 bg-orange-50/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-950">
                    Level {escalation.level}: {escalation.subjectLabel}
                  </p>
                  <Badge
                    value={escalation.status}
                    className={statusClass(escalation.status)}
                  />
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {escalation.policyName} · {titleCase(escalation.actionKey)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Recorded {formatDateTime(escalation.occurredAt)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck aria-hidden="true" className="h-5 w-5 text-slate-700" />
          <div>
            <h2 className="text-xl font-semibold">Approval queue</h2>
            <p className="mt-1 text-sm text-slate-600">
              Human decisions with version checks, MFA enforcement and immutable evidence.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {control?.approvals.length === 0 ? (
            <EmptyState>No approval requests are visible.</EmptyState>
          ) : null}
          {control?.approvals.map((approval) => (
            <article key={approval.id} className="rounded-2xl border border-slate-200 p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      value={approval.riskLevel}
                      className={riskClass(approval.riskLevel)}
                    />
                    <Badge
                      value={approval.status}
                      className={statusClass(approval.status)}
                    />
                  </div>
                  <h3 className="mt-3 text-lg font-semibold">{approval.title}</h3>
                  <p className="mt-1 font-medium text-slate-700">
                    {approval.subjectLabel}
                  </p>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    {approval.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                    <span>Requested by {approval.requestedByName ?? "System"}</span>
                    <span>Approver {approval.approverName ?? "Assigned team"}</span>
                    <span>Expires {formatDateTime(approval.expiresAt)}</span>
                  </div>
                </div>

                {canDecideApprovals && approval.status === "PENDING" ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={`Reject ${approval.title}`}
                      onClick={() => void decideApproval(approval, "REJECTED")}
                      disabled={mutatingId !== null}
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      aria-label={`Approve ${approval.title}`}
                      onClick={() => void decideApproval(approval, "APPROVED")}
                      disabled={mutatingId !== null}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                    >
                      {mutatingId === approval.id ? "Recording…" : "Approve"}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {canManageSla ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">SLA policy controls</h2>
          <p className="mt-1 text-sm text-slate-600">
            Changes apply prospectively; existing instance evidence remains intact.
          </p>
          <div className="mt-5 space-y-4">
            {control?.policies.map((policy) => (
              <SlaPolicyEditor
                key={`${policy.id}:${policy.version}`}
                policy={policy}
                saving={mutatingId === policy.id}
                onSave={(input) => savePolicy(policy, input)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
