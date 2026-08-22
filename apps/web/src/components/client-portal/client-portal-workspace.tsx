"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Download,
  FileUp,
  FolderLock,
  LogOut,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { portalLogout } from "@/app/portal/actions";
import {
  clientPortalRequest,
  downloadPortalDocument,
  sha256Hex,
  uploadPortalDocument,
} from "@/components/client-portal/client-portal-client";
import {
  clientPortalDashboardSchema,
  portalMessageResultSchema,
  portalNotificationReadSchema,
  portalUploadFinalisationSchema,
  portalUploadRegistrationSchema,
  type ClientPortalDashboard,
} from "@/lib/client-portal";

type View = "progress" | "messages" | "documents";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The secure client portal request could not be completed.";
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

export function ClientPortalWorkspace() {
  const [view, setView] = useState<View>("progress");
  const [dashboard, setDashboard] = useState<ClientPortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [reply, setReply] = useState("");

  const refresh = useCallback(async (success?: string) => {
    try {
      const result = await clientPortalRequest(
        "/api/client-portal",
        clientPortalDashboardSchema,
      );
      setError(null);
      setDashboard(result);
      if (success) setNotice(success);
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId) return;
    setBusy("message");
    setError(null);
    try {
      await clientPortalRequest(
        "/api/client-portal/mutations",
        portalMessageResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "message.post",
            conversationId,
            payload: {
              bodyText: reply,
              idempotencyKey: `client-message/${crypto.randomUUID()}`,
            },
          }),
        },
      );
      setReply("");
      await refresh("Your secure message was sent to the case team.");
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setBusy(null);
    }
  }

  async function markRead(notificationId: string) {
    setBusy(`notification:${notificationId}`);
    try {
      await clientPortalRequest(
        "/api/client-portal/mutations",
        portalNotificationReadSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "notification.read",
            notificationId,
            payload: {},
          }),
        },
      );
      await refresh();
    } catch (readError) {
      setError(errorMessage(readError));
    } finally {
      setBusy(null);
    }
  }

  async function uploadDocument(requestItemId: string, file: File) {
    const allowedTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    if (!allowedTypes.has(file.type.toLowerCase()) || file.size > 52_428_800) {
      setError("Select a PDF, JPEG, PNG or DOCX file no larger than 50 MB.");
      return;
    }

    setBusy(`upload:${requestItemId}`);
    setError(null);
    setNotice(null);
    try {
      const hash = await sha256Hex(file);
      const registration = await clientPortalRequest(
        "/api/client-portal/mutations",
        portalUploadRegistrationSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "document.register",
            payload: {
              requestItemId,
              originalFileName: file.name,
              contentType: file.type.toLowerCase(),
              sizeBytes: file.size,
              sha256Hex: hash,
            },
          }),
        },
      );

      await uploadPortalDocument({
        bucket: registration.storageBucket,
        path: registration.storagePath,
        file,
      });

      await clientPortalRequest(
        "/api/client-portal/mutations",
        portalUploadFinalisationSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "document.finalise",
            payload: {
              documentId: registration.documentId,
              versionId: registration.versionId,
            },
          }),
        },
      );
      await refresh(
        "Your file was uploaded to quarantine and is awaiting malware scanning.",
      );
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setBusy(null);
    }
  }

  const organisationName = dashboard?.accessGrants[0]?.organisationName ?? "BusinessOS";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><FolderLock className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="font-semibold">Secure client portal</p><p className="truncate text-xs text-slate-500">{organisationName}</p></div>
          </div>
          <form action={portalLogout}><button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold"><LogOut className="h-4 w-4" /> Sign out</button></form>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-semibold text-blue-700">Verified access</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Your cases</h1><p className="mt-2 text-sm text-slate-600">View authorised progress, exchange messages and upload requested evidence.</p></div>
          <button type="button" onClick={() => void refresh()} disabled={loading || busy !== null} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>

        {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}

        {loading ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Loading your secure portal…</p> : null}
        {!loading && dashboard && dashboard.accessGrants.length === 0 ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold text-amber-950">No active client access</h2><p className="mt-2 text-sm leading-6 text-amber-900">Use the invitation link sent by your case team, and sign in with the exact verified email address to activate access.</p></section> : null}

        {dashboard && dashboard.accessGrants.length > 0 ? (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-5"><ShieldCheck className="h-5 w-5 text-emerald-700" /><p className="mt-3 text-2xl font-bold">{dashboard.matters.length}</p><p className="text-sm text-slate-600">authorised matters</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5"><Bell className="h-5 w-5 text-blue-700" /><p className="mt-3 text-2xl font-bold">{dashboard.notifications.filter((item) => !item.readAt).length}</p><p className="text-sm text-slate-600">unread notices</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5"><MessageSquareText className="h-5 w-5 text-violet-700" /><p className="mt-3 text-2xl font-bold">{dashboard.conversations.length}</p><p className="text-sm text-slate-600">secure conversations</p></div>
            </section>

            <nav className="flex gap-2 overflow-x-auto" aria-label="Portal sections">
              {(["progress", "messages", "documents"] as const).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={view === item ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold capitalize text-white" : "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold capitalize"}>{item}</button>)}
            </nav>

            {view === "progress" ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><section className="space-y-4"><h2 className="text-xl font-semibold">Case progress</h2>{dashboard.matters.map((matter) => <article key={matter.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{matter.matterNumber}</p><h3 className="mt-1 font-semibold">{matter.title}</h3></div><span className="h-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">{statusLabel(matter.status)}</span></div><p className="mt-3 text-sm text-slate-600">{matter.serviceType}</p><div className="mt-4 space-y-3">{dashboard.updates.filter((update) => update.matterId === matter.id).map((update) => <div key={update.id} className="border-l-2 border-slate-300 pl-4"><div className="flex justify-between gap-3"><p className="font-medium">{update.title}</p><span className="text-xs text-slate-500">{formatDateTime(update.publishedAt)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{update.summary}</p>{update.progressPercent !== null ? <div className="mt-3"><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${update.progressPercent}%` }} /></div><p className="mt-1 text-xs text-slate-500">{update.progressPercent}%</p></div> : null}</div>)}</div></article>)}</section><aside className="space-y-3"><h2 className="text-xl font-semibold">Notifications</h2>{dashboard.notifications.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">No notifications.</p> : dashboard.notifications.map((notification) => <article key={notification.id} className={notification.readAt ? "rounded-xl border border-slate-200 bg-white p-4 opacity-70" : "rounded-xl border border-blue-200 bg-blue-50 p-4"}><div className="flex justify-between gap-3"><p className="font-semibold">{notification.title}</p>{!notification.readAt ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" /> : null}</div><p className="mt-2 text-sm leading-6 text-slate-600">{notification.body}</p><p className="mt-2 text-xs text-slate-500">{formatDateTime(notification.createdAt)}</p>{!notification.readAt ? <button type="button" disabled={busy !== null} onClick={() => void markRead(notification.id)} className="mt-3 text-sm font-semibold text-blue-800">Mark as read</button> : null}</article>)}</aside></div> : null}

            {view === "messages" ? <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]"><section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Conversations</h2>{dashboard.conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => setConversationId(conversation.id)} className={conversationId === conversation.id ? "w-full rounded-xl border border-slate-950 bg-slate-50 p-4 text-left" : "w-full rounded-xl border border-slate-200 p-4 text-left"}><p className="font-semibold">{conversation.subject}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(conversation.lastMessageAt)}</p></button>)}</section><section className="rounded-2xl border border-slate-200 bg-white p-5">{conversationId ? <>{dashboard.conversations.find((item) => item.id === conversationId)?.messages.map((item) => <article key={item.id} className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex justify-between gap-3"><span className="text-xs font-semibold text-slate-600">{statusLabel(item.actorType)}</span><span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.bodyText}</p></article>)}<form onSubmit={sendMessage} className="mt-4 flex gap-3"><label htmlFor="portal-message" className="sr-only">Message</label><textarea id="portal-message" required maxLength={10000} rows={3} value={reply} onChange={(event) => setReply(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3" /><button disabled={busy !== null} className="rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Send</button></form></> : <p className="text-sm text-slate-600">Select a conversation to view and reply.</p>}</section></div> : null}

            {view === "documents" ? <div className="space-y-6"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Requested documents</h2><div className="mt-4 space-y-4">{dashboard.documentRequests.length === 0 ? <p className="text-sm text-slate-600">No active document requests.</p> : dashboard.documentRequests.map((request) => <article key={request.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{request.title}</h3>{request.message ? <p className="mt-1 text-sm text-slate-600">{request.message}</p> : null}</div><span className="text-xs font-semibold text-slate-600">Due {formatDateTime(request.dueAt)}</span></div><div className="mt-4 space-y-3">{request.items.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{item.title}{item.isRequired ? " *" : ""}</p><p className="text-xs text-slate-500">{statusLabel(item.status)}</p></div>{["REQUESTED", "REJECTED"].includes(item.status) ? <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"><FileUp className="h-4 w-4" /> Upload<input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.docx" disabled={busy !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(item.id, file); event.currentTarget.value = ""; }} /></label> : <CheckCircle2 className="h-5 w-5 text-emerald-700" />}</div>)}</div></article>)}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Available documents</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{dashboard.documents.length === 0 ? <p className="text-sm text-slate-600">No clean client-visible documents are available.</p> : dashboard.documents.map((document) => <article key={document.id} className="rounded-xl border border-slate-200 p-4"><p className="font-semibold">{document.title}</p><p className="mt-1 truncate text-sm text-slate-600">{document.fileName}</p><button type="button" onClick={() => void downloadPortalDocument({ bucket: document.storageBucket, path: document.storagePath, fileName: document.fileName }).catch((downloadError) => setError(errorMessage(downloadError)))} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-800"><Download className="h-4 w-4" /> Download securely</button></article>)}</div></section></div> : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
