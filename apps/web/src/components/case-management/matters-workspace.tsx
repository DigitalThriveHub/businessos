"use client";

import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ZodType } from "zod";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";

import {
  ADDITIONAL_MATTER_PARTY_ROLES,
  AML_CHECK_STATUSES,
  CLIENT_CARE_STATUSES,
  CLIENT_RISK_RATINGS,
  CONFLICT_CHECK_STATUSES,
  MATTER_PRIORITIES,
  MATTER_STATUSES,
  MATTER_STATUS_LABELS,
  type CaseManagementOptions,
  type Matter,
  type MatterList,
  type MatterPriority,
  type MatterStatus,
  caseManagementOptionsSchema,
  matterListSchema,
  matterSchema,
} from "@/lib/case-management";
import {
  caseManagementRequest,
  dateTimeLocal,
  formatDateTime,
  isoOrNull,
  nullable,
} from "./case-management-client";

type MattersWorkspaceProps = {
  organisationId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canAssign: boolean;
  canManageStatus: boolean;
  canManageCompliance: boolean;
  canManageParties: boolean;
  canArchive: boolean;
};

type MatterForm = {
  primaryClientId: string;
  title: string;
  description: string;
  serviceType: string;
  jurisdictionCountryCode: string;
  externalReference: string;
  priority: MatterPriority;
  nextActionSummary: string;
  nextActionAt: string;
  criticalDeadlineAt: string;
  targetCompletionAt: string;
  departmentId: string;
  teamId: string;
  assignedToUserId: string;
  supervisorUserId: string;
};

type ComplianceForm = {
  conflictStatus: (typeof CONFLICT_CHECK_STATUSES)[number];
  conflictReference: string;
  amlStatus: (typeof AML_CHECK_STATUSES)[number];
  amlReference: string;
  clientCareStatus: (typeof CLIENT_CARE_STATUSES)[number];
  riskRating: (typeof CLIENT_RISK_RATINGS)[number];
  riskReason: string;
};

type PartyForm = {
  clientId: string;
  role: (typeof ADDITIONAL_MATTER_PARTY_ROLES)[number];
  roleDescription: string;
};

const EMPTY_MATTER_FORM: MatterForm = {
  primaryClientId: "",
  title: "",
  description: "",
  serviceType: "",
  jurisdictionCountryCode: "GB",
  externalReference: "",
  priority: "NORMAL",
  nextActionSummary: "",
  nextActionAt: "",
  criticalDeadlineAt: "",
  targetCompletionAt: "",
  departmentId: "",
  teamId: "",
  assignedToUserId: "",
  supervisorUserId: "",
};

const EMPTY_PARTY_FORM: PartyForm = {
  clientId: "",
  role: "DEPENDANT",
  roleDescription: "",
};

const TRANSITIONS: Readonly<Record<MatterStatus, readonly MatterStatus[]>> = {
  INTAKE: ["CONFLICT_CHECK", "ON_HOLD", "CANCELLED"],
  CONFLICT_CHECK: ["CLIENT_CARE", "ON_HOLD", "CANCELLED"],
  CLIENT_CARE: ["AWAITING_DOCUMENTS", "ACTIVE", "ON_HOLD", "CANCELLED"],
  AWAITING_DOCUMENTS: ["ACTIVE", "ON_HOLD", "CANCELLED"],
  ACTIVE: ["SUBMITTED", "DECISION_RECEIVED", "ON_HOLD", "CLOSED", "CANCELLED"],
  SUBMITTED: ["DECISION_RECEIVED", "ON_HOLD", "CANCELLED"],
  DECISION_RECEIVED: ["ACTIVE", "ON_HOLD", "CLOSED", "CANCELLED"],
  ON_HOLD: [
    "CONFLICT_CHECK",
    "CLIENT_CARE",
    "AWAITING_DOCUMENTS",
    "ACTIVE",
    "SUBMITTED",
    "DECISION_RECEIVED",
    "CANCELLED",
  ],
  CLOSED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

const inputClass =
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:bg-slate-100 disabled:text-slate-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The operation could not be completed.";
}

function statusClass(status: MatterStatus): string {
  if (["ACTIVE", "SUBMITTED", "DECISION_RECEIVED"].includes(status)) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (["CANCELLED", "ARCHIVED"].includes(status)) {
    return "bg-slate-200 text-slate-700";
  }
  if (status === "ON_HOLD") return "bg-amber-100 text-amber-800";
  return "bg-blue-100 text-blue-800";
}

function matterToForm(matter: Matter): MatterForm {
  return {
    primaryClientId: matter.primaryClientId,
    title: matter.title,
    description: matter.description ?? "",
    serviceType: matter.serviceType,
    jurisdictionCountryCode: matter.jurisdictionCountryCode ?? "",
    externalReference: matter.externalReference ?? "",
    priority: matter.priority,
    nextActionSummary: matter.nextActionSummary ?? "",
    nextActionAt: dateTimeLocal(matter.nextActionAt),
    criticalDeadlineAt: dateTimeLocal(matter.criticalDeadlineAt),
    targetCompletionAt: dateTimeLocal(matter.targetCompletionAt),
    departmentId: matter.departmentId ?? "",
    teamId: matter.teamId ?? "",
    assignedToUserId: matter.assignedToUserId ?? "",
    supervisorUserId: matter.supervisorUserId ?? "",
  };
}

function complianceToForm(matter: Matter): ComplianceForm {
  return {
    conflictStatus: matter.compliance.conflictStatus,
    conflictReference: matter.compliance.conflictReference ?? "",
    amlStatus: matter.compliance.amlStatus,
    amlReference: matter.compliance.amlReference ?? "",
    clientCareStatus: matter.compliance.clientCareStatus,
    riskRating: matter.compliance.riskRating,
    riskReason: matter.compliance.riskReason ?? "",
  };
}

export function MattersWorkspace({
  organisationId,
  canCreate,
  canUpdate,
  canAssign,
  canManageStatus,
  canManageCompliance,
  canManageParties,
  canArchive,
}: MattersWorkspaceProps) {
  const [list, setList] = useState<MatterList | null>(null);
  const [options, setOptions] = useState<CaseManagementOptions | null>(null);
  const [selected, setSelected] = useState<Matter | null>(null);
  const [createForm, setCreateForm] = useState<MatterForm>(EMPTY_MATTER_FORM);
  const [editForm, setEditForm] = useState<MatterForm>(EMPTY_MATTER_FORM);
  const [complianceForm, setComplianceForm] = useState<ComplianceForm | null>(
    null,
  );
  const [partyForm, setPartyForm] = useState<PartyForm>(EMPTY_PARTY_FORM);
  const [removeReasons, setRemoveReasons] = useState<Record<string, string>>({});
  const [targetStatus, setTargetStatus] = useState<MatterStatus | "">("");
  const [statusReason, setStatusReason] = useState("");
  const [statusOutcome, setStatusOutcome] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const readUrl = useCallback(
    (resource: "options" | "matters" | "matter", extra?: URLSearchParams) => {
      const query = extra ?? new URLSearchParams();
      query.set("organisationId", organisationId);
      query.set("resource", resource);
      return `/api/case-management?${query.toString()}`;
    },
    [organisationId],
  );

  const loadMatters = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams({ page: String(page), limit: "20" });
      if (search) query.set("search", search);
      if (status) query.set("status", status);
      if (priority) query.set("priority", priority);
      const response = await caseManagementRequest(
        readUrl("matters", query),
        matterListSchema,
        { signal },
      );
      setList(response);
    },
    [page, priority, readUrl, search, status],
  );

  const loadOptions = useCallback(
    async (signal?: AbortSignal) => {
      const response = await caseManagementRequest(
        readUrl("options"),
        caseManagementOptionsSchema,
        { signal },
      );
      setOptions(response);
    },
    [readUrl],
  );

  const refreshList = useCallback(async () => {
    await Promise.all([loadMatters(), loadOptions()]);
  }, [loadMatters, loadOptions]);

  const loadMatter = useCallback(
    async (matterId: string, signal?: AbortSignal) => {
      const query = new URLSearchParams({ id: matterId });
      const matter = await caseManagementRequest(
        readUrl("matter", query),
        matterSchema,
        { signal },
      );
      setSelected(matter);
      setEditForm(matterToForm(matter));
      setComplianceForm(complianceToForm(matter));
      setTargetStatus("");
      setStatusReason("");
      setStatusOutcome("");
      setPartyForm(EMPTY_PARTY_FORM);
      setRemoveReasons({});
      return matter;
    },
    [readUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void Promise.all([
        loadMatters(controller.signal),
        loadOptions(controller.signal),
      ])
        .catch((loadError) => {
          if (!controller.signal.aborted) setError(errorText(loadError));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadMatters, loadOptions]);

  const mutate = useCallback(
    async <T,>(input: unknown, schema: ZodType<T>) =>
      caseManagementRequest("/api/case-management/mutations", schema, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    [],
  );

  const selectMatter = async (matterId: string) => {
    setDetailLoading(true);
    setError(null);
    setNotice(null);
    try {
      await loadMatter(matterId);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setDetailLoading(false);
    }
  };

  const matterPayload = (form: MatterForm, includeClient: boolean) => ({
    ...(includeClient ? { primaryClientId: form.primaryClientId } : {}),
    title: form.title,
    description: nullable(form.description),
    serviceType: form.serviceType,
    jurisdictionCountryCode:
      nullable(form.jurisdictionCountryCode)?.toUpperCase() ?? null,
    externalReference: nullable(form.externalReference),
    priority: form.priority,
    nextActionSummary: nullable(form.nextActionSummary),
    nextActionAt: isoOrNull(form.nextActionAt),
    criticalDeadlineAt: isoOrNull(form.criticalDeadlineAt),
    targetCompletionAt: isoOrNull(form.targetCompletionAt),
    // Hidden assignment values are preserved for workers without assignment
    // permission; the API and database independently reject any change.
    departmentId: nullable(form.departmentId),
    teamId: nullable(form.teamId),
    assignedToUserId: nullable(form.assignedToUserId),
    supervisorUserId: nullable(form.supervisorUserId),
  });

  const acceptMatter = async (matter: Matter, message: string) => {
    setSelected(matter);
    setEditForm(matterToForm(matter));
    setComplianceForm(complianceToForm(matter));
    setNotice(message);
    await refreshList();
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("matter.create");
    setError(null);
    setNotice(null);
    try {
      const matter = await mutate(
        {
          operation: "matter.create",
          organisationId,
          payload: matterPayload(createForm, true),
        },
        matterSchema,
      );
      setCreateForm(EMPTY_MATTER_FORM);
      setShowCreate(false);
      await acceptMatter(matter, `${matter.matterNumber} was opened.`);
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy("matter.update");
    setError(null);
    setNotice(null);
    try {
      const matter = await mutate(
        {
          operation: "matter.update",
          organisationId,
          matterId: selected.id,
          payload: {
            ...matterPayload(editForm, false),
            expectedVersion: selected.version,
          },
        },
        matterSchema,
      );
      await acceptMatter(matter, `${matter.matterNumber} was saved.`);
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitStatus = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !targetStatus) return;
    setBusy("matter.status");
    setError(null);
    setNotice(null);
    try {
      const matter = await mutate(
        {
          operation: "matter.status",
          organisationId,
          matterId: selected.id,
          payload: {
            toStatus: targetStatus,
            reason: statusReason,
            outcome: nullable(statusOutcome),
            expectedVersion: selected.version,
          },
        },
        matterSchema,
      );
      await acceptMatter(
        matter,
        `${matter.matterNumber} moved to ${MATTER_STATUS_LABELS[matter.status]}.`,
      );
      setTargetStatus("");
      setStatusReason("");
      setStatusOutcome("");
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitCompliance = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !complianceForm) return;
    setBusy("matter.compliance");
    setError(null);
    setNotice(null);
    try {
      const matter = await mutate(
        {
          operation: "matter.compliance",
          organisationId,
          matterId: selected.id,
          payload: {
            ...complianceForm,
            conflictReference: nullable(complianceForm.conflictReference),
            amlReference: nullable(complianceForm.amlReference),
            riskReason: nullable(complianceForm.riskReason),
            expectedVersion: selected.compliance.version,
          },
        },
        matterSchema,
      );
      await acceptMatter(
        matter,
        `${matter.matterNumber} compliance evidence was saved.`,
      );
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitParty = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy("matter.party.add");
    setError(null);
    setNotice(null);
    try {
      const matter = await mutate(
        {
          operation: "matter.party.add",
          organisationId,
          matterId: selected.id,
          payload: {
            clientId: partyForm.clientId,
            role: partyForm.role,
            roleDescription: nullable(partyForm.roleDescription),
          },
        },
        matterSchema,
      );
      setPartyForm(EMPTY_PARTY_FORM);
      await acceptMatter(matter, "The additional party was linked and audited.");
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const removeParty = async (partyId: string) => {
    if (!selected) return;
    const reason = removeReasons[partyId]?.trim() ?? "";
    if (reason.length < 3) {
      setError("Enter a reason before removing the party.");
      return;
    }
    setBusy(`matter.party.remove:${partyId}`);
    setError(null);
    setNotice(null);
    try {
      const matter = await mutate(
        {
          operation: "matter.party.remove",
          organisationId,
          matterId: selected.id,
          partyId,
          payload: { reason },
        },
        matterSchema,
      );
      await acceptMatter(matter, "The party link was removed with audit evidence.");
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const availableTransitions = useMemo(() => {
    if (!selected) return [];
    return TRANSITIONS[selected.status].filter(
      (next) => next !== "ARCHIVED" || canArchive,
    );
  }, [canArchive, selected]);

  const editable = selected?.status !== "ARCHIVED";
  const partyClients = useMemo(() => {
    const linked = new Set(selected?.parties.map((party) => party.clientId));
    return options?.clients.filter((client) => !linked.has(client.id)) ?? [];
  }, [options?.clients, selected?.parties]);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Controlled matter lifecycle</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Matters</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Run ownership, deadlines, parties, compliance gates and status evidence in one protected workspace.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New matter
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          {notice}
        </div>
      )}

      {showCreate && canCreate && (
        <MatterEditor
          heading="Open matter"
          form={createForm}
          setForm={setCreateForm}
          options={options}
          canAssign={canAssign}
          includeClient
          busy={busy === "matter.create"}
          submitLabel="Open controlled matter"
          onSubmit={submitCreate}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.55fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchDraft.trim());
            }}
            className="flex gap-2"
          >
            <input
              aria-label="Search matters"
              placeholder="Matter, client, service or reference"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className={inputClass}
            />
            <button type="submit" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white" aria-label="Search">
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select
              aria-label="Matter status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">All statuses</option>
              {MATTER_STATUSES.map((item) => (
                <option key={item} value={item}>{MATTER_STATUS_LABELS[item]}</option>
              ))}
            </select>
            <select
              aria-label="Matter priority"
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">All priorities</option>
              {MATTER_PRIORITIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-2">
            {loading && <p className="p-4 text-sm text-slate-500">Loading protected matters…</p>}
            {!loading && !list?.items.length && <p className="p-4 text-sm text-slate-500">No matters match this view.</p>}
            {list?.items.map((matter) => (
              <button
                key={matter.id}
                type="button"
                onClick={() => void selectMatter(matter.id)}
                className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === matter.id ? "border-slate-950 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{matter.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{matter.matterNumber} · {matter.primaryClientName}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(matter.status)}`}>
                    {MATTER_STATUS_LABELS[matter.status]}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-600">
                  <span className="truncate">{matter.serviceType}</span>
                  <span>{matter.priority}</span>
                </div>
                {matter.criticalDeadlineAt && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-red-700">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    Deadline {formatDateTime(matter.criticalDeadlineAt)}
                  </p>
                )}
              </button>
            ))}
          </div>

          {(list?.pagination.totalPages ?? 0) > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button>
              <span>Page {page} of {list?.pagination.totalPages}</span>
              <button type="button" disabled={page >= (list?.pagination.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button>
            </div>
          )}
        </div>

        <div>
          {detailLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">
              <LoaderCircle className="mx-auto h-7 w-7 animate-spin" aria-hidden="true" />
              <p className="mt-3">Loading the controlled matter record…</p>
            </div>
          ) : !selected ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
              <BriefcaseBusiness className="mx-auto h-8 w-8" aria-hidden="true" />
              <p className="mt-3 font-medium">Select a matter to view its protected record.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
                      <h2 className="text-xl font-semibold">{selected.title}</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{selected.matterNumber} · Version {selected.version}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/matters/${selected.id}`}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Open case operations
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      disabled={detailLoading}
                      onClick={() => void selectMatter(selected.id)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
                    </button>
                  </div>
                </div>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-slate-500">Primary client</dt><dd className="mt-1 font-medium">{selected.primaryClientName}</dd></div>
                  <div><dt className="text-slate-500">Assigned to</dt><dd className="mt-1 font-medium">{selected.assignedToName ?? "Unassigned"}</dd></div>
                  <div><dt className="text-slate-500">Status</dt><dd className="mt-1 font-medium">{MATTER_STATUS_LABELS[selected.status]}</dd></div>
                  <div><dt className="text-slate-500">Next action</dt><dd className="mt-1 font-medium">{selected.nextActionSummary ?? "Not set"}</dd></div>
                  <div><dt className="text-slate-500">Next action time</dt><dd className="mt-1 font-medium">{formatDateTime(selected.nextActionAt)}</dd></div>
                  <div><dt className="text-slate-500">Critical deadline</dt><dd className="mt-1 font-medium">{formatDateTime(selected.criticalDeadlineAt)}</dd></div>
                </dl>
              </div>

              {canUpdate && editable ? (
                <MatterEditor
                  heading="Matter record"
                  form={editForm}
                  setForm={setEditForm}
                  options={options}
                  canAssign={canAssign}
                  includeClient={false}
                  busy={busy === "matter.update"}
                  submitLabel="Save matter"
                  onSubmit={submitUpdate}
                />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
                  This matter is read-only for your role{!editable ? " because archived evidence is immutable" : ""}.
                </div>
              )}

              {canManageCompliance && editable && complianceForm && (
                <form onSubmit={submitCompliance} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    <h3 className="text-lg font-semibold">Compliance controls</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Active work is blocked until conflict, AML and client-care gates are satisfied.</p>
                  <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Field label="Conflict status">
                      <select value={complianceForm.conflictStatus} onChange={(event) => setComplianceForm((current) => current && ({ ...current, conflictStatus: event.target.value as ComplianceForm["conflictStatus"] }))} className={inputClass}>
                        {CONFLICT_CHECK_STATUSES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                      </select>
                    </Field>
                    <Field label="Conflict reference"><input maxLength={160} value={complianceForm.conflictReference} onChange={(event) => setComplianceForm((current) => current && ({ ...current, conflictReference: event.target.value }))} className={inputClass} /></Field>
                    <Field label="AML status">
                      <select value={complianceForm.amlStatus} onChange={(event) => setComplianceForm((current) => current && ({ ...current, amlStatus: event.target.value as ComplianceForm["amlStatus"] }))} className={inputClass}>
                        {AML_CHECK_STATUSES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                      </select>
                    </Field>
                    <Field label="AML reference"><input maxLength={160} value={complianceForm.amlReference} onChange={(event) => setComplianceForm((current) => current && ({ ...current, amlReference: event.target.value }))} className={inputClass} /></Field>
                    <Field label="Client-care status">
                      <select value={complianceForm.clientCareStatus} onChange={(event) => setComplianceForm((current) => current && ({ ...current, clientCareStatus: event.target.value as ComplianceForm["clientCareStatus"] }))} className={inputClass}>
                        {CLIENT_CARE_STATUSES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                      </select>
                    </Field>
                    <Field label="Matter risk">
                      <select value={complianceForm.riskRating} onChange={(event) => setComplianceForm((current) => current && ({ ...current, riskRating: event.target.value as ComplianceForm["riskRating"] }))} className={inputClass}>
                        {CLIENT_RISK_RATINGS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                      </select>
                    </Field>
                    <div className="md:col-span-2 lg:col-span-3">
                      <Field label="Risk rationale"><textarea maxLength={4000} value={complianceForm.riskReason} onChange={(event) => setComplianceForm((current) => current && ({ ...current, riskReason: event.target.value }))} className={`${inputClass} min-h-24`} /></Field>
                    </div>
                  </div>
                  <button disabled={busy !== null} type="submit" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-60">
                    {busy === "matter.compliance" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Save compliance evidence
                  </button>
                </form>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold">Matter parties</h3>
                <div className="mt-4 space-y-3">
                  {selected.parties.map((party) => (
                    <div key={party.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{party.clientName}</p>
                          <p className="mt-1 text-xs text-slate-500">{party.clientNumber} · {party.role.replaceAll("_", " ")}</p>
                          {party.roleDescription && <p className="mt-2 text-sm text-slate-600">{party.roleDescription}</p>}
                        </div>
                        {party.isPrimary && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">Primary</span>}
                      </div>
                      {canManageParties && editable && !party.isPrimary && (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            aria-label={`Reason to remove ${party.clientName}`}
                            minLength={3}
                            maxLength={500}
                            placeholder="Removal reason"
                            value={removeReasons[party.id] ?? ""}
                            onChange={(event) => setRemoveReasons((current) => ({ ...current, [party.id]: event.target.value }))}
                            className={inputClass}
                          />
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void removeParty(party.id)}
                            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-60"
                          >
                            <UserMinus className="h-4 w-4" aria-hidden="true" /> Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {canManageParties && editable && (
                  <form onSubmit={submitParty} className="mt-5 rounded-xl bg-slate-50 p-4">
                    <h4 className="font-semibold">Add related party</h4>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <Field label="Existing client">
                        <select required value={partyForm.clientId} onChange={(event) => setPartyForm((current) => ({ ...current, clientId: event.target.value }))} className={inputClass}>
                          <option value="">Select client</option>
                          {partyClients.map((item) => <option key={item.id} value={item.id}>{item.clientNumber} · {item.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Party role">
                        <select value={partyForm.role} onChange={(event) => setPartyForm((current) => ({ ...current, role: event.target.value as PartyForm["role"] }))} className={inputClass}>
                          {ADDITIONAL_MATTER_PARTY_ROLES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                        </select>
                      </Field>
                      <Field label="Role detail"><input maxLength={240} value={partyForm.roleDescription} onChange={(event) => setPartyForm((current) => ({ ...current, roleDescription: event.target.value }))} className={inputClass} /></Field>
                    </div>
                    <button disabled={busy !== null || partyClients.length === 0} type="submit" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
                      <UserPlus className="h-4 w-4" aria-hidden="true" /> Add party
                    </button>
                  </form>
                )}
              </div>

              {canManageStatus && editable && availableTransitions.length > 0 && (
                <form onSubmit={submitStatus} className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 shadow-sm">
                  <h3 className="text-lg font-semibold">Controlled status transition</h3>
                  <p className="mt-1 text-sm text-slate-600">Only valid next states are available. Compliance and evidence rules are enforced again by the database.</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label="Next status">
                      <select required value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as MatterStatus)} className={inputClass}>
                        <option value="">Select next status</option>
                        {availableTransitions.map((item) => <option key={item} value={item}>{MATTER_STATUS_LABELS[item]}</option>)}
                      </select>
                    </Field>
                    <Field label="Outcome (for closure)"><input maxLength={500} value={statusOutcome} onChange={(event) => setStatusOutcome(event.target.value)} className={inputClass} /></Field>
                    <div className="md:col-span-2">
                      <Field label="Reason and evidence"><textarea required minLength={3} maxLength={1000} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} className={`${inputClass} min-h-24`} /></Field>
                    </div>
                  </div>
                  <button disabled={busy !== null} type="submit" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white disabled:opacity-60">
                    {busy === "matter.status" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                    Record transition
                  </button>
                </form>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold">Status history</h3>
                <ol className="mt-4 space-y-3">
                  {selected.statusHistory.map((entry) => (
                    <li key={entry.id} className="border-l-2 border-slate-300 pl-4 text-sm">
                      <p className="font-medium">{entry.fromStatus ? `${MATTER_STATUS_LABELS[entry.fromStatus]} → ` : ""}{MATTER_STATUS_LABELS[entry.toStatus]}</p>
                      <p className="mt-1 text-slate-600">{entry.reason}</p>
                      <p className="mt-1 text-xs text-slate-500">{entry.changedByName} · {formatDateTime(entry.occurredAt)}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MatterEditor({
  heading,
  form,
  setForm,
  options,
  canAssign,
  includeClient,
  busy,
  submitLabel,
  onSubmit,
}: {
  heading: string;
  form: MatterForm;
  setForm: Dispatch<SetStateAction<MatterForm>>;
  options: CaseManagementOptions | null;
  canAssign: boolean;
  includeClient: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (event: FormEvent) => void;
}) {
  const update = <K extends keyof MatterForm>(key: K, value: MatterForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const teams =
    options?.teams.filter(
      (team) => !form.departmentId || team.departmentId === form.departmentId,
    ) ?? [];

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold">{heading}</h3>
      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {includeClient && (
          <Field label="Primary client">
            <select required value={form.primaryClientId} onChange={(event) => update("primaryClientId", event.target.value)} className={inputClass}>
              <option value="">Select client</option>
              {options?.clients.map((item) => <option key={item.id} value={item.id}>{item.clientNumber} · {item.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Matter title"><input required maxLength={240} value={form.title} onChange={(event) => update("title", event.target.value)} className={inputClass} /></Field>
        <Field label="Service type"><input required maxLength={160} value={form.serviceType} onChange={(event) => update("serviceType", event.target.value)} className={inputClass} /></Field>
        <Field label="Priority">
          <select value={form.priority} onChange={(event) => update("priority", event.target.value as MatterPriority)} className={inputClass}>
            {MATTER_PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Jurisdiction"><input maxLength={2} value={form.jurisdictionCountryCode} onChange={(event) => update("jurisdictionCountryCode", event.target.value.toUpperCase())} className={inputClass} placeholder="GB" /></Field>
        <Field label="External reference"><input maxLength={120} value={form.externalReference} onChange={(event) => update("externalReference", event.target.value)} className={inputClass} /></Field>
        <Field label="Critical deadline"><input type="datetime-local" value={form.criticalDeadlineAt} onChange={(event) => update("criticalDeadlineAt", event.target.value)} className={inputClass} /></Field>
        <Field label="Target completion"><input type="datetime-local" value={form.targetCompletionAt} onChange={(event) => update("targetCompletionAt", event.target.value)} className={inputClass} /></Field>
        <Field label="Next action"><input maxLength={500} value={form.nextActionSummary} onChange={(event) => update("nextActionSummary", event.target.value)} className={inputClass} /></Field>
        <Field label="Next action time"><input type="datetime-local" value={form.nextActionAt} onChange={(event) => update("nextActionAt", event.target.value)} className={inputClass} /></Field>
        {canAssign && (
          <>
            <Field label="Department">
              <select value={form.departmentId} onChange={(event) => setForm((current) => ({ ...current, departmentId: event.target.value, teamId: "" }))} className={inputClass}>
                <option value="">No department</option>
                {options?.departments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Team">
              <select value={form.teamId} onChange={(event) => update("teamId", event.target.value)} className={inputClass}>
                <option value="">No team</option>
                {teams.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Assigned worker">
              <select value={form.assignedToUserId} onChange={(event) => update("assignedToUserId", event.target.value)} className={inputClass}>
                <option value="">Unassigned</option>
                {options?.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Supervisor">
              <select value={form.supervisorUserId} onChange={(event) => update("supervisorUserId", event.target.value)} className={inputClass}>
                <option value="">No supervisor</option>
                {options?.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
          </>
        )}
        <div className="md:col-span-2 lg:col-span-3">
          <Field label="Matter description"><textarea maxLength={10000} value={form.description} onChange={(event) => update("description", event.target.value)} className={`${inputClass} min-h-28`} /></Field>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">Next action summary and time must be set together. Assignment changes require explicit assignment permission.</p>
      <button disabled={busy} type="submit" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {submitLabel}
      </button>
    </form>
  );
}