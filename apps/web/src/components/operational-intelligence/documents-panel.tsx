"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, FileCheck2, LoaderCircle } from "lucide-react";

import { operationalIntelligenceRequest } from "@/components/operational-intelligence/operational-intelligence-client";
import {
  documentCategories,
  documentReviewResultSchema,
  type DocumentIntelligenceItem,
  type OperationalIntelligenceDashboard,
} from "@/lib/operational-intelligence";

import {
  EmptyState,
  formatDate,
  formatLabel,
  MetricCard,
} from "./operational-intelligence-ui";

type Props = {
  organisationId: string;
  dashboard: OperationalIntelligenceDashboard;
  onRefresh: () => Promise<void>;
};

function itemTone(item: DocumentIntelligenceItem): string {
  if (item.status === "ERROR" || item.reviewPriority === "URGENT") {
    return "border-red-200 bg-red-50";
  }
  if (item.status === "READY" || item.reviewPriority === "ATTENTION") {
    return "border-amber-200 bg-amber-50";
  }
  return "border-slate-200 bg-white";
}

function DocumentReviewForm({
  organisationId,
  item,
  onRefresh,
}: {
  organisationId: string;
  item: DocumentIntelligenceItem;
  onRefresh: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<
    "ACCEPTED" | "CORRECTED" | "REJECTED"
  >(item.status === "ERROR" ? "REJECTED" : "ACCEPTED");
  const [category, setCategory] = useState<(typeof documentCategories)[number]>(
    item.detectedCategory ?? item.currentCategory,
  );
  const [expiryDate, setExpiryDate] = useState(item.suggestedExpiryDate ?? "");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState(
    item.status === "ERROR" || item.reviewPriority === "URGENT",
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      await operationalIntelligenceRequest(
        "/api/operational-intelligence/mutations",
        documentReviewResultSchema,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "document.review",
            organisationId,
            analysisId: item.analysisId,
            payload: {
              decision,
              confirmedCategory: category,
              confirmedExpiryDate: expiryDate || null,
              corrections: {},
              notes,
              createFollowUpTask: followUp,
              expectedVersion: item.version,
            },
          }),
        },
      );
      setSuccess("Review recorded with audit evidence.");
      await onRefresh();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The review could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submitReview}
      className="mt-5 space-y-3 border-t border-slate-200 pt-4"
    >
      <div className="flex items-center gap-2">
        <FileCheck2 aria-hidden="true" className="h-4 w-4" />
        <h3 className="font-semibold">AAL2 human decision</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-slate-700">
          Decision
          <select
            value={decision}
            onChange={(event) =>
              setDecision(event.target.value as typeof decision)
            }
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="ACCEPTED">Accept</option>
            <option value="CORRECTED">Correct</option>
            <option value="REJECTED">Reject</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Confirmed category
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as typeof category)
            }
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            {documentCategories.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Confirmed expiry
          <input
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
          />
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-700">
        Decision notes
        <textarea
          required
          minLength={3}
          maxLength={2000}
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Record what was checked and why this decision is appropriate."
          className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={followUp}
          onChange={(event) => setFollowUp(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Create a controlled follow-up task
      </label>
      {formError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-2 text-sm text-red-800"
        >
          {formError}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800"
        >
          {success}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || notes.trim().length < 3}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <FileCheck2 aria-hidden="true" className="h-4 w-4" />
          )}
          Record review
        </button>
      </div>
    </form>
  );
}

export function DocumentsPanel({
  organisationId,
  dashboard,
  onRefresh,
}: Props) {
  const { documents, access, provider } = dashboard;
  const [selectedId, setSelectedId] = useState<string | null>(
    documents.items[0]?.analysisId ?? null,
  );
  const selected = useMemo(
    () =>
      documents.items.find((item) => item.analysisId === selectedId) ??
      documents.items[0] ??
      null,
    [documents.items, selectedId],
  );
  const summary = documents.summary;
  const metrics = [
    ["Awaiting analysis", summary.awaitingAnalysis, "default"],
    ["Processing", summary.processing, "default"],
    [
      "Ready for review",
      summary.readyForReview,
      summary.readyForReview ? "warning" : "default",
    ],
    ["Urgent", summary.urgent, summary.urgent ? "danger" : "success"],
    ["Failed", summary.failed, summary.failed ? "danger" : "success"],
    [
      "Expiring (30d)",
      summary.expiringThirtyDays,
      summary.expiringThirtyDays ? "warning" : "default",
    ],
  ] as const;

  return (
    <div className="space-y-4">
      <div
        className={
          provider.generationEnabled
            ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
            : "rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
        }
      >
        <p className="text-sm font-semibold">
          {provider.generationEnabled
            ? `Document analysis enabled · ${provider.model ?? "approved model"}`
            : "Free mode · manual review remains available"}
        </p>
        <p className="mt-0.5 text-xs text-slate-700">
          AI output is advisory. Classification, expiry and checklist changes
          are applied only after an AAL2 human review.
        </p>
      </div>

      <section
        aria-label="Document intelligence summary"
        className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"
      >
        {metrics.map(([label, value, tone]) => (
          <MetricCard key={label} label={label} value={value} tone={tone} />
        ))}
      </section>

      {!access.documentIntelligence ? (
        <EmptyState>
          Your role does not include document-intelligence access.
        </EmptyState>
      ) : documents.items.length === 0 ? (
        <EmptyState>
          No clean document versions are waiting for analysis or human review.
        </EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(420px,1.4fr)]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-semibold">Review queue</h2>
              <p className="text-xs text-slate-500">
                Urgent and failed items first.
              </p>
            </div>
            <div className="max-h-[58vh] space-y-2 overflow-auto p-2">
              {documents.items.map((item) => (
                <button
                  key={item.analysisId}
                  type="button"
                  aria-pressed={selected?.analysisId === item.analysisId}
                  onClick={() => setSelectedId(item.analysisId)}
                  className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 ${
                    selected?.analysisId === item.analysisId
                      ? "ring-2 ring-slate-950"
                      : itemTone(item)
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold">
                      {item.documentTitle}
                    </span>
                    <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                      {formatLabel(item.reviewPriority)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                    {item.matterNumber} · {item.matterTitle}
                  </p>
                  <p className="mt-2 text-xs font-medium capitalize text-slate-700">
                    {formatLabel(item.status)}
                    {item.jobStatus ? ` · ${formatLabel(item.jobStatus)}` : ""}
                  </p>
                </button>
              ))}
            </div>
          </section>

          {selected ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">
                    {selected.documentTitle}
                  </h2>
                  <Link
                    href={`/matters/${selected.matterId}`}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    {selected.matterNumber} · open matter
                  </Link>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">
                  {formatLabel(selected.status)}
                </span>
              </div>

              <div className="max-h-[66vh] overflow-auto p-4">
                {selected.status === "ERROR" ? (
                  <div className="mb-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    Automated analysis failed (
                    {selected.errorCode ?? "provider unavailable"}). Review
                    manually or create follow-up work.
                  </div>
                ) : null}

                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Current category</dt>
                    <dd className="mt-0.5 font-medium capitalize">
                      {formatLabel(selected.currentCategory)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      Suggested category
                    </dt>
                    <dd className="mt-0.5 font-medium capitalize">
                      {selected.detectedCategory
                        ? `${formatLabel(selected.detectedCategory)} (${Math.round((selected.categoryConfidenceBps ?? 0) / 100)}%)`
                        : "No suggestion"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Suggested expiry</dt>
                    <dd className="mt-0.5 font-medium">
                      {formatDate(selected.suggestedExpiryDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      Provider evidence
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {selected.provider
                        ? `${selected.provider} · ${selected.model ?? "model recorded"}`
                        : "Manual review"}
                    </dd>
                  </div>
                </dl>

                {selected.summary ? (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Advisory summary
                    </p>
                    <p className="mt-1 leading-6">{selected.summary}</p>
                  </div>
                ) : null}

                {[
                  selected.missingPages.map(String),
                  selected.missingInformation,
                  selected.inconsistencies,
                ].some((items) => items.length) ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      ["Missing pages", selected.missingPages.map(String)],
                      ["Missing information", selected.missingInformation],
                      ["Inconsistencies", selected.inconsistencies],
                    ].map(([title, items]) => (
                      <div
                        key={title as string}
                        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"
                      >
                        <p className="font-semibold">{title as string}</p>
                        <p className="mt-1 text-slate-700">
                          {(items as string[]).join(", ") || "None detected"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {selected.canReview ? (
                  <DocumentReviewForm
                    key={`${selected.analysisId}:${selected.version}`}
                    organisationId={organisationId}
                    item={selected}
                    onRefresh={onRefresh}
                  />
                ) : (
                  <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    Review requires document-review permission and a current
                    AAL2 session. Other work remains available.
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
