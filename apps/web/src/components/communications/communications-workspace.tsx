"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Mail,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";

import { communicationsRequest } from "@/components/communications/communications-client";
import {
  caseManagementOptionsSchema,
  matterListSchema,
  type CaseManagementOptions,
  type MatterSummary,
} from "@/lib/case-management";
import {
  communicationsDashboardSchema,
  genericMutationResultSchema,
  type CommunicationsDashboard,
} from "@/lib/communications";

type Props = {
  organisationId: string;
  canSend: boolean;
  canManagePortal: boolean;
  canPublishUpdates: boolean;
  canManageTemplates: boolean;
  canManageReminders: boolean;
};

type View = "inbox" | "portal" | "templates" | "reminders";

const EMPTY_OPTIONS: CaseManagementOptions = {
  departments: [],
  teams: [],
  members: [],
  clients: [],
  convertibleEnquiries: [],
};

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The secure communications operation could not be completed.";
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function idempotency(prefix: string): string {
  return `${prefix}/${crypto.randomUUID()}`;
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {children.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

export function CommunicationsWorkspace({
  organisationId,
  canSend,
  canManagePortal,
  canPublishUpdates,
  canManageTemplates,
  canManageReminders,
}: Props) {
  const [view, setView] = useState<View>("inbox");
  const [dashboard, setDashboard] = useState<CommunicationsDashboard | null>(null);
  const [options, setOptions] = useState<CaseManagementOptions>(EMPTY_OPTIONS);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [reply, setReply] = useState("");

  const [compose, setCompose] = useState({
    clientId: "",
    matterId: "",
    channel: "PORTAL",
    recipient: "",
    subject: "",
    body: "",
  });
  const [invite, setInvite] = useState({ clientId: "", matterId: "", email: "" });
  const [progress, setProgress] = useState({
    matterId: "",
    title: "",
    summary: "",
    stageKey: "",
    progressPercent: "",
  });
  const [template, setTemplate] = useState({
    key: "",
    name: "",
    channel: "EMAIL",
    subject: "",
    body: "",
  });
  const [reminder, setReminder] = useState({
    conversationId: "",
    recipient: "",
    subject: "",
    body: "",
    scheduledFor: "",
  });

  const refresh = useCallback(async (success?: string) => {
    const query = new URLSearchParams({ organisationId });
    try {
      const [communications, optionData, matterData] = await Promise.all([
        communicationsRequest(
          `/api/communications?${query.toString()}`,
          communicationsDashboardSchema,
        ),
        communicationsRequest(
          `/api/case-management?${new URLSearchParams({
            organisationId,
            resource: "options",
            page: "1",
            limit: "100",
          }).toString()}`,
          caseManagementOptionsSchema,
        ),
        communicationsRequest(
          `/api/case-management?${new URLSearchParams({
            organisationId,
            resource: "matters",
            page: "1",
            limit: "100",
          }).toString()}`,
          matterListSchema,
        ),
      ]);
      setError(null);
      setDashboard(communications);
      setOptions(optionData);
      setMatters(matterData.items);
      if (success) setNotice(success);
    } catch (refreshError) {
      setError(message(refreshError));
    } finally {
      setLoading(false);
    }
  }, [organisationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selectedConversation = dashboard?.conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );

  const inviteMatters = useMemo(
    () => matters.filter((matter) => !invite.clientId || matter.primaryClientId === invite.clientId),
    [invite.clientId, matters],
  );

  async function mutate(input: Record<string, unknown>, success: string) {
    setError(null);
    setNotice(null);
    setBusy(String(input.operation ?? "mutation"));
    try {
      const result = await communicationsRequest(
        "/api/communications/mutations",
        genericMutationResultSchema,
        { method: "POST", body: JSON.stringify(input) },
      );
      await refresh(success);
      return result;
    } catch (mutationError) {
      setError(message(mutationError));
      throw mutationError;
    } finally {
      setBusy(null);
    }
  }

  async function submitCompose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await mutate(
        {
          operation: "conversation.create",
          organisationId,
          payload: {
            clientId: compose.clientId || undefined,
            matterId: compose.matterId || undefined,
            channel: compose.channel,
            subject: compose.subject,
          },
        },
        "Conversation created.",
      );
      if (typeof created.id !== "string") throw new Error("The conversation response was invalid.");
      await mutate(
        {
          operation: "message.send",
          organisationId,
          conversationId: created.id,
          payload: {
            subject: compose.subject,
            bodyText: compose.body,
            recipientAddresses: compose.channel === "EMAIL" ? [compose.recipient] : [],
            idempotencyKey: idempotency("staff-message"),
          },
        },
        compose.channel === "EMAIL"
          ? "Message queued for delivery."
          : "Portal message delivered.",
      );
      setCompose({ clientId: "", matterId: "", channel: "PORTAL", recipient: "", subject: "", body: "" });
    } catch {
      // Error is already displayed.
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversation) return;
    try {
      await mutate(
        {
          operation: "message.send",
          organisationId,
          conversationId: selectedConversation.id,
          payload: {
            subject: selectedConversation.subject,
            bodyText: reply,
            recipientAddresses:
              selectedConversation.channel === "EMAIL"
                ? selectedConversation.messages.at(-1)?.recipientAddresses ?? []
                : [],
            idempotencyKey: idempotency("staff-reply"),
          },
        },
        "Reply recorded and queued when delivery is required.",
      );
      setReply("");
    } catch {
      // Error is already displayed.
    }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate(
        {
          operation: "invitation.create",
          organisationId,
          payload: {
            clientId: invite.clientId,
            matterIds: [invite.matterId],
            email: invite.email,
            scopes: ["MATTER_PROGRESS", "DOCUMENTS", "MESSAGES", "NOTIFICATIONS"],
          },
        },
        "Client portal invitation delivered.",
      );
      setInvite({ clientId: "", matterId: "", email: "" });
    } catch {
      // Error is already displayed.
    }
  }

  async function submitProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate(
        {
          operation: "portal-update.publish",
          organisationId,
          payload: {
            matterId: progress.matterId,
            title: progress.title,
            summary: progress.summary,
            stageKey: progress.stageKey || null,
            progressPercent: progress.progressPercent
              ? Number(progress.progressPercent)
              : undefined,
          },
        },
        "Client-visible progress update published.",
      );
      setProgress({ matterId: "", title: "", summary: "", stageKey: "", progressPercent: "" });
    } catch {
      // Error is already displayed.
    }
  }

  async function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate(
        {
          operation: "template.create",
          organisationId,
          payload: {
            key: template.key,
            name: template.name,
            channel: template.channel,
            subjectTemplate: template.subject || null,
            bodyTemplate: template.body,
            allowedVariables: [],
            status: "ACTIVE",
          },
        },
        "Communication template created.",
      );
      setTemplate({ key: "", name: "", channel: "EMAIL", subject: "", body: "" });
    } catch {
      // Error is already displayed.
    }
  }

  async function submitReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const conversation = dashboard?.conversations.find(
      (item) => item.id === reminder.conversationId,
    );
    if (!conversation) return;
    try {
      await mutate(
        {
          operation: "reminder.schedule",
          organisationId,
          payload: {
            conversationId: conversation.id,
            channel: conversation.channel,
            recipientAddress: conversation.channel === "PORTAL" ? null : reminder.recipient,
            subject: reminder.subject || null,
            bodyText: reminder.body,
            scheduledFor: new Date(reminder.scheduledFor).toISOString(),
            idempotencyKey: idempotency("reminder"),
          },
        },
        "Reminder scheduled.",
      );
      setReminder({ conversationId: "", recipient: "", subject: "", body: "", scheduledFor: "" });
    } catch {
      // Error is already displayed.
    }
  }

  async function reasonAction(
    operation: "invitation.revoke" | "access.revoke" | "reminder.cancel",
    identifier: string,
  ) {
    const reason = window.prompt("Record the reason for this action:");
    if (!reason?.trim()) return;
    const idField =
      operation === "invitation.revoke"
        ? { invitationId: identifier }
        : operation === "access.revoke"
          ? { accessGrantId: identifier }
          : { reminderId: identifier };
    try {
      await mutate(
        { operation, organisationId, ...idField, payload: { reason } },
        "The record was revoked or cancelled successfully.",
      );
    } catch {
      // Error is already displayed.
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">Client working loop</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Communications</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Secure portal conversations, controlled email delivery, client access and reminders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy !== null}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </header>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}

      <nav aria-label="Communications sections" className="flex gap-2 overflow-x-auto">
        {(["inbox", "portal", "templates", "reminders"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setView(item)}
            className={view === item ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold capitalize text-white" : "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold capitalize text-slate-700"}
          >
            {item}
          </button>
        ))}
      </nav>

      {loading || !dashboard ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Loading secure communications…</p>
      ) : null}

      {!loading && dashboard && view === "inbox" ? (
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /><h2 className="font-semibold">Conversations</h2></div>
            {dashboard.conversations.length === 0 ? <p className="text-sm text-slate-600">No conversations yet.</p> : dashboard.conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => setSelectedConversationId(conversation.id)}
                className={selectedConversationId === conversation.id ? "w-full rounded-xl border border-slate-950 bg-slate-50 p-4 text-left" : "w-full rounded-xl border border-slate-200 p-4 text-left hover:bg-slate-50"}
              >
                <div className="flex items-start justify-between gap-3"><p className="font-semibold">{conversation.subject}</p><Badge>{conversation.channel}</Badge></div>
                <p className="mt-1 text-sm text-slate-600">{conversation.clientName ?? conversation.matterTitle ?? "Linked record"}</p>
                <p className="mt-2 text-xs text-slate-500">{formatDateTime(conversation.lastMessageAt ?? conversation.createdAt)}</p>
              </button>
            ))}
          </section>

          <div className="space-y-6">
            {canSend ? (
              <form onSubmit={submitCompose} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2"><Mail className="h-5 w-5" /><h2 className="font-semibold">Start a conversation</h2></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium">Client<select required value={compose.clientId} onChange={(event) => setCompose({ ...compose, clientId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">Select client</option>{options.clients.map((client) => <option key={client.id} value={client.id}>{client.label} · {client.clientNumber}</option>)}</select></label>
                  <label className="text-sm font-medium">Matter<select required={compose.channel === "PORTAL"} value={compose.matterId} onChange={(event) => setCompose({ ...compose, matterId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">{compose.channel === "PORTAL" ? "Select matter" : "Client-level conversation"}</option>{matters.filter((matter) => !compose.clientId || matter.primaryClientId === compose.clientId).map((matter) => <option key={matter.id} value={matter.id}>{matter.matterNumber} · {matter.title}</option>)}</select></label>
                  <label className="text-sm font-medium">Channel<select value={compose.channel} onChange={(event) => setCompose({ ...compose, channel: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="PORTAL">Secure portal</option><option value="EMAIL">Email</option></select></label>
                  {compose.channel === "EMAIL" ? <label className="text-sm font-medium">Recipient email<input required type="email" value={compose.recipient} onChange={(event) => setCompose({ ...compose, recipient: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label> : null}
                </div>
                <label className="block text-sm font-medium">Subject<input required maxLength={240} value={compose.subject} onChange={(event) => setCompose({ ...compose, subject: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label>
                <label className="block text-sm font-medium">Message<textarea required maxLength={50000} rows={5} value={compose.body} onChange={(event) => setCompose({ ...compose, body: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 p-3" /></label>
                <button disabled={busy !== null} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" /> Send securely</button>
              </form>
            ) : null}

            {selectedConversation ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="font-semibold">{selectedConversation.subject}</h2>
                <div className="mt-4 max-h-96 space-y-3 overflow-y-auto">
                  {selectedConversation.messages.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex justify-between gap-3"><Badge>{item.actorType}</Badge><span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.bodyText}</p><p className="mt-2 text-xs text-slate-500">{item.status}</p></article>)}
                </div>
                {canSend ? <form onSubmit={submitReply} className="mt-4 flex gap-3"><label className="sr-only" htmlFor="communication-reply">Reply</label><textarea id="communication-reply" required rows={2} value={reply} onChange={(event) => setReply(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3" /><button disabled={busy !== null} className="rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Reply</button></form> : null}
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {!loading && dashboard && view === "portal" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {canManagePortal ? <form onSubmit={submitInvite} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><UserRoundCheck className="h-5 w-5" /><h2 className="font-semibold">Invite a client</h2></div><label className="block text-sm font-medium">Client<select required value={invite.clientId} onChange={(event) => setInvite({ clientId: event.target.value, matterId: "", email: invite.email })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">Select client</option>{options.clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}</select></label><label className="block text-sm font-medium">Matter<select required value={invite.matterId} onChange={(event) => setInvite({ ...invite, matterId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">Select authorised matter</option>{inviteMatters.map((matter) => <option key={matter.id} value={matter.id}>{matter.matterNumber} · {matter.title}</option>)}</select></label><label className="block text-sm font-medium">Verified client email<input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><p className="text-xs leading-5 text-slate-500">The account must sign in with this exact verified email. Access is limited to the selected matter.</p><button disabled={busy !== null} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> Send secure invitation</button></form> : null}

          {canPublishUpdates ? <form onSubmit={submitProgress} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /><h2 className="font-semibold">Publish case progress</h2></div><label className="block text-sm font-medium">Matter<select required value={progress.matterId} onChange={(event) => setProgress({ ...progress, matterId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">Select matter</option>{matters.map((matter) => <option key={matter.id} value={matter.id}>{matter.matterNumber} · {matter.title}</option>)}</select></label><label className="block text-sm font-medium">Update title<input required value={progress.title} onChange={(event) => setProgress({ ...progress, title: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="block text-sm font-medium">Client-safe summary<textarea required rows={4} value={progress.summary} onChange={(event) => setProgress({ ...progress, summary: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 p-3" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Stage key<input value={progress.stageKey} onChange={(event) => setProgress({ ...progress, stageKey: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="text-sm font-medium">Progress %<input type="number" min="0" max="100" value={progress.progressPercent} onChange={(event) => setProgress({ ...progress, progressPercent: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label></div><button disabled={busy !== null} className="h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Publish to portal</button></form> : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Pending invitations</h2><div className="mt-4 space-y-3">{dashboard.invitations.length === 0 ? <p className="text-sm text-slate-600">No invitations.</p> : dashboard.invitations.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.clientName}</p><p className="text-sm text-slate-600">{item.email}</p></div><Badge>{item.status}</Badge></div><p className="mt-2 text-xs text-slate-500">Expires {formatDateTime(item.expiresAt)}</p>{canManagePortal && item.status === "PENDING" ? <button type="button" onClick={() => void reasonAction("invitation.revoke", item.id)} className="mt-3 text-sm font-semibold text-red-700">Revoke invitation</button> : null}</article>)}</div></section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Active portal access</h2><div className="mt-4 space-y-3">{dashboard.accessGrants.length === 0 ? <p className="text-sm text-slate-600">No access grants.</p> : dashboard.accessGrants.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.clientName}</p><p className="text-sm text-slate-600">{item.email}</p></div><Badge>{item.status}</Badge></div><p className="mt-2 text-xs text-slate-500">{item.matters.map((matter) => matter.matterNumber).join(", ") || "No matter grants"}</p>{canManagePortal && item.status === "ACTIVE" ? <button type="button" onClick={() => void reasonAction("access.revoke", item.id)} className="mt-3 text-sm font-semibold text-red-700">Revoke access</button> : null}</article>)}</div></section>
        </div>
      ) : null}

      {!loading && dashboard && view === "templates" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {canManageTemplates ? <form onSubmit={submitTemplate} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Create an approved template</h2><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Key<input required pattern="[a-z][a-z0-9._-]*" value={template.key} onChange={(event) => setTemplate({ ...template, key: event.target.value.toLowerCase() })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="text-sm font-medium">Name<input required value={template.name} onChange={(event) => setTemplate({ ...template, name: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label></div><label className="block text-sm font-medium">Channel<select value={template.channel} onChange={(event) => setTemplate({ ...template, channel: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="EMAIL">Email</option><option value="PORTAL">Portal</option></select></label><label className="block text-sm font-medium">Subject<input value={template.subject} onChange={(event) => setTemplate({ ...template, subject: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="block text-sm font-medium">Body<textarea required rows={7} value={template.body} onChange={(event) => setTemplate({ ...template, body: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 p-3" /></label><button disabled={busy !== null} className="h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Create active template</button></form> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Template library</h2><div className="mt-4 space-y-3">{dashboard.templates.length === 0 ? <p className="text-sm text-slate-600">No templates yet.</p> : dashboard.templates.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><p className="font-semibold">{item.name}</p><Badge>{item.status}</Badge></div><p className="mt-1 text-xs text-slate-500">{item.channel} · {item.key}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.bodyTemplate}</p></article>)}</div></section>
        </div>
      ) : null}

      {!loading && dashboard && view === "reminders" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {canManageReminders ? <form onSubmit={submitReminder} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><BellRing className="h-5 w-5" /><h2 className="font-semibold">Schedule a reminder</h2></div><label className="block text-sm font-medium">Conversation<select required value={reminder.conversationId} onChange={(event) => setReminder({ ...reminder, conversationId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3"><option value="">Select conversation</option>{dashboard.conversations.map((item) => <option key={item.id} value={item.id}>{item.channel} · {item.subject}</option>)}</select></label>{dashboard.conversations.find((item) => item.id === reminder.conversationId)?.channel !== "PORTAL" ? <label className="block text-sm font-medium">Recipient email<input required type="email" value={reminder.recipient} onChange={(event) => setReminder({ ...reminder, recipient: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label> : null}<label className="block text-sm font-medium">Subject<input value={reminder.subject} onChange={(event) => setReminder({ ...reminder, subject: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="block text-sm font-medium">Reminder message<textarea required rows={5} value={reminder.body} onChange={(event) => setReminder({ ...reminder, body: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-300 p-3" /></label><label className="block text-sm font-medium">Send at<input required type="datetime-local" value={reminder.scheduledFor} onChange={(event) => setReminder({ ...reminder, scheduledFor: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3" /></label><button disabled={busy !== null} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Clock3 className="h-4 w-4" /> Schedule reminder</button></form> : null}
          <div className="space-y-6"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Reminder delivery log</h2><div className="mt-4 space-y-3">{dashboard.reminders.length === 0 ? <p className="text-sm text-slate-600">No reminders.</p> : dashboard.reminders.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-3"><p className="font-semibold">{item.subject ?? "Reminder"}</p><Badge>{item.status}</Badge></div><p className="mt-2 text-sm text-slate-600">{item.bodyText}</p><p className="mt-2 text-xs text-slate-500">{formatDateTime(item.scheduledFor)} · {item.channel}</p>{canManageReminders && item.status === "SCHEDULED" ? <button type="button" onClick={() => void reasonAction("reminder.cancel", item.id)} className="mt-3 text-sm font-semibold text-red-700">Cancel reminder</button> : null}</article>)}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Provider evidence</h2><div className="mt-4 space-y-3">{dashboard.deliveryEvents.length === 0 ? <p className="text-sm text-slate-600">No delivery evidence is visible for your role.</p> : dashboard.deliveryEvents.map((item) => <article key={item.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4"><div><p className="font-medium">{item.subject}</p><p className="mt-1 text-xs text-slate-500">{item.provider ?? "internal"} · {formatDateTime(item.occurredAt)}</p></div><Badge>{item.eventType}</Badge></article>)}</div></section></div>
        </div>
      ) : null}
    </div>
  );
}
