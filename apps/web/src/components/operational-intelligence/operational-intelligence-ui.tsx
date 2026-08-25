import type { ReactNode } from "react";

export function formatDateTime(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/London",
  }).format(date);
}

export function formatLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

export function formatMoneyMinor(value: string): string {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(minor / 100);
}

export function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const tones = {
    default: "border-slate-200 bg-white",
    warning: "border-amber-200 bg-amber-50",
    danger: "border-red-200 bg-red-50",
    success: "border-emerald-200 bg-emerald-50",
  };

  return (
    <article className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="truncate text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">
        {value}
      </p>
    </article>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600">
      {children}
    </p>
  );
}
