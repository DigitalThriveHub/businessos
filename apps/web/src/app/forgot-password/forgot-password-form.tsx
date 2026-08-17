"use client";

import {
  useActionState,
} from "react";
import {
  useFormStatus,
} from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Mail,
} from "lucide-react";

import {
  requestPasswordReset,
  type ForgotPasswordActionState,
} from "./actions";

const INITIAL_STATE:
  ForgotPasswordActionState = {
    status: "idle",
  };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 animate-spin"
          />
          Sending secure link…
        </>
      ) : (
        <>
          <Mail
            aria-hidden="true"
            className="h-4 w-4"
          />
          Send password-reset link
        </>
      )}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] =
    useActionState(
      requestPasswordReset,
      INITIAL_STATE,
    );

  const emailErrors =
    state.fieldErrors?.email;

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-5"
    >
      {state.status === "success" &&
        state.message && (
          <div
            role="status"
            aria-live="polite"
            className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"
          >
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />

            <div>
              <p className="font-semibold">
                Check your email
              </p>

              <p className="mt-1">
                {state.message}
              </p>

              <p className="mt-1 text-emerald-800">
                Check your spam folder if the
                message does not appear.
              </p>
            </div>
          </div>
        )}

      {state.status === "error" &&
        state.message && (
          <div
            role="alert"
            className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
          >
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />

            <p>{state.message}</p>
          </div>
        )}

      <div>
        <label
          htmlFor="recovery-email"
          className="block text-sm font-medium text-slate-800"
        >
          Email address
        </label>

        <input
          id="recovery-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          aria-invalid={
            emailErrors?.length
              ? true
              : undefined
          }
          aria-describedby={
            emailErrors?.length
              ? "recovery-email-error"
              : "recovery-email-help"
          }
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-100"
          placeholder="you@example.com"
        />

        {emailErrors?.length ? (
          <div
            id="recovery-email-error"
            className="mt-2 text-sm text-red-700"
          >
            {emailErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : (
          <p
            id="recovery-email-help"
            className="mt-2 text-xs leading-5 text-slate-500"
          >
            Enter the email address associated
            with your BusinessOS account.
          </p>
        )}
      </div>

      <SubmitButton />

      <p className="text-center text-xs leading-5 text-slate-500">
        For security, the response is the same
        whether or not an account exists.
      </p>
    </form>
  );
}