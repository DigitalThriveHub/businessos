"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  ListTodo,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";

import { myAiRequest } from "@/components/my-ai/my-ai-client";
import {
  myAiCommandResultSchema,
  myAiWorkspaceSchema,
  type MyAiWorkspace as MyAiWorkspaceData,
} from "@/lib/my-ai";

type Props = { organisationId: string };

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

function actionTone(status: string): string {
  if (status === "APPROVED") return "border-emerald-200 bg-emerald-50";
  if (status === "REJECTED" || status === "CANCELLED") {
    return "border-slate-300 bg-slate-50";
  }
  if (status === "BLOCKED" || status === "EXPIRED") {
    return "border-red-200 bg-red-50";
  }
  return "border-amber-200 bg-amber-50";
}

export function MyAiWorkspace({ organisationId }: Props) {
  const [workspace, setWorkspace] = useState<MyAiWorkspaceData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeDetails, setShowUpgradeDetails] = useState(false);

  const refresh = useCallback(
    async (conversationId?: string) => {
      try {
        const query = new URLSearchParams({ organisationId });
        if (conversationId) query.set("conversationId", conversationId);
        const result = await myAiRequest(
          `/api/my-ai?${query.toString()}`,
          myAiWorkspaceSchema,
        );
        setWorkspace(result);
        setError(null);
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "The personal AI workspace could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    },
    [organisationId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const runCommand = useCallback(
    async (
      mode: "CHAT" | "DAILY_BRIEF",
      suppliedMessage?: string,
      forceNewConversation = false,
    ) => {
      const command = (suppliedMessage ?? message).trim();
      if (
        command.length < 2 ||
        submitting ||
        !workspace?.availability.commandAvailable
      ) {
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const result = await myAiRequest(
          "/api/my-ai/mutations",
          myAiCommandResultSchema,
          {
            method: "POST",
            body: JSON.stringify({
              operation: "command.run",
              organisationId,
              payload: {
                clientRequestId: crypto.randomUUID(),
                ...(!forceNewConversation && workspace?.activeConversationId
                  ? { conversationId: workspace.activeConversationId }
                  : {}),
                mode,
                message: command,
              },
            }),
          },
        );
        setMessage("");
        await refresh(result.conversationId);
      } catch (commandError) {
        setError(
          commandError instanceof Error
            ? commandError.message
            : "The AI command could not be completed.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [message, organisationId, refresh, submitting, workspace],
  );

  const workloadCards = useMemo(() => {
    if (!workspace) return [];
    return [
      {
        label: "Open tasks",
        value: workspace.workload.openTasks,
        icon: ListTodo,
      },
      {
        label: "Overdue",
        value: workspace.workload.overdueTasks,
        icon: Clock3,
      },
      {
        label: "Deadlines (7d)",
        value: workspace.workload.deadlinesNextSevenDays,
        icon: CalendarClock,
      },
      {
        label: "Enquiries",
        value: workspace.workload.assignedEnquiries,
        icon: FileText,
      },
      {
        label: "Active matters",
        value: workspace.workload.activeMatters,
        icon: BriefcaseBusiness,
      },
      {
        label: "My approvals",
        value: workspace.workload.pendingApprovals,
        icon: UserRoundCheck,
      },
    ];
  }, [workspace]);

  const aiCommandAvailable = workspace?.availability.commandAvailable ?? false;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Governed personal workspace
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">My AI</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Ask questions, prepare your daily brief and draft next steps using
            only the BusinessOS records your role can already access.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setWorkspace((current) =>
                current
                  ? {
                      ...current,
                      activeConversationId: null,
                      messages: [],
                      actions: [],
                    }
                  : current,
              );
              setMessage("");
              setError(null);
            }}
            disabled={submitting || !aiCommandAvailable}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold shadow-sm disabled:opacity-50"
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> New
            conversation
          </button>
          <button
            type="button"
            onClick={() =>
              void refresh(workspace?.activeConversationId ?? undefined)
            }
            disabled={loading || submitting}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold shadow-sm disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </button>
          <button
            type="button"
            onClick={() =>
              void runCommand(
                "DAILY_BRIEF",
                "Prepare my daily brief. Prioritise urgent work, deadlines, approvals and the three most useful next steps. Do not invent facts or execute anything.",
                true,
              )
            }
            disabled={submitting || !aiCommandAvailable}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {submitting ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            Generate daily brief
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
        <strong>Human control:</strong> My AI can draft and propose. It cannot
        send messages, change records, move money or mark work executed. Any
        proposal is routed to the existing AAL2 approval workspace.
      </div>

      {workspace && !workspace.availability.commandAvailable ? (
        <section
          aria-labelledby="ai-access-heading"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                {workspace.availability.state === "FREE_MODE"
                  ? "Free testing mode · £0 AI provider usage"
                  : "AI setup required"}
              </p>
              <h2 id="ai-access-heading" className="mt-1 text-lg font-bold">
                {workspace.availability.upgradeRequired
                  ? "Upgrade is required for AI generation"
                  : "Complete the server-side AI configuration"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6">
                {workspace.availability.message}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold"
              >
                Continue without AI
              </Link>
              <button
                type="button"
                aria-expanded={showUpgradeDetails}
                onClick={() => setShowUpgradeDetails((current) => !current)}
                className="inline-flex h-10 items-center rounded-xl bg-amber-950 px-4 text-sm font-semibold text-white"
              >
                {showUpgradeDetails ? "Hide options" : "View AI upgrade"}
              </button>
            </div>
          </div>

          {showUpgradeDetails ? (
            <div className="mt-5 grid gap-4 border-t border-amber-200 pt-5 md:grid-cols-2">
              <div className="rounded-xl bg-white/80 p-4">
                <h3 className="font-semibold">Free mode includes</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-5">
                  {workspace.availability.freeCapabilities.map((capability) => (
                    <li key={capability}>{capability}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-white/80 p-4">
                <h3 className="font-semibold">AI access unlocks</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-5">
                  {workspace.availability.upgradeCapabilities.map(
                    (capability) => (
                      <li key={capability}>{capability}</li>
                    ),
                  )}
                </ul>
                <p className="mt-3 text-xs leading-5 text-amber-900">
                  A BusinessOS administrator must enable an approved paid AI
                  provider. No subscription or provider purchase is claimed by
                  this screen.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {workloadCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums">
                {loading ? "—" : card.value}
              </p>
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">
                  {workspace?.identity.agentName ?? "BusinessOS Personal AI"}
                </h2>
                <p className="text-xs text-slate-500">
                  {workspace?.identity.jobTitle ??
                    "Role-aware employee support"}
                  {workspace ? ` · ${workspace.identity.authorityCeiling}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Permission filtered
              </span>
              {workspace ? (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    workspace.availability.commandAvailable
                      ? "bg-blue-100 text-blue-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {workspace.availability.commandAvailable
                    ? "AI enabled"
                    : "Free mode"}
                </span>
              ) : null}
            </div>
          </div>

          <div className="min-h-[26rem] space-y-4 bg-slate-50/60 p-5">
            {loading ? (
              <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-600">
                <LoaderCircle
                  className="h-5 w-5 animate-spin"
                  aria-hidden="true"
                />
                Loading your private workspace…
              </div>
            ) : workspace?.messages.length ? (
              workspace.messages.map((entry) => (
                <article
                  key={entry.id}
                  className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm ${
                    entry.role === "USER"
                      ? "ml-auto bg-slate-950 text-white"
                      : "border border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-4 text-xs font-semibold opacity-70">
                    <span>{entry.role === "USER" ? "You" : "My AI"}</span>
                    <time dateTime={entry.createdAt}>
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {entry.content}
                  </p>
                </article>
              ))
            ) : (
              <div className="mx-auto flex min-h-80 max-w-xl flex-col items-center justify-center text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                  <Sparkles className="h-7 w-7" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-xl font-bold">
                  {aiCommandAvailable
                    ? "What should we solve first?"
                    : "Your BusinessOS work remains available"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {aiCommandAvailable
                    ? "Ask about your workload or start with a daily brief. The AI receives no record outside your existing role and tenant access."
                    : "AI generation is locked, but the workload figures above and every non-AI workspace continue to operate normally."}
                </p>
              </div>
            )}
          </div>

          <form
            className="border-t border-slate-200 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void runCommand("CHAT");
            }}
          >
            <label htmlFor="my-ai-message" className="sr-only">
              Ask My AI
            </label>
            <textarea
              id="my-ai-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={3}
              maxLength={4_000}
              disabled={submitting || !aiCommandAvailable}
              placeholder={
                aiCommandAvailable
                  ? "Ask about your workload, a permitted record, a draft or the next best action…"
                  : "Upgrade AI access to use chat and daily briefs."
              }
              className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Ctrl/⌘ + Enter to send ·{" "}
                {message.length.toLocaleString("en-GB")}/4,000
              </p>
              <button
                type="submit"
                disabled={
                  submitting || !aiCommandAvailable || message.trim().length < 2
                }
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <LoaderCircle
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Send securely
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Suggested questions</h2>
            <div className="mt-3 space-y-2">
              {workspace?.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setMessage(suggestion)}
                  disabled={submitting || !aiCommandAvailable}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm leading-5 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Proposed actions</h2>
              <Link
                href="/operations"
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Approvals
              </Link>
            </div>
            <div className="mt-3 space-y-3">
              {workspace?.actions.length ? (
                workspace.actions.map((action) => (
                  <article
                    key={action.id}
                    className={`rounded-xl border p-3 ${actionTone(action.status)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold">{action.title}</h3>
                      {action.status === "APPROVED" ? (
                        <CheckCircle2
                          className="h-4 w-4 shrink-0 text-emerald-700"
                          aria-hidden="true"
                        />
                      ) : (
                        <Clock3
                          className="h-4 w-4 shrink-0 text-slate-600"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-700">
                      {action.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                      <span>{statusLabel(action.status)}</span>
                      <span>·</span>
                      <span>{action.riskLevel.toLowerCase()} risk</span>
                    </div>
                    {action.status === "APPROVED" ? (
                      <p className="mt-2 text-xs font-medium text-emerald-800">
                        Approved only—execution has not been claimed.
                      </p>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm leading-5 text-slate-600">
                  No proposals yet. Drafts and actions appear here only after
                  policy and record-access validation.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Recent conversations</h2>
            <div className="mt-3 space-y-2">
              {workspace?.conversations.length ? (
                workspace.conversations.slice(0, 8).map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => void refresh(conversation.id)}
                    disabled={submitting}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition disabled:opacity-50 ${
                      conversation.id === workspace.activeConversationId
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {conversation.title}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatDateTime(conversation.lastMessageAt)}
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-sm text-slate-600">
                  No conversation history.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
