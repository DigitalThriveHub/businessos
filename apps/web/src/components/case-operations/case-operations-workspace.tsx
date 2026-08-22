"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  FileArchive,
  FileCheck2,
  FilePlus2,
  Files,
  History,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import type { ZodType } from "zod";

import {
  CASE_TASK_PRIORITIES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_SECURITY_CLASSIFICATIONS,
  MATTER_DEADLINE_TYPES,
  type DocumentRequest,
  type MatterDeadline,
  type MatterDocument,
  type MatterOperations,
  type MatterTask,
  documentProcessingSchema,
  documentRequestSchema,
  documentUploadRegistrationSchema,
  matterDeadlineSchema,
  matterDocumentSchema,
  matterOperationsSchema,
  matterTaskSchema,
} from "@/lib/case-operations";
import {
  caseOperationsRequest,
  downloadPrivateDocument,
  formatBytes,
  formatDateTime,
  isoOrNull,
  sha256Hex,
  uploadPrivateDocument,
} from "./case-operations-client";

type CaseOperationsWorkspaceProps = {
  organisationId: string;
  matterId: string;
  permissions: string[];
};

type Tab = "tasks" | "deadlines" | "documents" | "requests" | "timeline";

type RequestItemDraft = {
  key: string;
  title: string;
  category: (typeof DOCUMENT_CATEGORIES)[number];
  description: string;
  isRequired: boolean;
};

const inputClass =
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:bg-slate-100 disabled:text-slate-500";

const allowedFileTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The case operation could not be completed.";
}

function label(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function statusClass(value: string): string {
  if (["AVAILABLE", "COMPLETED", "SATISFIED", "CLEAN"].includes(value)) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (["BLOCKED", "MISSED", "QUARANTINED", "INFECTED", "ERROR"].includes(value)) {
    return "bg-red-100 text-red-800";
  }
  if (["PENDING_SCAN", "PENDING_UPLOAD", "PENDING"].includes(value)) {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-slate-100 text-slate-700";
}

export function CaseOperationsWorkspace({
  organisationId,
  matterId,
  permissions,
}: CaseOperationsWorkspaceProps) {
  const granted = useMemo(
    () => new Set(permissions.map((permission) => permission.toLowerCase())),
    [permissions],
  );
  const can = useCallback(
    (permission: string) => granted.has(permission.toLowerCase()),
    [granted],
  );
  const [data, setData] = useState<MatterOperations | null>(null);
  const [tab, setTab] = useState<Tab>("tasks");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    priority: "NORMAL" as (typeof CASE_TASK_PRIORITIES)[number],
    assignedToUserId: "",
    dueAt: "",
    reminderAt: "",
  });
  const [deadlineForm, setDeadlineForm] = useState({
    title: "",
    description: "",
    deadlineType: "INTERNAL" as (typeof MATTER_DEADLINE_TYPES)[number],
    dueAt: "",
    timezone: "Europe/London",
    isCritical: false,
    ownerUserId: "",
    sourceReference: "",
  });
  const [requestForm, setRequestForm] = useState({
    title: "",
    message: "",
    dueAt: "",
  });
  const [requestItems, setRequestItems] = useState<RequestItemDraft[]>([
    {
      key: "initial-request-item",
      title: "",
      category: "GENERAL",
      description: "",
      isRequired: true,
    },
  ]);
  const [documentForm, setDocumentForm] = useState({
    title: "",
    category: "GENERAL" as (typeof DOCUMENT_CATEGORIES)[number],
    classification:
      "CONFIDENTIAL" as (typeof DOCUMENT_SECURITY_CLASSIFICATIONS)[number],
    requestItemId: "",
    clientVisible: false,
    retentionReviewAt: "",
    file: null as File | null,
  });

  const readUrl = useMemo(() => {
    const query = new URLSearchParams({ organisationId, matterId });
    return `/api/case-operations?${query.toString()}`;
  }, [matterId, organisationId]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await caseOperationsRequest(readUrl, matterOperationsSchema, {
        signal,
      });
      setData(response);
    },
    [readUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void load(controller.signal)
        .catch((loadError) => {
          if (!controller.signal.aborted) setError(errorMessage(loadError));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const mutate = useCallback(
    async <T,>(input: unknown, schema: ZodType<T>) =>
      caseOperationsRequest("/api/case-operations/mutations", schema, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    [],
  );

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (message?: string) => {
    await load();
    if (message) setNotice(message);
  };

  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    void run("task.create", async () => {
      await mutate(
        {
          operation: "task.create",
          organisationId,
          matterId,
          payload: {
            title: taskForm.title,
            description: taskForm.description.trim() || null,
            priority: taskForm.priority,
            assignedToUserId: taskForm.assignedToUserId || null,
            dueAt: isoOrNull(taskForm.dueAt),
            reminderAt: isoOrNull(taskForm.reminderAt),
          },
        },
        matterTaskSchema,
      );
      setTaskForm({
        title: "",
        description: "",
        priority: "NORMAL",
        assignedToUserId: "",
        dueAt: "",
        reminderAt: "",
      });
      await refresh("Task created with audit and timeline evidence.");
    });
  };

  const changeTaskStatus = (task: MatterTask, status: MatterTask["status"]) => {
    const explanation =
      status === "BLOCKED"
        ? window.prompt("Why is this task blocked?")
        : status === "CANCELLED"
          ? window.prompt("Why is this task being cancelled?")
          : status === "COMPLETED"
            ? window.prompt("Completion note (optional)")
            : "";
    if (["BLOCKED", "CANCELLED"].includes(status) && !explanation?.trim()) return;

    void run(`task.status:${task.id}`, async () => {
      await mutate(
        {
          operation: "task.status",
          organisationId,
          matterId,
          taskId: task.id,
          payload: {
            version: task.version,
            status,
            blockedReason: status === "BLOCKED" ? explanation : null,
            completionNote: status === "COMPLETED" ? explanation || null : null,
            reason: status === "CANCELLED" ? explanation : null,
          },
        },
        matterTaskSchema,
      );
      await refresh(`Task moved to ${label(status)}.`);
    });
  };

  const submitDeadline = (event: FormEvent) => {
    event.preventDefault();
    void run("deadline.create", async () => {
      await mutate(
        {
          operation: "deadline.create",
          organisationId,
          matterId,
          payload: {
            title: deadlineForm.title,
            description: deadlineForm.description.trim() || null,
            deadlineType: deadlineForm.deadlineType,
            dueAt: isoOrNull(deadlineForm.dueAt),
            timezone: deadlineForm.timezone,
            isCritical: deadlineForm.isCritical,
            ownerUserId: deadlineForm.ownerUserId || null,
            sourceReference: deadlineForm.sourceReference.trim() || null,
          },
        },
        matterDeadlineSchema,
      );
      setDeadlineForm({
        title: "",
        description: "",
        deadlineType: "INTERNAL",
        dueAt: "",
        timezone: "Europe/London",
        isCritical: false,
        ownerUserId: "",
        sourceReference: "",
      });
      await refresh("Deadline created and added to the matter timeline.");
    });
  };

  const resolveDeadline = (
    deadline: MatterDeadline,
    status: "SATISFIED" | "MISSED" | "CANCELLED",
  ) => {
    const reason = window.prompt(`Record the evidence for ${label(status)}:`);
    if (!reason?.trim()) return;
    void run(`deadline.status:${deadline.id}`, async () => {
      await mutate(
        {
          operation: "deadline.status",
          organisationId,
          matterId,
          deadlineId: deadline.id,
          payload: { version: deadline.version, status, reason },
        },
        matterDeadlineSchema,
      );
      await refresh(`Deadline moved to ${label(status)}.`);
    });
  };

  const submitRequest = (event: FormEvent) => {
    event.preventDefault();
    if (requestItems.some((item) => !item.title.trim())) {
      setError("Every requested item needs a title.");
      return;
    }
    void run("request.create", async () => {
      await mutate(
        {
          operation: "document-request.create",
          organisationId,
          matterId,
          payload: {
            recipientClientId: data?.matter.primaryClientId ?? null,
            title: requestForm.title,
            message: requestForm.message.trim() || null,
            dueAt: isoOrNull(requestForm.dueAt),
            items: requestItems.map((item) => ({
              category: item.category,
              title: item.title,
              description: item.description.trim() || null,
              isRequired: item.isRequired,
            })),
          },
        },
        documentRequestSchema,
      );
      setRequestForm({ title: "", message: "", dueAt: "" });
      setRequestItems([
        {
          key: crypto.randomUUID(),
          title: "",
          category: "GENERAL",
          description: "",
          isRequired: true,
        },
      ]);
      await refresh("Document request drafted.");
    });
  };

  const sendRequest = (request: DocumentRequest) => {
    void run(`request.send:${request.id}`, async () => {
      await mutate(
        {
          operation: "document-request.send",
          organisationId,
          matterId,
          requestId: request.id,
          payload: { version: request.version },
        },
        documentRequestSchema,
      );
      await refresh("Document request issued and recorded.");
    });
  };

  const finaliseRequest = (
    request: DocumentRequest,
    status: "COMPLETED" | "CANCELLED" | "EXPIRED",
  ) => {
    const reason = window.prompt(`Record the reason for ${label(status)}:`);
    if (!reason?.trim()) return;
    void run(`request.status:${request.id}`, async () => {
      await mutate(
        {
          operation: "document-request.status",
          organisationId,
          matterId,
          requestId: request.id,
          payload: { version: request.version, status, reason },
        },
        documentRequestSchema,
      );
      await refresh(`Document request moved to ${label(status)}.`);
    });
  };

  const submitDocument = (event: FormEvent) => {
    event.preventDefault();
    const file = documentForm.file;
    if (!file) {
      setError("Select a document to upload.");
      return;
    }
    if (!file.type || file.size > 52_428_800) {
      setError("The file type is unsupported or exceeds the 50 MB limit.");
      return;
    }

    void run("document.upload", async () => {
      const hash = await sha256Hex(file);
      const registration = await mutate(
        {
          operation: "document.register",
          organisationId,
          matterId,
          payload: {
            requestItemId: documentForm.requestItemId || null,
            title: documentForm.title,
            category: documentForm.category,
            securityClassification: documentForm.classification,
            clientVisible: documentForm.clientVisible,
            retentionReviewAt: isoOrNull(documentForm.retentionReviewAt),
            originalFileName: file.name,
            contentType: file.type.toLowerCase(),
            sizeBytes: file.size,
            sha256Hex: hash,
          },
        },
        documentUploadRegistrationSchema,
      );
      await uploadPrivateDocument(registration, file);
      await mutate(
        {
          operation: "document.finalise",
          organisationId,
          matterId,
          documentId: registration.documentId,
          versionId: registration.versionId,
          payload: {},
        },
        documentProcessingSchema,
      );
      setDocumentForm({
        title: "",
        category: "GENERAL",
        classification: "CONFIDENTIAL",
        requestItemId: "",
        clientVisible: false,
        retentionReviewAt: "",
        file: null,
      });
      await refresh("File uploaded to quarantine and queued for malware scanning.");
    });
  };

  const uploadNewVersion = (documentRecord: MatterDocument, file: File) => {
    if (!file.type || file.size > 52_428_800) {
      setError("The file type is unsupported or exceeds the 50 MB limit.");
      return;
    }
    void run(`document.version:${documentRecord.id}`, async () => {
      const hash = await sha256Hex(file);
      const registration = await mutate(
        {
          operation: "document.version.register",
          organisationId,
          matterId,
          documentId: documentRecord.id,
          payload: {
            originalFileName: file.name,
            contentType: file.type.toLowerCase(),
            sizeBytes: file.size,
            sha256Hex: hash,
          },
        },
        documentUploadRegistrationSchema,
      );
      await uploadPrivateDocument(registration, file);
      await mutate(
        {
          operation: "document.finalise",
          organisationId,
          matterId,
          documentId: documentRecord.id,
          versionId: registration.versionId,
          payload: {},
        },
        documentProcessingSchema,
      );
      await refresh("New version uploaded to quarantine; the clean current version remains available.");
    });
  };

  const resumePendingUpload = (documentRecord: MatterDocument, file: File) => {
    const pending = documentRecord.pendingVersion;
    if (!pending || pending.status !== "PENDING_UPLOAD") return;

    void run(`document.resume:${documentRecord.id}`, async () => {
      const hash = await sha256Hex(file);
      if (
        hash !== pending.sha256Hex ||
        file.size !== pending.sizeBytes ||
        file.type.toLowerCase() !== pending.contentType
      ) {
        throw new Error(
          "Select the exact file originally registered for this pending upload.",
        );
      }

      await uploadPrivateDocument(
        {
          documentId: documentRecord.id,
          versionId: pending.id,
          storageBucket: "businessos-documents",
          storagePath: pending.storagePath,
          expectedContentType: pending.contentType,
          expectedSizeBytes: pending.sizeBytes,
          status: "PENDING_UPLOAD",
        },
        file,
      );
      await mutate(
        {
          operation: "document.finalise",
          organisationId,
          matterId,
          documentId: documentRecord.id,
          versionId: pending.id,
          payload: {},
        },
        documentProcessingSchema,
      );
      await refresh("Pending upload resumed and queued for malware scanning.");
    });
  };

  const downloadDocument = (documentRecord: MatterDocument) => {
    const current = documentRecord.currentVersion;
    if (!current || documentRecord.status !== "AVAILABLE") return;
    void run(`document.download:${documentRecord.id}`, async () => {
      await downloadPrivateDocument({
        bucket: current.storageBucket,
        path: current.storagePath,
        fileName: current.originalFileName,
      });
      setNotice("Private document download authorised.");
    });
  };

  const archiveDocument = (documentRecord: MatterDocument) => {
    const reason = window.prompt("Record the retention or archive reason:");
    if (!reason?.trim()) return;
    void run(`document.archive:${documentRecord.id}`, async () => {
      await mutate(
        {
          operation: "document.archive",
          organisationId,
          matterId,
          documentId: documentRecord.id,
          payload: { version: documentRecord.version, reason },
        },
        matterDocumentSchema,
      );
      await refresh("Document archived and removed from normal access.");
    });
  };

  const requestedItems = useMemo(
    () =>
      data?.documentRequests
        .filter((request) => !["COMPLETED", "CANCELLED", "EXPIRED"].includes(request.status))
        .flatMap((request) =>
          request.items
            .filter((item) => ["REQUESTED", "REJECTED"].includes(item.status))
            .map((item) => ({
              id: item.id,
              label: `${request.title} · ${item.title}`,
              category: item.category,
            })),
        ) ?? [],
    [data?.documentRequests],
  );

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-2xl border bg-white">
        <LoaderCircle className="h-7 w-7 animate-spin text-slate-500" aria-label="Loading matter operations" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
        <p className="font-semibold">Matter operations are unavailable.</p>
        <p className="mt-2 text-sm">{error ?? "Refresh the matter or contact an administrator."}</p>
      </div>
    );
  }

  const tabs: Array<{ key: Tab; label: string; icon: typeof ListChecks; count?: number }> = [
    { key: "tasks", label: "Tasks", icon: ListChecks, count: data.tasks.length },
    { key: "deadlines", label: "Deadlines", icon: Clock3, count: data.deadlines.length },
    { key: "documents", label: "Documents", icon: Files, count: data.documents.length },
    { key: "requests", label: "Requests", icon: Send, count: data.documentRequests.length },
    { key: "timeline", label: "Timeline", icon: History, count: data.timeline.length },
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/matters" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to matters
            </Link>
            <p className="mt-4 text-sm font-medium text-slate-500">{data.matter.matterNumber} · {data.matter.serviceType}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.matter.title}</h1>
            <p className="mt-2 text-sm text-slate-600">Primary client: {data.matter.primaryClientName}</p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("refresh", () => refresh("Matter operations refreshed."))}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{notice}</p>
        </div>
      )}

      <nav aria-label="Matter operation areas" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-current={tab === item.key ? "page" : undefined}
              className={tab === item.key
                ? "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"
                : "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {item.label}
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{item.count}</span>
            </button>
          );
        })}
      </nav>

      {tab === "tasks" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
          {can("tasks.create") && (
            <form onSubmit={submitTask} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Create task</h2>
              <div className="mt-4 space-y-4">
                <Field label="Task title"><input required maxLength={240} value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} /></Field>
                <Field label="Priority"><select value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as typeof current.priority }))} className={inputClass}>{CASE_TASK_PRIORITIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
                {can("tasks.assign") && <Field label="Assigned worker"><select value={taskForm.assignedToUserId} onChange={(event) => setTaskForm((current) => ({ ...current, assignedToUserId: event.target.value }))} className={inputClass}><option value="">Unassigned</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></Field>}
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Due"><input type="datetime-local" value={taskForm.dueAt} onChange={(event) => setTaskForm((current) => ({ ...current, dueAt: event.target.value }))} className={inputClass} /></Field><Field label="Reminder"><input type="datetime-local" value={taskForm.reminderAt} onChange={(event) => setTaskForm((current) => ({ ...current, reminderAt: event.target.value }))} className={inputClass} /></Field></div>
                <Field label="Description"><textarea maxLength={10000} value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} className={`${inputClass} min-h-24`} /></Field>
                <button disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"><Plus className="h-4 w-4" /> Create task</button>
              </div>
            </form>
          )}
          <div className="space-y-3">
            {data.tasks.length === 0 && <EmptyState message="No authorised tasks are recorded for this matter." />}
            {data.tasks.map((task) => (
              <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{task.title}</h3><p className="mt-1 text-sm text-slate-600">{task.assignedToName ?? "Unassigned"} · Due {formatDateTime(task.dueAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(task.status)}`}>{label(task.status)}</span></div>
                {task.description && <p className="mt-3 text-sm leading-6 text-slate-600">{task.description}</p>}
                {can("tasks.complete") && !["COMPLETED", "CANCELLED"].includes(task.status) && <div className="mt-4 flex flex-wrap gap-2">{task.status !== "IN_PROGRESS" && <ActionButton onClick={() => changeTaskStatus(task, "IN_PROGRESS")} disabled={busy !== null}>Start</ActionButton>}<ActionButton onClick={() => changeTaskStatus(task, "BLOCKED")} disabled={busy !== null}>Block</ActionButton><ActionButton onClick={() => changeTaskStatus(task, "COMPLETED")} disabled={busy !== null}>Complete</ActionButton><ActionButton danger onClick={() => changeTaskStatus(task, "CANCELLED")} disabled={busy !== null}>Cancel</ActionButton></div>}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "deadlines" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
          {can("deadlines.create") && <form onSubmit={submitDeadline} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Create deadline</h2><div className="mt-4 space-y-4"><Field label="Deadline title"><input required maxLength={240} value={deadlineForm.title} onChange={(event) => setDeadlineForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} /></Field><Field label="Type"><select value={deadlineForm.deadlineType} onChange={(event) => setDeadlineForm((current) => ({ ...current, deadlineType: event.target.value as typeof current.deadlineType }))} className={inputClass}>{MATTER_DEADLINE_TYPES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label="Due time"><input required type="datetime-local" value={deadlineForm.dueAt} onChange={(event) => setDeadlineForm((current) => ({ ...current, dueAt: event.target.value }))} className={inputClass} /></Field>{can("deadlines.assign") && <Field label="Owner"><select value={deadlineForm.ownerUserId} onChange={(event) => setDeadlineForm((current) => ({ ...current, ownerUserId: event.target.value }))} className={inputClass}><option value="">Unassigned</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></Field>}<Field label="Source reference"><input maxLength={240} value={deadlineForm.sourceReference} onChange={(event) => setDeadlineForm((current) => ({ ...current, sourceReference: event.target.value }))} className={inputClass} /></Field>{can("deadlines.manage") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deadlineForm.isCritical} onChange={(event) => setDeadlineForm((current) => ({ ...current, isCritical: event.target.checked }))} /> Critical controlled deadline</label>}<button disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"><Clock3 className="h-4 w-4" /> Create deadline</button></div></form>}
          <div className="space-y-3">{data.deadlines.length === 0 && <EmptyState message="No authorised deadlines are recorded for this matter." />}{data.deadlines.map((deadline) => <article key={deadline.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${deadline.isCritical ? "border-red-300" : "border-slate-200"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{deadline.title}</h3>{deadline.isCritical && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Critical</span>}</div><p className="mt-1 text-sm text-slate-600">{label(deadline.deadlineType)} · {deadline.ownerName ?? "Unassigned"}</p><p className="mt-2 font-medium">{formatDateTime(deadline.dueAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(deadline.status)}`}>{label(deadline.status)}</span></div>{can("deadlines.manage") && deadline.status === "OPEN" && <div className="mt-4 flex flex-wrap gap-2"><ActionButton onClick={() => resolveDeadline(deadline, "SATISFIED")} disabled={busy !== null}>Satisfied</ActionButton><ActionButton danger onClick={() => resolveDeadline(deadline, "MISSED")} disabled={busy !== null}>Missed</ActionButton><ActionButton onClick={() => resolveDeadline(deadline, "CANCELLED")} disabled={busy !== null}>Cancel</ActionButton></div>}</article>)}</div>
        </div>
      )}

      {tab === "documents" && (
        <div className="space-y-6">
          {can("documents.upload") && <form onSubmit={submitDocument} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><UploadCloud className="h-5 w-5" /><h2 className="text-lg font-semibold">Upload to private document vault</h2></div><p className="mt-2 text-sm text-slate-600">Files remain inaccessible until a trusted malware scanner records a clean hash-matched result.</p><div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3"><Field label="Document title"><input required maxLength={240} value={documentForm.title} onChange={(event) => setDocumentForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} /></Field><Field label="Category"><select value={documentForm.category} onChange={(event) => setDocumentForm((current) => ({ ...current, category: event.target.value as typeof current.category }))} className={inputClass}>{DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label="Security classification"><select value={documentForm.classification} onChange={(event) => setDocumentForm((current) => ({ ...current, classification: event.target.value as typeof current.classification }))} className={inputClass}>{DOCUMENT_SECURITY_CLASSIFICATIONS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label="Requested item"><select value={documentForm.requestItemId} onChange={(event) => { const selected = requestedItems.find((item) => item.id === event.target.value); setDocumentForm((current) => ({ ...current, requestItemId: event.target.value, category: selected?.category ?? current.category })); }} className={inputClass}><option value="">Not linked to a request</option>{requestedItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label="Retention review"><input type="datetime-local" value={documentForm.retentionReviewAt} onChange={(event) => setDocumentForm((current) => ({ ...current, retentionReviewAt: event.target.value }))} className={inputClass} /></Field><Field label="File (maximum 50 MB)"><input required type="file" accept={allowedFileTypes} onChange={(event) => setDocumentForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} className={`${inputClass} py-2`} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={documentForm.clientVisible} onChange={(event) => setDocumentForm((current) => ({ ...current, clientVisible: event.target.checked }))} /> Approved for future client-portal visibility</label></div><button disabled={busy !== null} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-60">{busy === "document.upload" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Register and upload securely</button></form>}
          <div className="grid gap-4 lg:grid-cols-2">{data.documents.length === 0 && <EmptyState message="No authorised documents are recorded for this matter." />}{data.documents.map((documentRecord) => <article key={documentRecord.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{documentRecord.title}</h3><p className="mt-1 text-sm text-slate-600">{label(documentRecord.category)} · {label(documentRecord.securityClassification)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(documentRecord.status)}`}>{label(documentRecord.status)}</span></div>{documentRecord.currentVersion && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Version</dt><dd className="font-medium">{documentRecord.currentVersion.versionNumber}</dd></div><div><dt className="text-slate-500">Size</dt><dd className="font-medium">{formatBytes(documentRecord.currentVersion.sizeBytes)}</dd></div><div className="col-span-2"><dt className="text-slate-500">File</dt><dd className="truncate font-medium">{documentRecord.currentVersion.originalFileName}</dd></div></dl>}<div className="mt-4 flex flex-wrap gap-2">{documentRecord.status === "AVAILABLE" && documentRecord.currentVersion && <ActionButton onClick={() => downloadDocument(documentRecord)} disabled={busy !== null}><Download className="h-4 w-4" /> Download</ActionButton>}{can("documents.upload") && documentRecord.status === "AVAILABLE" && !documentRecord.pendingVersion && <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"><UploadCloud className="h-4 w-4" /> New version<input type="file" accept={allowedFileTypes} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadNewVersion(documentRecord, file); event.target.value = ""; }} /></label>}{can("documents.upload") && documentRecord.pendingVersion?.status === "PENDING_UPLOAD" && <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-3 text-sm font-semibold text-amber-900"><UploadCloud className="h-4 w-4" /> Resume pending upload<input type="file" accept={allowedFileTypes} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) resumePendingUpload(documentRecord, file); event.target.value = ""; }} /></label>}{can("documents.archive") && documentRecord.status === "AVAILABLE" && !documentRecord.pendingVersion && <ActionButton danger onClick={() => archiveDocument(documentRecord)} disabled={busy !== null}><FileArchive className="h-4 w-4" /> Archive</ActionButton>}</div>{documentRecord.pendingVersion?.status === "PENDING_SCAN" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Replacement version {documentRecord.pendingVersion.versionNumber} is quarantined pending trusted malware scan. The last clean version remains available.</p>}{documentRecord.status === "PENDING_SCAN" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Quarantined pending trusted malware scan. It cannot be downloaded.</p>}{documentRecord.status === "QUARANTINED" && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900">Quarantined by a malware or integrity control.</p>}</article>)}</div>
        </div>
      )}

      {tab === "requests" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)]">
          {can("document_requests.create") && <form onSubmit={submitRequest} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Draft document request</h2><p className="mt-2 text-sm text-slate-600">Recipient: {data.matter.primaryClientName}</p><div className="mt-4 space-y-4"><Field label="Request title"><input required maxLength={240} value={requestForm.title} onChange={(event) => setRequestForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} /></Field><Field label="Due"><input type="datetime-local" value={requestForm.dueAt} onChange={(event) => setRequestForm((current) => ({ ...current, dueAt: event.target.value }))} className={inputClass} /></Field><Field label="Message"><textarea maxLength={10000} value={requestForm.message} onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))} className={`${inputClass} min-h-24`} /></Field><div><div className="flex items-center justify-between"><h3 className="font-semibold">Requested items</h3><button type="button" disabled={requestItems.length >= 25} onClick={() => setRequestItems((current) => [...current, { key: crypto.randomUUID(), title: "", category: "GENERAL", description: "", isRequired: true }])} className="text-sm font-semibold text-blue-700">+ Add item</button></div><div className="mt-3 space-y-3">{requestItems.map((item, index) => <div key={item.key} className="rounded-xl border bg-slate-50 p-3"><input required placeholder="Document/item title" maxLength={240} value={item.title} onChange={(event) => setRequestItems((current) => current.map((value) => value.key === item.key ? { ...value, title: event.target.value } : value))} className={inputClass} /><div className="mt-2 flex gap-2"><select value={item.category} onChange={(event) => setRequestItems((current) => current.map((value) => value.key === item.key ? { ...value, category: event.target.value as typeof value.category } : value))} className={inputClass}>{DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select>{requestItems.length > 1 && <button type="button" onClick={() => setRequestItems((current) => current.filter((value) => value.key !== item.key))} className="rounded-xl border border-red-300 px-3 text-sm text-red-800">Remove {index + 1}</button>}</div></div>)}</div></div><button disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"><ClipboardCheck className="h-4 w-4" /> Save draft</button></div></form>}
          <div className="space-y-3">{data.documentRequests.length === 0 && <EmptyState message="No authorised document requests are recorded." />}{data.documentRequests.map((request) => <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{request.title}</h3><p className="mt-1 text-sm text-slate-600">Due {formatDateTime(request.dueAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(request.status)}`}>{label(request.status)}</span></div><ul className="mt-4 space-y-2">{request.items.map((item) => <li key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{item.title}{item.isRequired ? " *" : ""}</span><span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(item.status)}`}>{label(item.status)}</span></li>)}</ul><div className="mt-4 flex flex-wrap gap-2">{can("document_requests.send") && request.status === "DRAFT" && <ActionButton onClick={() => sendRequest(request)} disabled={busy !== null}><Send className="h-4 w-4" /> Issue request</ActionButton>}{can("document_requests.manage") && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(request.status) && <><ActionButton onClick={() => finaliseRequest(request, "COMPLETED")} disabled={busy !== null}><FileCheck2 className="h-4 w-4" /> Complete</ActionButton>{request.status !== "DRAFT" && <ActionButton onClick={() => finaliseRequest(request, "EXPIRED")} disabled={busy !== null}>Expire</ActionButton>}<ActionButton danger onClick={() => finaliseRequest(request, "CANCELLED")} disabled={busy !== null}>Cancel</ActionButton></>}</div></article>)}</div>
        </div>
      )}

      {tab === "timeline" && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><History className="h-5 w-5" /><h2 className="text-lg font-semibold">Append-only matter timeline</h2></div><ol className="mt-5 space-y-4">{data.timeline.length === 0 && <li className="text-sm text-slate-600">No authorised operational events are visible.</li>}{data.timeline.map((event) => <li key={event.id} className="border-l-2 border-slate-300 pl-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{event.summary}</p><span className="text-xs text-slate-500">{formatDateTime(event.occurredAt)}</span></div><p className="mt-1 text-xs text-slate-500">{event.actorName} · {label(event.eventType)}</p></li>)}</ol></div>}

      <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><p>Private files use storage RLS, immutable registered paths and hashes, MFA-gated sensitive permissions, and fail-closed malware quarantine. Raw file contents are never written to audit events.</p></div>
    </section>
  );
}

function ActionButton({ children, onClick, disabled, danger = false }: { children: ReactNode; onClick: () => void; disabled: boolean; danger?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={danger ? "inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-800 disabled:opacity-60" : "inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"}>{children}</button>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">{message}</div>;
}