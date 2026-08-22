import type { ReactNode } from "react";
import { Archive, CheckCircle2, Plus } from "lucide-react";

import type { WorkforceMutation } from "@/lib/workforce-configuration";

export type RunWorkforceMutation = (
  mutation: WorkforceMutation,
  successMessage: string,
) => Promise<boolean>;

export const inputClass =
  "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:cursor-not-allowed disabled:bg-slate-100";
export const textareaClass = `${inputClass} min-h-24 resize-y`;
export const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function fieldText(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function nullableText(form: FormData, name: string): string | null {
  return fieldText(form, name) || null;
}

export function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on";
}

export function numeric(form: FormData, name: string): number {
  return Number(fieldText(form, name));
}

export function toIsoDateTime(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function toDateTimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
      <Archive aria-hidden="true" className="h-3.5 w-3.5" />
      Archived
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
      {children}
    </div>
  );
}

export function SaveButton({
  pending,
  creating,
}: {
  pending: boolean;
  creating: boolean;
}) {
  return (
    <button type="submit" disabled={pending} className={primaryButtonClass}>
      <Plus aria-hidden="true" className="h-4 w-4" />
      {pending ? "Saving…" : creating ? "Create" : "Save changes"}
    </button>
  );
}

export function CheckboxField({
  name,
  label,
  description,
  defaultChecked = false,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-950"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {description ? (
          <span className="mt-1 block text-xs leading-5 text-slate-600">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}