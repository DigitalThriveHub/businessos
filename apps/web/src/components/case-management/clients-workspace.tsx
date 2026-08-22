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
import {
  Archive,
  ArrowRight,
  Building2,
  CircleAlert,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  Users,
} from "lucide-react";

import {
  CLIENT_RISK_RATINGS,
  CLIENT_STATUS_LABELS,
  CLIENT_STATUSES,
  COMMUNICATION_CHANNELS,
  IDENTITY_VERIFICATION_STATUSES,
  PROCESSING_LAWFUL_BASES,
  type CaseManagementOptions,
  type Client,
  type ClientKind,
  type ClientList,
  caseManagementOptionsSchema,
  clientListSchema,
  clientSchema,
  conversionResultSchema,
} from "@/lib/case-management";
import {
  caseManagementRequest,
  dateTimeLocal,
  formatDateTime,
  isoOrNull,
  nullable,
} from "./case-management-client";

type ClientsWorkspaceProps = {
  organisationId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canConvert: boolean;
};

type ClientForm = {
  kind: ClientKind;
  firstName: string;
  lastName: string;
  organisationName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  countryOfResidenceCode: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  addressCountryCode: string;
  preferredLanguage: string;
  preferredCommunication: (typeof COMMUNICATION_CHANNELS)[number];
  processingLawfulBasis: (typeof PROCESSING_LAWFUL_BASES)[number];
  privacyNoticeVersion: string;
  privacyNoticeAcknowledgedAt: string;
  marketingConsent: boolean;
  marketingConsentAt: string;
  marketingConsentSource: string;
  riskRating: (typeof CLIENT_RISK_RATINGS)[number];
  identityVerificationStatus: (typeof IDENTITY_VERIFICATION_STATUSES)[number];
  identityVerifiedAt: string;
  identityVerificationExpiresAt: string;
  assignedToUserId: string;
  retentionReviewAt: string;
  status: "ONBOARDING" | "ACTIVE" | "INACTIVE";
};

type ConversionForm = {
  enquiryId: string;
  existingClientId: string;
  matterTitle: string;
  serviceType: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  departmentId: string;
  teamId: string;
  assignedToUserId: string;
  supervisorUserId: string;
  jurisdictionCountryCode: string;
  criticalDeadlineAt: string;
  nextActionSummary: string;
  nextActionAt: string;
  processingLawfulBasis: (typeof PROCESSING_LAWFUL_BASES)[number];
};

const EMPTY_CLIENT_FORM: ClientForm = {
  kind: "INDIVIDUAL",
  firstName: "",
  lastName: "",
  organisationName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  nationality: "",
  countryOfResidenceCode: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  addressCountryCode: "",
  preferredLanguage: "en-GB",
  preferredCommunication: "EMAIL",
  processingLawfulBasis: "CONTRACT",
  privacyNoticeVersion: "",
  privacyNoticeAcknowledgedAt: "",
  marketingConsent: false,
  marketingConsentAt: "",
  marketingConsentSource: "",
  riskRating: "NOT_ASSESSED",
  identityVerificationStatus: "NOT_STARTED",
  identityVerifiedAt: "",
  identityVerificationExpiresAt: "",
  assignedToUserId: "",
  retentionReviewAt: "",
  status: "ONBOARDING",
};

const EMPTY_CONVERSION_FORM: ConversionForm = {
  enquiryId: "",
  existingClientId: "",
  matterTitle: "",
  serviceType: "",
  priority: "NORMAL",
  departmentId: "",
  teamId: "",
  assignedToUserId: "",
  supervisorUserId: "",
  jurisdictionCountryCode: "GB",
  criticalDeadlineAt: "",
  nextActionSummary: "",
  nextActionAt: "",
  processingLawfulBasis: "CONTRACT",
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

function clientToForm(client: Client): ClientForm {
  return {
    kind: client.kind,
    firstName: client.firstName ?? "",
    lastName: client.lastName ?? "",
    organisationName: client.organisationName ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    dateOfBirth: client.dateOfBirth ?? "",
    nationality: client.nationality ?? "",
    countryOfResidenceCode: client.countryOfResidenceCode ?? "",
    addressLine1: client.addressLine1 ?? "",
    addressLine2: client.addressLine2 ?? "",
    city: client.city ?? "",
    region: client.region ?? "",
    postalCode: client.postalCode ?? "",
    addressCountryCode: client.addressCountryCode ?? "",
    preferredLanguage: client.preferredLanguage,
    preferredCommunication: client.preferredCommunication,
    processingLawfulBasis: client.processingLawfulBasis,
    privacyNoticeVersion: client.privacyNoticeVersion ?? "",
    privacyNoticeAcknowledgedAt: dateTimeLocal(
      client.privacyNoticeAcknowledgedAt,
    ),
    marketingConsent: client.marketingConsent,
    marketingConsentAt: dateTimeLocal(client.marketingConsentAt),
    marketingConsentSource: client.marketingConsentSource ?? "",
    riskRating: client.riskRating,
    identityVerificationStatus: client.identityVerificationStatus,
    identityVerifiedAt: dateTimeLocal(client.identityVerifiedAt),
    identityVerificationExpiresAt: dateTimeLocal(
      client.identityVerificationExpiresAt,
    ),
    assignedToUserId: client.assignedToUserId ?? "",
    retentionReviewAt: dateTimeLocal(client.retentionReviewAt),
    status:
      client.status === "ARCHIVED" ? "INACTIVE" : client.status,
  };
}

function badge(status: Client["status"]): string {
  if (status === "ACTIVE") return "bg-emerald-100 text-emerald-800";
  if (status === "ONBOARDING") return "bg-blue-100 text-blue-800";
  if (status === "ARCHIVED") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The operation could not be completed.";
}

export function ClientsWorkspace({
  organisationId,
  canCreate,
  canUpdate,
  canArchive,
  canConvert,
}: ClientsWorkspaceProps) {
  const [list, setList] = useState<ClientList | null>(null);
  const [options, setOptions] = useState<CaseManagementOptions | null>(null);
  const [selected, setSelected] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState<ClientForm>(EMPTY_CLIENT_FORM);
  const [createForm, setCreateForm] = useState<ClientForm>(EMPTY_CLIENT_FORM);
  const [conversionForm, setConversionForm] =
    useState<ConversionForm>(EMPTY_CONVERSION_FORM);
  const [conversionKey, setConversionKey] = useState(() => crypto.randomUUID());
  const [archiveReason, setArchiveReason] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showConvert, setShowConvert] = useState(false);

  const readUrl = useCallback(
    (resource: "clients" | "options", extra?: URLSearchParams) => {
      const query = extra ?? new URLSearchParams();
      query.set("organisationId", organisationId);
      query.set("resource", resource);
      return `/api/case-management?${query.toString()}`;
    },
    [organisationId],
  );

  const loadClients = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (search) query.set("search", search);
      if (status) query.set("status", status);
      const response = await caseManagementRequest(
        readUrl("clients", query),
        clientListSchema,
        { signal },
      );
      setList(response);
    },
    [page, readUrl, search, status],
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

  const refresh = useCallback(async () => {
    await Promise.all([loadClients(), loadOptions()]);
  }, [loadClients, loadOptions]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void Promise.all([
        loadClients(controller.signal),
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
  }, [loadClients, loadOptions]);

  const mutate = useCallback(
    async <T,>(input: unknown, schema: ZodType<T>) =>
      caseManagementRequest(
        "/api/case-management/mutations",
        schema,
        { method: "POST", body: JSON.stringify(input) },
      ),
    [],
  );

  const selectClient = (client: Client) => {
    setSelected(client);
    setEditForm(clientToForm(client));
    setArchiveReason("");
    setNotice(null);
    setError(null);
  };

  const createPayload = (form: ClientForm) => ({
    kind: form.kind,
    firstName: form.kind === "INDIVIDUAL" ? nullable(form.firstName) : null,
    lastName: form.kind === "INDIVIDUAL" ? nullable(form.lastName) : null,
    organisationName:
      form.kind === "ORGANISATION" ? nullable(form.organisationName) : null,
    email: nullable(form.email),
    phone: nullable(form.phone),
    dateOfBirth: form.kind === "INDIVIDUAL" ? nullable(form.dateOfBirth) : null,
    nationality: form.kind === "INDIVIDUAL" ? nullable(form.nationality) : null,
    countryOfResidenceCode: nullable(form.countryOfResidenceCode)?.toUpperCase(),
    addressLine1: nullable(form.addressLine1),
    addressLine2: nullable(form.addressLine2),
    city: nullable(form.city),
    region: nullable(form.region),
    postalCode: nullable(form.postalCode),
    addressCountryCode: nullable(form.addressCountryCode)?.toUpperCase(),
    preferredLanguage: form.preferredLanguage,
    preferredCommunication: form.preferredCommunication,
    processingLawfulBasis: form.processingLawfulBasis,
    privacyNoticeVersion: nullable(form.privacyNoticeVersion),
    privacyNoticeAcknowledgedAt: isoOrNull(form.privacyNoticeAcknowledgedAt),
    marketingConsent: form.marketingConsent,
    marketingConsentAt: form.marketingConsent
      ? isoOrNull(form.marketingConsentAt)
      : null,
    marketingConsentSource: form.marketingConsent
      ? nullable(form.marketingConsentSource)
      : null,
    riskRating: form.riskRating,
    identityVerificationStatus: form.identityVerificationStatus,
    identityVerifiedAt: isoOrNull(form.identityVerifiedAt),
    identityVerificationExpiresAt: isoOrNull(
      form.identityVerificationExpiresAt,
    ),
    assignedToUserId: nullable(form.assignedToUserId),
    retentionReviewAt: isoOrNull(form.retentionReviewAt),
  });

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("client.create");
    setError(null);
    setNotice(null);
    try {
      const client = await mutate(
        {
          operation: "client.create",
          organisationId,
          payload: createPayload(createForm),
        },
        clientSchema,
      );
      setCreateForm(EMPTY_CLIENT_FORM);
      setShowCreate(false);
      selectClient(client);
      setNotice(`${client.clientNumber} was created successfully.`);
      await refresh();
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy("client.update");
    setError(null);
    setNotice(null);
    try {
      const client = await mutate(
        {
          operation: "client.update",
          organisationId,
          clientId: selected.id,
          payload: {
            ...createPayload(editForm),
            status: editForm.status,
            expectedVersion: selected.version,
          },
        },
        clientSchema,
      );
      selectClient(client);
      setNotice(`${client.clientNumber} was saved.`);
      await refresh();
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitArchive = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy("client.archive");
    setError(null);
    try {
      const client = await mutate(
        {
          operation: "client.archive",
          organisationId,
          clientId: selected.id,
          payload: {
            reason: archiveReason,
            expectedVersion: selected.version,
          },
        },
        clientSchema,
      );
      selectClient(client);
      setNotice(`${client.clientNumber} was archived with an audit record.`);
      await refresh();
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const submitConversion = async (event: FormEvent) => {
    event.preventDefault();
    const enquiry = options?.convertibleEnquiries.find(
      (item) => item.id === conversionForm.enquiryId,
    );
    if (!enquiry) return;
    setBusy("enquiry.convert");
    setError(null);
    setNotice(null);
    try {
      const result = await mutate(
        {
          operation: "enquiry.convert",
          organisationId,
          enquiryId: enquiry.id,
          payload: {
            idempotencyKey: conversionKey,
            existingClientId: nullable(conversionForm.existingClientId),
            clientKind: "INDIVIDUAL",
            processingLawfulBasis: conversionForm.processingLawfulBasis,
            matterTitle: conversionForm.matterTitle,
            serviceType: conversionForm.serviceType || enquiry.serviceType || "General service",
            priority: conversionForm.priority,
            departmentId: nullable(conversionForm.departmentId),
            teamId: nullable(conversionForm.teamId),
            assignedToUserId: nullable(conversionForm.assignedToUserId),
            supervisorUserId: nullable(conversionForm.supervisorUserId),
            jurisdictionCountryCode:
              nullable(conversionForm.jurisdictionCountryCode)?.toUpperCase() ?? null,
            criticalDeadlineAt: isoOrNull(conversionForm.criticalDeadlineAt),
            nextActionSummary: nullable(conversionForm.nextActionSummary),
            nextActionAt: isoOrNull(conversionForm.nextActionAt),
          },
        },
        conversionResultSchema,
      );
      setNotice(
        `${result.clientNumber} and ${result.matterNumber} were provisioned atomically.`,
      );
      setConversionForm(EMPTY_CONVERSION_FORM);
      setConversionKey(crypto.randomUUID());
      setShowConvert(false);
      await refresh();
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(null);
    }
  };

  const filteredTeams = useMemo(
    () =>
      options?.teams.filter(
        (team) =>
          !conversionForm.departmentId ||
          team.departmentId === conversionForm.departmentId,
      ) ?? [],
    [conversionForm.departmentId, options?.teams],
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Protected client lifecycle</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Manage lawful basis, identity status, consent, ownership and retention without leaving BusinessOS.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canConvert && (
            <button
              type="button"
              onClick={() => setShowConvert((value) => !value)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Convert enquiry
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New client
            </button>
          )}
        </div>
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

      {showConvert && canConvert && (
        <form onSubmit={submitConversion} className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Convert an authorised enquiry</h2>
          <p className="mt-1 text-sm text-slate-600">
            One transaction creates or links the client, opens the matter, records compliance state and closes the enquiry as converted.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Qualified enquiry">
              <select
                required
                value={conversionForm.enquiryId}
                onChange={(event) => {
                  const item = options?.convertibleEnquiries.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  setConversionForm((current) => ({
                    ...current,
                    enquiryId: event.target.value,
                    serviceType: item?.serviceType ?? current.serviceType,
                    matterTitle: item?.serviceType
                      ? `${item.serviceType} matter`
                      : current.matterTitle,
                  }));
                  setConversionKey(crypto.randomUUID());
                }}
                className={inputClass}
              >
                <option value="">Select enquiry</option>
                {options?.convertibleEnquiries.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Existing client (optional)">
              <select
                value={conversionForm.existingClientId}
                onChange={(event) => setConversionForm((current) => ({ ...current, existingClientId: event.target.value }))}
                className={inputClass}
              >
                <option value="">Create client from enquiry</option>
                {options?.clients.map((item) => (
                  <option key={item.id} value={item.id}>{item.clientNumber} · {item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Matter title">
              <input required maxLength={240} value={conversionForm.matterTitle} onChange={(event) => setConversionForm((current) => ({ ...current, matterTitle: event.target.value }))} className={inputClass} />
            </Field>
            <Field label="Service type">
              <input required maxLength={160} value={conversionForm.serviceType} onChange={(event) => setConversionForm((current) => ({ ...current, serviceType: event.target.value }))} className={inputClass} />
            </Field>
            <Field label="Department">
              <select value={conversionForm.departmentId} onChange={(event) => setConversionForm((current) => ({ ...current, departmentId: event.target.value, teamId: "" }))} className={inputClass}>
                <option value="">No department</option>
                {options?.departments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Team">
              <select value={conversionForm.teamId} onChange={(event) => setConversionForm((current) => ({ ...current, teamId: event.target.value }))} className={inputClass}>
                <option value="">No team</option>
                {filteredTeams.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Assigned worker">
              <select value={conversionForm.assignedToUserId} onChange={(event) => setConversionForm((current) => ({ ...current, assignedToUserId: event.target.value }))} className={inputClass}>
                <option value="">Unassigned</option>
                {options?.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Supervisor">
              <select value={conversionForm.supervisorUserId} onChange={(event) => setConversionForm((current) => ({ ...current, supervisorUserId: event.target.value }))} className={inputClass}>
                <option value="">No supervisor</option>
                {options?.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Critical deadline">
              <input type="datetime-local" value={conversionForm.criticalDeadlineAt} onChange={(event) => setConversionForm((current) => ({ ...current, criticalDeadlineAt: event.target.value }))} className={inputClass} />
            </Field>
            <Field label="Next action">
              <input maxLength={500} value={conversionForm.nextActionSummary} onChange={(event) => setConversionForm((current) => ({ ...current, nextActionSummary: event.target.value }))} className={inputClass} />
            </Field>
            <Field label="Next action time">
              <input type="datetime-local" value={conversionForm.nextActionAt} onChange={(event) => setConversionForm((current) => ({ ...current, nextActionAt: event.target.value }))} className={inputClass} />
            </Field>
            <Field label="Processing lawful basis">
              <select value={conversionForm.processingLawfulBasis} onChange={(event) => setConversionForm((current) => ({ ...current, processingLawfulBasis: event.target.value as ConversionForm["processingLawfulBasis"] }))} className={inputClass}>
                {PROCESSING_LAWFUL_BASES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
              </select>
            </Field>
          </div>
          <button disabled={busy !== null} type="submit" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white disabled:opacity-60">
            {busy === "enquiry.convert" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Convert atomically
          </button>
        </form>
      )}

      {showCreate && canCreate && (
        <ClientEditor
          heading="Create client"
          form={createForm}
          setForm={setCreateForm}
          options={options}
          busy={busy === "client.create"}
          allowKind
          submitLabel="Create protected client"
          onSubmit={submitCreate}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.5fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchDraft.trim());
            }}
            className="flex gap-2"
          >
            <input aria-label="Search clients" placeholder="Name, email, phone or reference" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className={inputClass} />
            <button type="submit" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white" aria-label="Search">
              <Search className="h-4 w-4" />
            </button>
          </form>
          <select aria-label="Client status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={`${inputClass} mt-3`}>
            <option value="">All client statuses</option>
            {CLIENT_STATUSES.map((item) => <option key={item} value={item}>{CLIENT_STATUS_LABELS[item]}</option>)}
          </select>

          <div className="mt-4 space-y-2">
            {loading && <p className="p-4 text-sm text-slate-500">Loading protected clients…</p>}
            {!loading && !list?.items.length && <p className="p-4 text-sm text-slate-500">No clients match this view.</p>}
            {list?.items.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => selectClient(client)}
                className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === client.id ? "border-slate-950 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{client.displayName}</p>
                    <p className="mt-1 text-xs text-slate-500">{client.clientNumber} · {client.kind === "INDIVIDUAL" ? "Individual" : "Organisation"}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge(client.status)}`}>{CLIENT_STATUS_LABELS[client.status]}</span>
                </div>
                <p className="mt-3 truncate text-sm text-slate-600">{client.email ?? client.phone ?? "No contact channel"}</p>
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
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
              <Users className="mx-auto h-8 w-8" aria-hidden="true" />
              <p className="mt-3 font-medium">Select a client to view its protected record.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      {selected.kind === "INDIVIDUAL" ? <UserRound className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                      <h2 className="text-xl font-semibold">{selected.displayName}</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{selected.clientNumber} · Version {selected.version}</p>
                  </div>
                  <button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm">
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </button>
                </div>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-slate-500">Assigned to</dt><dd className="mt-1 font-medium">{selected.assignedToName ?? "Unassigned"}</dd></div>
                  <div><dt className="text-slate-500">Identity</dt><dd className="mt-1 font-medium">{selected.identityVerificationStatus.replaceAll("_", " ")}</dd></div>
                  <div><dt className="text-slate-500">Retention review</dt><dd className="mt-1 font-medium">{formatDateTime(selected.retentionReviewAt)}</dd></div>
                </dl>
              </div>

              {canUpdate && selected.status !== "ARCHIVED" ? (
                <ClientEditor
                  heading="Client record"
                  form={editForm}
                  setForm={setEditForm}
                  options={options}
                  busy={busy === "client.update"}
                  allowKind={false}
                  submitLabel="Save client"
                  onSubmit={submitUpdate}
                />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
                  This record is read-only for your role{selected.status === "ARCHIVED" ? " because archived evidence is immutable" : ""}.
                </div>
              )}

              {canArchive && selected.status !== "ARCHIVED" && (
                <form onSubmit={submitArchive} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <h3 className="font-semibold text-amber-950">Archive client</h3>
                  <p className="mt-1 text-sm text-amber-900">Archiving is blocked while any linked matter remains open.</p>
                  <textarea required minLength={10} maxLength={1000} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} className={`${inputClass} mt-4 min-h-24`} placeholder="Record the retention and business reason" />
                  <button disabled={busy !== null} type="submit" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-900 px-4 text-sm font-semibold text-white disabled:opacity-60">
                    <Archive className="h-4 w-4" /> Archive with evidence
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ClientEditor({
  heading,
  form,
  setForm,
  options,
  busy,
  allowKind,
  submitLabel,
  onSubmit,
}: {
  heading: string;
  form: ClientForm;
  setForm: Dispatch<SetStateAction<ClientForm>>;
  options: CaseManagementOptions | null;
  busy: boolean;
  allowKind: boolean;
  submitLabel: string;
  onSubmit: (event: FormEvent) => void;
}) {
  const update = <K extends keyof ClientForm>(key: K, value: ClientForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold">{heading}</h3>
      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {allowKind && (
          <Field label="Client type">
            <select value={form.kind} onChange={(event) => update("kind", event.target.value as ClientKind)} className={inputClass}>
              <option value="INDIVIDUAL">Individual</option>
              <option value="ORGANISATION">Organisation</option>
            </select>
          </Field>
        )}
        {form.kind === "INDIVIDUAL" ? (
          <>
            <Field label="First name"><input required maxLength={100} value={form.firstName} onChange={(event) => update("firstName", event.target.value)} className={inputClass} /></Field>
            <Field label="Last name"><input maxLength={100} value={form.lastName} onChange={(event) => update("lastName", event.target.value)} className={inputClass} /></Field>
            <Field label="Date of birth"><input type="date" value={form.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} className={inputClass} /></Field>
            <Field label="Nationality"><input maxLength={100} value={form.nationality} onChange={(event) => update("nationality", event.target.value)} className={inputClass} /></Field>
          </>
        ) : (
          <Field label="Organisation name"><input required maxLength={240} value={form.organisationName} onChange={(event) => update("organisationName", event.target.value)} className={inputClass} /></Field>
        )}
        <Field label="Email"><input type="email" maxLength={320} value={form.email} onChange={(event) => update("email", event.target.value)} className={inputClass} /></Field>
        <Field label="Telephone"><input maxLength={50} value={form.phone} onChange={(event) => update("phone", event.target.value)} className={inputClass} /></Field>
        <Field label="Country of residence"><input maxLength={2} value={form.countryOfResidenceCode} onChange={(event) => update("countryOfResidenceCode", event.target.value.toUpperCase())} className={inputClass} placeholder="GB" /></Field>
        <Field label="Address line 1"><input maxLength={240} value={form.addressLine1} onChange={(event) => update("addressLine1", event.target.value)} className={inputClass} /></Field>
        <Field label="Address line 2"><input maxLength={240} value={form.addressLine2} onChange={(event) => update("addressLine2", event.target.value)} className={inputClass} /></Field>
        <Field label="City"><input maxLength={120} value={form.city} onChange={(event) => update("city", event.target.value)} className={inputClass} /></Field>
        <Field label="Region"><input maxLength={120} value={form.region} onChange={(event) => update("region", event.target.value)} className={inputClass} /></Field>
        <Field label="Postcode"><input maxLength={30} value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} className={inputClass} /></Field>
        <Field label="Address country"><input maxLength={2} value={form.addressCountryCode} onChange={(event) => update("addressCountryCode", event.target.value.toUpperCase())} className={inputClass} placeholder="GB" /></Field>
        <Field label="Preferred language"><input required maxLength={16} value={form.preferredLanguage} onChange={(event) => update("preferredLanguage", event.target.value)} className={inputClass} /></Field>
        <Field label="Preferred communication"><select value={form.preferredCommunication} onChange={(event) => update("preferredCommunication", event.target.value as ClientForm["preferredCommunication"])} className={inputClass}>{COMMUNICATION_CHANNELS.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
        <Field label="Lawful basis"><select value={form.processingLawfulBasis} onChange={(event) => update("processingLawfulBasis", event.target.value as ClientForm["processingLawfulBasis"])} className={inputClass}>{PROCESSING_LAWFUL_BASES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></Field>
        <Field label="Privacy notice version"><input maxLength={40} value={form.privacyNoticeVersion} onChange={(event) => update("privacyNoticeVersion", event.target.value)} className={inputClass} /></Field>
        <Field label="Privacy notice acknowledged"><input type="datetime-local" value={form.privacyNoticeAcknowledgedAt} onChange={(event) => update("privacyNoticeAcknowledgedAt", event.target.value)} className={inputClass} /></Field>
        <Field label="Assigned worker"><select value={form.assignedToUserId} onChange={(event) => update("assignedToUserId", event.target.value)} className={inputClass}><option value="">Unassigned</option>{options?.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
        <Field label="Client risk"><select value={form.riskRating} onChange={(event) => update("riskRating", event.target.value as ClientForm["riskRating"])} className={inputClass}>{CLIENT_RISK_RATINGS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></Field>
        <Field label="Identity status"><select value={form.identityVerificationStatus} onChange={(event) => update("identityVerificationStatus", event.target.value as ClientForm["identityVerificationStatus"])} className={inputClass}>{IDENTITY_VERIFICATION_STATUSES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></Field>
        <Field label="Identity verified at"><input type="datetime-local" value={form.identityVerifiedAt} onChange={(event) => update("identityVerifiedAt", event.target.value)} className={inputClass} /></Field>
        <Field label="Identity expires at"><input type="datetime-local" value={form.identityVerificationExpiresAt} onChange={(event) => update("identityVerificationExpiresAt", event.target.value)} className={inputClass} /></Field>
        <Field label="Retention review"><input type="datetime-local" value={form.retentionReviewAt} onChange={(event) => update("retentionReviewAt", event.target.value)} className={inputClass} /></Field>
        {!allowKind && <Field label="Client status"><select value={form.status} onChange={(event) => update("status", event.target.value as ClientForm["status"])} className={inputClass}><option value="ONBOARDING">Onboarding</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field>}
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={form.marketingConsent} onChange={(event) => update("marketingConsent", event.target.checked)} /> Marketing consent recorded
        </label>
        {form.marketingConsent && (
          <>
            <Field label="Consent timestamp"><input required type="datetime-local" value={form.marketingConsentAt} onChange={(event) => update("marketingConsentAt", event.target.value)} className={inputClass} /></Field>
            <Field label="Consent source"><input required maxLength={120} value={form.marketingConsentSource} onChange={(event) => update("marketingConsentSource", event.target.value)} className={inputClass} /></Field>
          </>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-500">At least one of email or telephone is required. Privacy notice version and acknowledgement must be recorded together.</p>
      <button disabled={busy} type="submit" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {submitLabel}
      </button>
    </form>
  );
}