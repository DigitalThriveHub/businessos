"use client";

import { type FormEvent, useRef, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";

import type { PublicIntakeForm } from "@/lib/public-intake";

export function PublicIntakeFormView({ form }: { form: PublicIntakeForm }) {
  const startedAt = useRef(new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      submissionId: crypto.randomUUID(),
      formStartedAt: startedAt.current,
      lawfulBasis: "CONSENT",
      privacyNoticeAcknowledged: data.get("privacyNoticeAcknowledged") === "on",
      privacyNoticeVersion: form.privacyNoticeVersion,
      companyWebsite: String(data.get(form.honeypotField) ?? ""),
    };
    for (const field of form.formSchema.fields) {
      payload[field.name] =
        field.type === "checkbox"
          ? data.get(field.name) === "on"
          : String(data.get(field.name) ?? "").trim() || undefined;
    }
    if (payload.marketingConsent === true) {
      payload.marketingConsentCapturedAt = new Date().toISOString();
    }
    try {
      const response = await fetch(
        `/api/public/forms/${form.publicId}/submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          body?.message ?? "The submission could not be accepted.",
        );
      }
      setComplete(true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The submission could not be accepted.",
      );
      setBusy(false);
    }
  }

  if (complete) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
        <section className="w-full rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-bold">Information received</h1>
          <p className="mt-3 text-slate-700">{form.successMessage}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-12">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
          <ShieldCheck className="h-4 w-4" /> Secure BusinessOS form
        </div>
        <h1 className="mt-3 text-3xl font-bold">{form.name}</h1>
        {form.description ? (
          <p className="mt-3 leading-7 text-slate-600">{form.description}</p>
        ) : null}
      </header>
      <form
        onSubmit={submit}
        className="mt-8 space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div
          className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
          aria-hidden="true"
        >
          <label>
            Company website
            <input name={form.honeypotField} tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {form.formSchema.fields.map((field) => (
          <label
            key={field.name}
            className="block text-sm font-semibold text-slate-800"
          >
            {field.label}
            {field.required ? " *" : ""}
            {field.type === "textarea" ? (
              <textarea
                name={field.name}
                required={field.required}
                placeholder={field.placeholder}
                rows={5}
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
              />
            ) : field.type === "select" ? (
              <select
                name={field.name}
                required={field.required}
                className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
              >
                <option value="">Select</option>
                {field.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                name={field.name}
                type="checkbox"
                className="ml-3 h-4 w-4"
              />
            ) : (
              <input
                name={field.name}
                type={field.type}
                required={field.required}
                placeholder={field.placeholder}
                className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
              />
            )}
          </label>
        ))}
        <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
          <input
            name="privacyNoticeAcknowledged"
            type="checkbox"
            required
            className="mt-1 h-4 w-4"
          />
          <span>
            I have read the{" "}
            <a
              href={form.privacyNoticeUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-blue-700 underline"
            >
              privacy notice
            </a>{" "}
            and consent to this information being used to respond to my enquiry.
          </span>
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}
        <button
          disabled={busy}
          className="h-12 w-full rounded-xl bg-slate-950 px-5 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Submitting securely…" : form.submitButtonLabel}
        </button>
      </form>
    </main>
  );
}
