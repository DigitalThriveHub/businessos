"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Link2,
  Mail,
  MessageSquareText,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  X,
  type LucideIcon,
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
  canManageCommunications: boolean;
  canManageIntegrations: boolean;
  canManagePortal: boolean;
  canPublishUpdates: boolean;
  canManageTemplates: boolean;
  canManageReminders: boolean;
};

type View = "inbox" | "calendar" | "connections" | "tools";

const EMPTY_OPTIONS: CaseManagementOptions = {
  departments: [],
  teams: [],
  members: [],
  clients: [],
  convertibleEnquiries: [],
};

const field =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100";
const area = `${field} h-auto min-h-24 py-2`;
const primary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300";
const secondary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400";

function readable(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function idempotency(prefix: string): string {
  return `${prefix}/${crypto.randomUUID()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The operation could not be completed safely.";
}

function Status({ value }: { value: string }) {
  const problem = ["FAILED", "DEGRADED", "SYNC_FAILED"].some((item) =>
    value.includes(item),
  );
  const ready = ["READY", "SCHEDULED", "DELIVERED", "SENT"].some((item) =>
    value.includes(item),
  );
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        problem
          ? "bg-rose-100 text-rose-800"
          : ready
            ? "bg-emerald-100 text-emerald-800"
            : "bg-amber-100 text-amber-800"
      }`}
    >
      {readable(value)}
    </span>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "WHATSAPP")
    return <Smartphone aria-hidden className="h-4 w-4" />;
  if (channel === "EMAIL") return <Mail aria-hidden className="h-4 w-4" />;
  return <ShieldCheck aria-hidden className="h-4 w-4" />;
}

export function GateLWorkspace(props: Props) {
  const [view, setView] = useState<View>("inbox");
  const [dashboard, setDashboard] = useState<CommunicationsDashboard | null>(
    null,
  );
  const [options, setOptions] = useState<CaseManagementOptions>(EMPTY_OPTIONS);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [reply, setReply] = useState({ recipient: "", body: "" });

  const [compose, setCompose] = useState({
    channel: "EMAIL",
    connectionId: "",
    clientId: "",
    matterId: "",
    recipient: "",
    subject: "",
    body: "",
  });
  const [booking, setBooking] = useState({
    connectionId: "",
    clientId: "",
    matterId: "",
    title: "",
    startsAt: "",
    endsAt: "",
    attendee: "",
    location: "",
    reminder: "60",
  });
  const [provider, setProvider] = useState({
    connectionId: "",
    expectedVersion: 0,
    provider: "MICROSOFT_365",
    displayName: "",
    secretReference: "",
    mailboxAddress: "",
    phoneNumber: "",
    email: true,
    calendar: true,
  });
  const [match, setMatch] = useState({ clientId: "", matterId: "" });
  const [invite, setInvite] = useState({
    clientId: "",
    matterId: "",
    email: "",
  });
  const [progress, setProgress] = useState({
    matterId: "",
    title: "",
    summary: "",
    percent: "",
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

  const refresh = useCallback(
    async (success?: string, preserveError = false) => {
      const query = new URLSearchParams({
        organisationId: props.organisationId,
      });
      try {
        const [communications, optionData, matterData] = await Promise.all([
          communicationsRequest(
            `/api/communications?${query.toString()}`,
            communicationsDashboardSchema,
          ),
          communicationsRequest(
            `/api/case-management?${new URLSearchParams({
              organisationId: props.organisationId,
              resource: "options",
              page: "1",
              limit: "100",
            }).toString()}`,
            caseManagementOptionsSchema,
          ),
          communicationsRequest(
            `/api/case-management?${new URLSearchParams({
              organisationId: props.organisationId,
              resource: "matters",
              page: "1",
              limit: "100",
            }).toString()}`,
            matterListSchema,
          ),
        ]);
        setDashboard(communications);
        setOptions(optionData);
        setMatters(matterData.items);
        if (!preserveError) setError(null);
        if (success) setNotice(success);
        setSelectedId((current) =>
          current &&
          communications.conversations.some((item) => item.id === current)
            ? current
            : (communications.conversations[0]?.id ?? ""),
        );
      } catch (refreshError) {
        setError(errorMessage(refreshError));
      } finally {
        setLoading(false);
      }
    },
    [props.organisationId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selected = dashboard?.conversations.find(
    (item) => item.id === selectedId,
  );
  const defaultReplyRecipient = [...(selected?.messages ?? [])]
    .reverse()
    .find(
      (message) => message.direction === "INBOUND" && message.senderAddress,
    )?.senderAddress;
  const replyRecipient = reply.recipient || defaultReplyRecipient || "";

  const conversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return dashboard?.conversations ?? [];
    return (dashboard?.conversations ?? []).filter((conversation) =>
      [
        conversation.subject,
        conversation.clientName,
        conversation.matterNumber,
        conversation.channel,
      ].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [dashboard?.conversations, search]);

  const activeConnections = dashboard?.liveOperations.providerConnections ?? [];
  const operationalConnections = activeConnections.filter(
    (connection) =>
      connection.connectionStatus === "ACTIVE" &&
      (connection.state === "READY" || connection.state === "DEGRADED"),
  );
  const composeConnections = operationalConnections.filter((connection) =>
    connection.capabilities.includes(
      compose.channel === "WHATSAPP" ? "WHATSAPP" : "EMAIL",
    ),
  );
  const calendarConnections = operationalConnections.filter((connection) =>
    connection.capabilities.includes("CALENDAR"),
  );
  const metrics: Array<{
    label: string;
    value: number;
    icon: LucideIcon;
  }> = [
    {
      label: "Open conversations",
      value: dashboard?.conversations.length ?? 0,
      icon: MessageSquareText,
    },
    {
      label: "Unmatched",
      value: dashboard?.matchQueue.length ?? 0,
      icon: Link2,
    },
    {
      label: "Live connections",
      value: dashboard?.liveOperations.readiness.readyConnections ?? 0,
      icon: PlugZap,
    },
    {
      label: "Sync failures",
      value:
        (dashboard?.liveOperations.readiness.degradedConnections ?? 0) +
        (dashboard?.liveOperations.readiness.failedCalendarEvents ?? 0),
      icon: CircleAlert,
    },
  ];
  const clientMatters = (clientId: string) =>
    matters.filter(
      (matter) => !clientId || matter.primaryClientId === clientId,
    );

  async function mutate(
    input: Record<string, unknown>,
    success: string,
    shouldRefresh = true,
  ) {
    setBusy(String(input.operation ?? "operation"));
    setError(null);
    setNotice(null);
    try {
      const result = await communicationsRequest(
        "/api/communications/mutations",
        genericMutationResultSchema,
        { method: "POST", body: JSON.stringify(input) },
      );
      if (shouldRefresh) await refresh(success);
      else setNotice(success);
      return result;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return null;
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
          organisationId: props.organisationId,
          payload: {
            channel: compose.channel,
            clientId: compose.clientId || undefined,
            matterId: compose.matterId || undefined,
            integrationConnectionId:
              compose.channel === "PORTAL"
                ? undefined
                : compose.connectionId || undefined,
            subject: compose.subject,
          },
        },
        "Conversation created.",
        false,
      );
      if (!created) return;
      if (typeof created.id !== "string")
        throw new Error("The conversation response was invalid.");
      const sent = await mutate(
        {
          operation: "message.send",
          organisationId: props.organisationId,
          conversationId: created.id,
          payload: {
            subject: compose.subject,
            bodyText: compose.body,
            recipientAddresses:
              compose.channel === "PORTAL" ? undefined : [compose.recipient],
            idempotencyKey: idempotency("gate-l-compose"),
          },
        },
        "Message queued safely.",
      );
      if (!sent) return;
      setCompose({
        channel: "EMAIL",
        connectionId: "",
        clientId: "",
        matterId: "",
        recipient: "",
        subject: "",
        body: "",
      });
      setShowCompose(false);
      setSelectedId(created.id);
    } catch (composeError) {
      setError(errorMessage(composeError));
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    try {
      const sent = await mutate(
        {
          operation: "message.send",
          organisationId: props.organisationId,
          conversationId: selected.id,
          payload: {
            subject: selected.subject,
            bodyText: reply.body,
            recipientAddresses:
              selected.channel === "PORTAL" ? undefined : [replyRecipient],
            idempotencyKey: idempotency("gate-l-reply"),
          },
        },
        "Reply queued safely.",
      );
      if (!sent) return;
      setReply((current) => ({ ...current, body: "" }));
    } catch (replyError) {
      setError(errorMessage(replyError));
    }
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await mutate(
        {
          operation: "calendar.create",
          organisationId: props.organisationId,
          payload: {
            integrationConnectionId: booking.connectionId,
            clientId: booking.clientId || undefined,
            matterId: booking.matterId || undefined,
            title: booking.title,
            startsAt: new Date(booking.startsAt).toISOString(),
            endsAt: new Date(booking.endsAt).toISOString(),
            timezone: "Europe/London",
            attendeeAddresses: [booking.attendee],
            location: booking.location || undefined,
            reminderMinutesBefore: Number(booking.reminder),
            idempotencyKey: idempotency("gate-l-calendar"),
          },
        },
        "Appointment created in BusinessOS and the live calendar.",
      );
      if (!created) {
        await refresh(undefined, true);
        return;
      }
      setBooking({
        connectionId: "",
        clientId: "",
        matterId: "",
        title: "",
        startsAt: "",
        endsAt: "",
        attendee: "",
        location: "",
        reminder: "60",
      });
    } catch (bookingError) {
      setError(errorMessage(bookingError));
      await refresh(undefined, true);
    }
  }

  async function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const isWhatsApp = provider.provider === "WHATSAPP_BUSINESS";
      const configured = await mutate(
        {
          operation: "provider.configure",
          organisationId: props.organisationId,
          payload: {
            connectionId: provider.connectionId || undefined,
            provider: provider.provider,
            displayName: provider.displayName,
            secretReference: provider.secretReference,
            mailboxAddress: isWhatsApp ? undefined : provider.mailboxAddress,
            phoneNumber: isWhatsApp ? provider.phoneNumber : undefined,
            capabilities: isWhatsApp
              ? ["WHATSAPP"]
              : [
                  ...(provider.email ? ["EMAIL"] : []),
                  ...(provider.calendar ? ["CALENDAR"] : []),
                ],
            expectedVersion: provider.expectedVersion,
          },
        },
        "Provider saved and live health checked.",
      );
      if (!configured) return;
      setProvider({
        connectionId: "",
        expectedVersion: 0,
        provider: "MICROSOFT_365",
        displayName: "",
        secretReference: "",
        mailboxAddress: "",
        phoneNumber: "",
        email: true,
        calendar: true,
      });
    } catch (providerError) {
      setError(errorMessage(providerError));
    }
  }

  function toggleProvider(
    connection: NonNullable<
      CommunicationsDashboard["liveOperations"]["providerConnections"][number]
    >,
  ) {
    const enabling = connection.connectionStatus !== "ACTIVE";
    if (
      !enabling &&
      !window.confirm(
        "Disable this provider? Queued work will remain recorded but no new provider operations will run until it is enabled again.",
      )
    ) {
      return;
    }
    void mutate(
      {
        operation: "provider.status",
        organisationId: props.organisationId,
        connectionId: connection.connectionId,
        payload: {
          status: enabling ? "ACTIVE" : "DISABLED",
          reason: enabling
            ? "Re-enabled by authorised integration manager."
            : "Disabled by authorised integration manager.",
          expectedVersion: connection.version,
        },
      },
      enabling
        ? "Provider enabled and health checked."
        : "Provider disabled safely.",
    );
  }

  if (loading && !dashboard) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-600">
        <RefreshCw aria-hidden className="mr-2 h-4 w-4 animate-spin" /> Loading
        live operations…
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="communications-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
            Gate L · live daily operations
          </p>
          <h1
            id="communications-title"
            className="text-2xl font-bold tracking-tight"
          >
            Communications & calendar
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            className={secondary}
            onClick={() => void refresh()}
            disabled={Boolean(busy)}
          >
            <RefreshCw
              aria-hidden
              className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
            />{" "}
            Refresh
          </button>
          {props.canSend && (
            <button className={primary} onClick={() => setShowCompose(true)}>
              <Plus aria-hidden className="h-4 w-4" /> New message
            </button>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <span className="flex gap-2">
            {error ? (
              <CircleAlert className="mt-0.5 h-4 w-4" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
            )}
            {error ?? notice}
          </span>
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              {label} <Icon aria-hidden className="h-4 w-4" />
            </div>
            <p className="mt-1 text-xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div
        className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"
        role="tablist"
      >
        {[
          ["inbox", "Inbox", MessageSquareText],
          ["calendar", "Calendar", CalendarDays],
          ["connections", "Connections", PlugZap],
          ["tools", "Client tools", Settings2],
        ].map(([key, label, Icon]) => (
          <button
            key={String(key)}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key as View)}
            className={`flex h-10 min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
              view === key
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Icon aria-hidden className="h-4 w-4" /> {String(label)}
          </button>
        ))}
      </div>

      {view === "inbox" && (
        <div className="grid min-h-[590px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[300px_minmax(0,1fr)_240px]">
          <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-200 p-3">
              <label className="relative block">
                <span className="sr-only">Search conversations</span>
                <Search
                  aria-hidden
                  className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                />
                <input
                  className={`${field} pl-9`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search inbox"
                />
              </label>
            </div>
            <div className="max-h-[530px] overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">
                  No matching conversations.
                </p>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => {
                      setSelectedId(conversation.id);
                      setReply({ recipient: "", body: "" });
                    }}
                    className={`w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${selectedId === conversation.id ? "bg-blue-50" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <ChannelIcon channel={conversation.channel} />{" "}
                        {conversation.clientName ?? "Unlinked"}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {formatDate(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold">
                      {conversation.subject}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {conversation.messages.at(-1)?.bodyText ?? "No messages"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex min-h-[590px] min-w-0 flex-col">
            {selected ? (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold">{selected.subject}</h2>
                    <p className="text-xs text-slate-500">
                      {selected.clientName ?? "Awaiting matching"} ·{" "}
                      {readable(selected.channel)}
                    </p>
                  </div>
                  <Status value={selected.status} />
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
                  {selected.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`max-w-[82%] rounded-xl border px-3 py-2 text-sm shadow-sm ${
                        message.direction === "OUTBOUND"
                          ? "ml-auto border-blue-200 bg-blue-600 text-white"
                          : "border-slate-200 bg-white text-slate-900"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {message.bodyText}
                      </p>
                      <div
                        className={`mt-2 flex items-center justify-between gap-4 text-[11px] ${message.direction === "OUTBOUND" ? "text-blue-100" : "text-slate-400"}`}
                      >
                        <span>{formatDate(message.createdAt)}</span>
                        <span>{readable(message.status)}</span>
                      </div>
                      {message.failureCode && (
                        <p className="mt-2 rounded bg-rose-100 px-2 py-1 text-xs text-rose-900">
                          {message.failureDetail ??
                            readable(message.failureCode)}
                        </p>
                      )}
                      {message.status === "DRAFT" && props.canSend && (
                        <button
                          className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-blue-700"
                          onClick={() =>
                            setReply({
                              recipient:
                                message.recipientAddresses?.[0] ??
                                replyRecipient,
                              body: message.bodyText,
                            })
                          }
                        >
                          Review and use approved AI draft
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {props.canSend && (
                  <form
                    onSubmit={submitReply}
                    className="space-y-2 border-t border-slate-200 p-3"
                  >
                    {selected.channel !== "PORTAL" && (
                      <input
                        className={field}
                        aria-label="Reply recipient"
                        value={replyRecipient}
                        onChange={(event) =>
                          setReply({ ...reply, recipient: event.target.value })
                        }
                        placeholder={
                          selected.channel === "WHATSAPP"
                            ? "+447700900000"
                            : "client@example.com"
                        }
                        required
                      />
                    )}
                    <div className="flex gap-2">
                      <textarea
                        className={`${area} min-h-20 flex-1 resize-none`}
                        aria-label="Reply message"
                        value={reply.body}
                        onChange={(event) =>
                          setReply({ ...reply, body: event.target.value })
                        }
                        placeholder="Write a clear reply…"
                        required
                      />
                      <button
                        className={`${primary} h-auto self-stretch`}
                        disabled={Boolean(busy)}
                      >
                        <Send aria-hidden className="h-4 w-4" />{" "}
                        <span className="sr-only sm:not-sr-only">Send</span>
                      </button>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <div className="m-auto text-center text-sm text-slate-500">
                Select a conversation.
              </div>
            )}
          </div>

          <aside className="border-t border-slate-200 p-4 text-sm lg:border-l lg:border-t-0">
            <h3 className="font-bold">Business context</h3>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-xs text-slate-500">Client</dt>
                <dd className="font-medium">
                  {selected?.clientName ?? "Unlinked"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Matter</dt>
                <dd className="font-medium">
                  {selected?.matterNumber ?? "Not linked"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Account</dt>
                <dd className="font-medium">
                  {selected?.connectionName ??
                    (selected?.channel === "EMAIL"
                      ? "Resend fallback"
                      : "BusinessOS portal")}
                </dd>
              </div>
            </dl>
            {(dashboard?.matchQueue.length ?? 0) > 0 && (
              <button
                className={`${secondary} mt-5 w-full`}
                onClick={() => setView("tools")}
              >
                Resolve {dashboard?.matchQueue.length} unmatched{" "}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </aside>
        </div>
      )}

      {view === "calendar" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-bold">Appointments</h2>
              <p className="text-xs text-slate-500">
                Provider-confirmed bookings, cancellations and no-shows.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {(dashboard?.liveOperations.calendarEvents ?? []).length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No appointments yet.
                </p>
              ) : (
                dashboard?.liveOperations.calendarEvents.map((event) => (
                  <article
                    key={event.id}
                    className="grid gap-3 p-4 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="rounded-lg bg-slate-100 p-3 text-center">
                      <p className="text-xs font-semibold text-slate-500">
                        {new Date(event.startsAt).toLocaleDateString("en-GB", {
                          weekday: "short",
                        })}
                      </p>
                      <p className="text-lg font-bold">
                        {new Date(event.startsAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </p>
                      <p className="text-xs">
                        {new Date(event.startsAt).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{event.title}</h3>
                        <Status value={event.status} />
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {event.clientName ?? event.attendeeAddresses.join(", ")}{" "}
                        · {event.connectionName}
                      </p>
                      {event.failureDetail && (
                        <p className="mt-1 text-xs text-rose-700">
                          {event.failureDetail}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {event.providerJoinUrl && (
                        <a
                          className={secondary}
                          href={event.providerJoinUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Join
                        </a>
                      )}
                      {props.canManageCommunications &&
                        event.status === "SCHEDULED" && (
                          <>
                            <button
                              className={secondary}
                              onClick={() =>
                                void mutate(
                                  {
                                    operation: "calendar.outcome",
                                    organisationId: props.organisationId,
                                    eventId: event.id,
                                    payload: {
                                      status: "COMPLETED",
                                      reason:
                                        "Marked completed by authorised staff.",
                                      expectedVersion: event.version,
                                    },
                                  },
                                  "Appointment marked completed.",
                                )
                              }
                            >
                              Complete
                            </button>
                            <button
                              className={secondary}
                              onClick={() =>
                                void mutate(
                                  {
                                    operation: "calendar.outcome",
                                    organisationId: props.organisationId,
                                    eventId: event.id,
                                    payload: {
                                      status: "NO_SHOW",
                                      reason:
                                        "Attendance reviewed and marked as no-show.",
                                      expectedVersion: event.version,
                                    },
                                  },
                                  "Appointment marked no-show.",
                                )
                              }
                            >
                              No-show
                            </button>
                          </>
                        )}
                      {props.canSend && event.status === "SCHEDULED" && (
                        <button
                          className="h-10 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() =>
                            void mutate(
                              {
                                operation: "calendar.cancel",
                                organisationId: props.organisationId,
                                eventId: event.id,
                                payload: {
                                  reason:
                                    "Cancelled by authorised staff following client contact.",
                                  expectedVersion: event.version,
                                },
                              },
                              "Appointment cancelled at the provider.",
                            )
                          }
                        >
                          Cancel
                        </button>
                      )}
                      {props.canSend && event.status === "SYNC_FAILED" && (
                        <button
                          className={primary}
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void mutate(
                              {
                                operation: "calendar.retry",
                                organisationId: props.organisationId,
                                eventId: event.id,
                                payload: { expectedVersion: event.version },
                              },
                              "Calendar provider retry completed.",
                            )
                          }
                        >
                          Retry safely
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
          <form
            onSubmit={submitBooking}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div>
              <h2 className="font-bold">Book appointment</h2>
              <p className="text-xs text-slate-500">
                Creates the live provider event before reporting success.
              </p>
            </div>
            <select
              className={field}
              value={booking.connectionId}
              onChange={(e) =>
                setBooking({ ...booking, connectionId: e.target.value })
              }
              required
            >
              <option value="">Calendar account</option>
              {calendarConnections.map((item) => (
                <option key={item.connectionId} value={item.connectionId}>
                  {item.displayName}
                </option>
              ))}
            </select>
            <select
              className={field}
              value={booking.clientId}
              onChange={(e) =>
                setBooking({
                  ...booking,
                  clientId: e.target.value,
                  matterId: "",
                })
              }
            >
              <option value="">Client (optional)</option>
              {options.clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className={field}
              value={booking.matterId}
              onChange={(e) =>
                setBooking({ ...booking, matterId: e.target.value })
              }
            >
              <option value="">Matter (optional)</option>
              {clientMatters(booking.clientId).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.matterNumber} · {item.title}
                </option>
              ))}
            </select>
            <input
              className={field}
              value={booking.title}
              onChange={(e) =>
                setBooking({ ...booking, title: e.target.value })
              }
              placeholder="Appointment title"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-slate-600">
                Starts
                <input
                  className={`${field} mt-1`}
                  type="datetime-local"
                  value={booking.startsAt}
                  onChange={(e) =>
                    setBooking({ ...booking, startsAt: e.target.value })
                  }
                  required
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Ends
                <input
                  className={`${field} mt-1`}
                  type="datetime-local"
                  value={booking.endsAt}
                  onChange={(e) =>
                    setBooking({ ...booking, endsAt: e.target.value })
                  }
                  required
                />
              </label>
            </div>
            <input
              className={field}
              type="email"
              value={booking.attendee}
              onChange={(e) =>
                setBooking({ ...booking, attendee: e.target.value })
              }
              placeholder="Attendee email"
              required
            />
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input
                className={field}
                value={booking.location}
                onChange={(e) =>
                  setBooking({ ...booking, location: e.target.value })
                }
                placeholder="Location or online"
              />
              <select
                className={field}
                value={booking.reminder}
                onChange={(e) =>
                  setBooking({ ...booking, reminder: e.target.value })
                }
              >
                <option value="15">15 min</option>
                <option value="60">1 hour</option>
                <option value="1440">1 day</option>
              </select>
            </div>
            <button
              className={`${primary} w-full`}
              disabled={!props.canSend || Boolean(busy)}
            >
              <CalendarDays className="h-4 w-4" /> Book live
            </button>
          </form>
        </div>
      )}

      {view === "connections" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {activeConnections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 sm:col-span-2">
                No live provider account is configured. Portal and existing
                non-AI BusinessOS work still operate normally.
              </div>
            ) : (
              activeConnections.map((connection) => (
                <article
                  key={connection.connectionId}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {readable(connection.provider)}
                      </p>
                      <h2 className="font-bold">{connection.displayName}</h2>
                    </div>
                    <Status value={connection.state} />
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    {connection.mailboxAddress ?? connection.phoneNumber}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {connection.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold"
                      >
                        {readable(capability)}
                      </span>
                    ))}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500">Last healthy</dt>
                      <dd className="font-semibold">
                        {formatDate(connection.lastHealthyAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Last sync</dt>
                      <dd className="font-semibold">
                        {formatDate(connection.lastSyncAt)}
                      </dd>
                    </div>
                  </dl>
                  {connection.lastErrorDetail && (
                    <p className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">
                      {connection.lastErrorDetail}
                    </p>
                  )}
                  {props.canManageIntegrations && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {connection.connectionStatus === "ACTIVE" && (
                        <button
                          className={secondary}
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void mutate(
                              {
                                operation: "provider.health",
                                organisationId: props.organisationId,
                                connectionId: connection.connectionId,
                                payload: {},
                              },
                              "Provider health checked.",
                            )
                          }
                        >
                          Test
                        </button>
                      )}
                      {connection.connectionStatus === "ACTIVE" &&
                        connection.capabilities.includes("EMAIL") && (
                          <button
                            className={secondary}
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void mutate(
                                {
                                  operation: "provider.sync",
                                  organisationId: props.organisationId,
                                  connectionId: connection.connectionId,
                                  payload: {},
                                },
                                "Mailbox synchronised.",
                              )
                            }
                          >
                            Sync now
                          </button>
                        )}
                      <button
                        className={secondary}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          setProvider({
                            connectionId: connection.connectionId,
                            expectedVersion: connection.version,
                            provider: connection.provider,
                            displayName: connection.displayName,
                            secretReference: "",
                            mailboxAddress: connection.mailboxAddress ?? "",
                            phoneNumber: connection.phoneNumber ?? "",
                            email: connection.capabilities.includes("EMAIL"),
                            calendar:
                              connection.capabilities.includes("CALENDAR"),
                          })
                        }
                      >
                        Reconnect
                      </button>
                      <button
                        className={
                          connection.connectionStatus === "ACTIVE"
                            ? "h-10 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                            : primary
                        }
                        disabled={Boolean(busy)}
                        onClick={() => toggleProvider(connection)}
                      >
                        {connection.connectionStatus === "ACTIVE"
                          ? "Disable"
                          : "Enable"}
                      </button>
                    </div>
                  )}
                  <p className="mt-3 break-all text-[11px] text-slate-400">
                    Webhook ID: {connection.webhookPublicId}
                  </p>
                </article>
              ))
            )}
          </div>
          <form
            onSubmit={submitProvider}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div>
              <h2 className="font-bold">
                {provider.connectionId
                  ? "Reconnect account"
                  : "Connect a real account"}
              </h2>
              <p className="text-xs text-slate-500">
                The form stores only a secret-manager reference. Credentials
                stay server-side.
              </p>
            </div>
            <select
              className={field}
              value={provider.provider}
              disabled={Boolean(provider.connectionId)}
              onChange={(e) =>
                setProvider({ ...provider, provider: e.target.value })
              }
            >
              <option value="MICROSOFT_365">Microsoft 365</option>
              <option value="GOOGLE_WORKSPACE">Google Workspace</option>
              <option value="WHATSAPP_BUSINESS">WhatsApp Business Cloud</option>
            </select>
            <input
              className={field}
              value={provider.displayName}
              onChange={(e) =>
                setProvider({ ...provider, displayName: e.target.value })
              }
              placeholder="Account display name"
              required
            />
            <input
              className={field}
              value={provider.secretReference}
              onChange={(e) =>
                setProvider({ ...provider, secretReference: e.target.value })
              }
              placeholder="Server secret reference, e.g. legal-main"
              required
            />
            {provider.provider === "WHATSAPP_BUSINESS" ? (
              <input
                className={field}
                value={provider.phoneNumber}
                onChange={(e) =>
                  setProvider({ ...provider, phoneNumber: e.target.value })
                }
                placeholder="+442012345678"
                required
              />
            ) : (
              <input
                className={field}
                type="email"
                value={provider.mailboxAddress}
                onChange={(e) =>
                  setProvider({ ...provider, mailboxAddress: e.target.value })
                }
                placeholder="shared@business.co.uk"
                required
              />
            )}
            {provider.provider !== "WHATSAPP_BUSINESS" && (
              <div className="flex gap-4 rounded-lg bg-slate-50 p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={provider.email}
                    onChange={(e) =>
                      setProvider({ ...provider, email: e.target.checked })
                    }
                  />{" "}
                  Email
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={provider.calendar}
                    onChange={(e) =>
                      setProvider({ ...provider, calendar: e.target.checked })
                    }
                  />{" "}
                  Calendar
                </label>
              </div>
            )}
            <button
              className={`${primary} w-full`}
              disabled={!props.canManageIntegrations || Boolean(busy)}
            >
              <PlugZap className="h-4 w-4" /> Save & health check
            </button>
            {provider.connectionId && (
              <button
                type="button"
                className={`${secondary} w-full`}
                onClick={() =>
                  setProvider({
                    connectionId: "",
                    expectedVersion: 0,
                    provider: "MICROSOFT_365",
                    displayName: "",
                    secretReference: "",
                    mailboxAddress: "",
                    phoneNumber: "",
                    email: true,
                    calendar: true,
                  })
                }
              >
                Cancel reconnect
              </button>
            )}
            {!props.canManageIntegrations && (
              <p className="text-xs text-amber-700">
                Integration management permission is required.
              </p>
            )}
          </form>
        </div>
      )}

      {view === "tools" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Tool
            title={`Unmatched communications (${dashboard?.matchQueue.length ?? 0})`}
            description="Nothing is silently attached to the wrong client."
          >
            <div className="space-y-3">
              {dashboard?.matchQueue.length ? (
                dashboard.matchQueue.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {item.subject ?? "Inbound message"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.senderIdentifier ?? "Unknown sender"}
                        </p>
                      </div>
                      <Status value={item.channel} />
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                      {item.bodyText}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <select
                        className={field}
                        value={match.clientId}
                        onChange={(e) =>
                          setMatch({ clientId: e.target.value, matterId: "" })
                        }
                      >
                        <option value="">Select client</option>
                        {options.clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={field}
                        value={match.matterId}
                        onChange={(e) =>
                          setMatch({ ...match, matterId: e.target.value })
                        }
                      >
                        <option value="">Matter (optional)</option>
                        {clientMatters(match.clientId).map((matter) => (
                          <option key={matter.id} value={matter.id}>
                            {matter.matterNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className={primary}
                        disabled={!match.clientId || Boolean(busy)}
                        onClick={() =>
                          void mutate(
                            {
                              operation: "matching.resolve",
                              organisationId: props.organisationId,
                              queueId: item.id,
                              payload: {
                                action: "MATCH",
                                clientId: match.clientId,
                                matterId: match.matterId || undefined,
                                reason:
                                  "Identity and matter link confirmed by authorised staff.",
                                expectedVersion: item.version,
                              },
                            },
                            "Inbound message linked.",
                          )
                        }
                      >
                        Link
                      </button>
                      <button
                        className={secondary}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void mutate(
                            {
                              operation: "matching.resolve",
                              organisationId: props.organisationId,
                              queueId: item.id,
                              payload: {
                                action: "DISMISS",
                                reason:
                                  "Reviewed and intentionally left unlinked.",
                                expectedVersion: item.version,
                              },
                            },
                            "Matching item dismissed.",
                          )
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  No messages need matching.
                </p>
              )}
            </div>
          </Tool>

          <Tool
            title="Portal invitation"
            description="Give a client controlled access to one matter."
          >
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  {
                    operation: "invitation.create",
                    organisationId: props.organisationId,
                    payload: {
                      clientId: invite.clientId,
                      email: invite.email,
                      matterIds: [invite.matterId],
                    },
                  },
                  "Portal invitation sent.",
                );
              }}
            >
              <select
                className={field}
                value={invite.clientId}
                onChange={(e) =>
                  setInvite({
                    ...invite,
                    clientId: e.target.value,
                    matterId: "",
                  })
                }
                required
              >
                <option value="">Client</option>
                {options.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </select>
              <select
                className={field}
                value={invite.matterId}
                onChange={(e) =>
                  setInvite({ ...invite, matterId: e.target.value })
                }
                required
              >
                <option value="">Matter</option>
                {clientMatters(invite.clientId).map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.matterNumber} · {matter.title}
                  </option>
                ))}
              </select>
              <input
                className={field}
                type="email"
                value={invite.email}
                onChange={(e) =>
                  setInvite({ ...invite, email: e.target.value })
                }
                placeholder="Client email"
                required
              />
              <button
                className={primary}
                disabled={!props.canManagePortal || Boolean(busy)}
              >
                Send invitation
              </button>
            </form>
          </Tool>

          <Tool
            title="Publish client progress"
            description="One audited update appears in the secure portal."
          >
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  {
                    operation: "portal-update.publish",
                    organisationId: props.organisationId,
                    payload: {
                      matterId: progress.matterId,
                      title: progress.title,
                      summary: progress.summary,
                      progressPercent: progress.percent
                        ? Number(progress.percent)
                        : undefined,
                    },
                  },
                  "Client progress published.",
                );
              }}
            >
              <select
                className={field}
                value={progress.matterId}
                onChange={(e) =>
                  setProgress({ ...progress, matterId: e.target.value })
                }
                required
              >
                <option value="">Matter</option>
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.matterNumber} · {matter.title}
                  </option>
                ))}
              </select>
              <input
                className={field}
                value={progress.title}
                onChange={(e) =>
                  setProgress({ ...progress, title: e.target.value })
                }
                placeholder="Update title"
                required
              />
              <textarea
                className={area}
                value={progress.summary}
                onChange={(e) =>
                  setProgress({ ...progress, summary: e.target.value })
                }
                placeholder="Plain-English progress summary"
                required
              />
              <input
                className={field}
                type="number"
                min="0"
                max="100"
                value={progress.percent}
                onChange={(e) =>
                  setProgress({ ...progress, percent: e.target.value })
                }
                placeholder="Progress % (optional)"
              />
              <button
                className={primary}
                disabled={!props.canPublishUpdates || Boolean(busy)}
              >
                Publish update
              </button>
            </form>
          </Tool>

          <Tool
            title="Reusable template"
            description="Approved wording for email, WhatsApp or portal."
          >
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  {
                    operation: "template.create",
                    organisationId: props.organisationId,
                    payload: {
                      key: template.key,
                      name: template.name,
                      channel: template.channel,
                      subjectTemplate: template.subject || undefined,
                      bodyTemplate: template.body,
                      status: "ACTIVE",
                    },
                  },
                  "Template created.",
                );
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={field}
                  value={template.key}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      key: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                    })
                  }
                  placeholder="template-key"
                  required
                />
                <select
                  className={field}
                  value={template.channel}
                  onChange={(e) =>
                    setTemplate({ ...template, channel: e.target.value })
                  }
                >
                  <option>EMAIL</option>
                  <option>WHATSAPP</option>
                  <option>PORTAL</option>
                </select>
              </div>
              <input
                className={field}
                value={template.name}
                onChange={(e) =>
                  setTemplate({ ...template, name: e.target.value })
                }
                placeholder="Template name"
                required
              />
              <input
                className={field}
                value={template.subject}
                onChange={(e) =>
                  setTemplate({ ...template, subject: e.target.value })
                }
                placeholder="Subject (optional)"
              />
              <textarea
                className={area}
                value={template.body}
                onChange={(e) =>
                  setTemplate({ ...template, body: e.target.value })
                }
                placeholder="Message wording"
                required
              />
              <button
                className={primary}
                disabled={!props.canManageTemplates || Boolean(busy)}
              >
                Save template
              </button>
            </form>
          </Tool>

          <Tool
            title="Scheduled reminder"
            description="Uses the same durable delivery and retry pipeline."
          >
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const conversation = dashboard?.conversations.find(
                  (item) => item.id === reminder.conversationId,
                );
                void mutate(
                  {
                    operation: "reminder.schedule",
                    organisationId: props.organisationId,
                    payload: {
                      conversationId: reminder.conversationId,
                      channel: conversation?.channel ?? "EMAIL",
                      recipientAddress:
                        conversation?.channel === "PORTAL"
                          ? undefined
                          : reminder.recipient,
                      subject: reminder.subject || undefined,
                      bodyText: reminder.body,
                      scheduledFor: new Date(
                        reminder.scheduledFor,
                      ).toISOString(),
                      idempotencyKey: idempotency("gate-l-reminder"),
                    },
                  },
                  "Reminder scheduled.",
                );
              }}
            >
              <select
                className={field}
                value={reminder.conversationId}
                onChange={(e) =>
                  setReminder({ ...reminder, conversationId: e.target.value })
                }
                required
              >
                <option value="">Conversation</option>
                {dashboard?.conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.subject}
                  </option>
                ))}
              </select>
              <input
                className={field}
                value={reminder.recipient}
                onChange={(e) =>
                  setReminder({ ...reminder, recipient: e.target.value })
                }
                placeholder="Recipient email or +44 number"
              />
              <input
                className={field}
                value={reminder.subject}
                onChange={(e) =>
                  setReminder({ ...reminder, subject: e.target.value })
                }
                placeholder="Subject"
              />
              <textarea
                className={area}
                value={reminder.body}
                onChange={(e) =>
                  setReminder({ ...reminder, body: e.target.value })
                }
                placeholder="Reminder message"
                required
              />
              <input
                className={field}
                type="datetime-local"
                value={reminder.scheduledFor}
                onChange={(e) =>
                  setReminder({ ...reminder, scheduledFor: e.target.value })
                }
                required
              />
              <button
                className={primary}
                disabled={!props.canManageReminders || Boolean(busy)}
              >
                Schedule reminder
              </button>
            </form>
          </Tool>
        </div>
      )}

      {showCompose && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-title"
        >
          <form
            onSubmit={submitCompose}
            className="w-full max-w-2xl space-y-3 rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 id="compose-title" className="text-lg font-bold">
                  New communication
                </h2>
                <p className="text-xs text-slate-500">
                  One client record, one channel, one audit trail.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-slate-100"
                onClick={() => setShowCompose(false)}
                aria-label="Close composer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className={field}
                value={compose.channel}
                onChange={(e) =>
                  setCompose({
                    ...compose,
                    channel: e.target.value,
                    connectionId: "",
                    recipient: "",
                  })
                }
              >
                <option>EMAIL</option>
                <option>WHATSAPP</option>
                <option>PORTAL</option>
              </select>
              <select
                className={field}
                value={compose.clientId}
                onChange={(e) =>
                  setCompose({
                    ...compose,
                    clientId: e.target.value,
                    matterId: "",
                  })
                }
                required
              >
                <option value="">Client</option>
                {options.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </select>
            </div>
            <select
              className={field}
              value={compose.matterId}
              onChange={(e) =>
                setCompose({ ...compose, matterId: e.target.value })
              }
            >
              <option value="">Matter (required for portal)</option>
              {clientMatters(compose.clientId).map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.matterNumber} · {matter.title}
                </option>
              ))}
            </select>
            {compose.channel !== "PORTAL" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  className={field}
                  value={compose.connectionId}
                  onChange={(e) =>
                    setCompose({ ...compose, connectionId: e.target.value })
                  }
                  required={compose.channel === "WHATSAPP"}
                >
                  <option value="">
                    {compose.channel === "EMAIL"
                      ? "Resend fallback / choose account"
                      : "Provider account"}
                  </option>
                  {composeConnections.map((connection) => (
                    <option
                      key={connection.connectionId}
                      value={connection.connectionId}
                    >
                      {connection.displayName}
                    </option>
                  ))}
                </select>
                <input
                  className={field}
                  value={compose.recipient}
                  onChange={(e) =>
                    setCompose({ ...compose, recipient: e.target.value })
                  }
                  placeholder={
                    compose.channel === "WHATSAPP"
                      ? "+447700900000"
                      : "client@example.com"
                  }
                  required
                />
              </div>
            )}
            <input
              className={field}
              value={compose.subject}
              onChange={(e) =>
                setCompose({ ...compose, subject: e.target.value })
              }
              placeholder="Subject"
              required
            />
            <textarea
              className={`${area} min-h-36`}
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              placeholder="Message"
              required
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondary}
                onClick={() => setShowCompose(false)}
              >
                Cancel
              </button>
              <button className={primary} disabled={Boolean(busy)}>
                <Send className="h-4 w-4" /> Queue securely
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function Tool({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-xl border border-slate-200 bg-white shadow-sm"
      open={title.startsWith("Unmatched")}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-bold">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        <ChevronRight
          aria-hidden
          className="h-5 w-5 transition group-open:rotate-90"
        />
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}
