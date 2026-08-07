/**
 * BusinessOS secure login page.
 *
 * Authentication is performed by a Server Action. The browser is never trusted
 * to determine a user's organisation, role or permissions.
 */

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  initialLoginState,
  login,
  type LoginActionState,
} from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        "Signing in securely…"
      ) : (
        <>
          Sign in securely
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </>
      )}
    </button>
  );
}

function FieldError({
  id,
  errors,
}: {
  id: string;
  errors?: string[];
}) {
  if (!errors?.length) {
    return null;
  }

  return (
    <p id={id} role="alert" className="mt-2 text-sm text-red-700">
      {errors[0]}
    </p>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    initialLoginState,
  );

  const emailErrorId = state.fieldErrors?.email
    ? "login-email-error"
    : undefined;

  const passwordErrorId = state.fieldErrors?.password
    ? "login-password-error"
    : undefined;

  return (
    <main className="flex min-h-screen bg-slate-50">
      <section className="hidden w-1/2 flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          </div>

          <div>
            <p className="text-lg font-semibold tracking-tight">BusinessOS</p>
            <p className="text-sm text-slate-400">
              Secure AI Business Operations
            </p>
          </div>
        </div>

        <div className="max-w-xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
            Work intelligently
          </p>

          <h1 className="text-5xl font-semibold leading-tight tracking-tight">
            One secure operating system for your entire business.
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Manage enquiries, clients, work, communication and growth from one
            permission-controlled platform.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-400">
          <LockKeyhole aria-hidden="true" className="h-4 w-4" />
          <span>Encrypted authentication and controlled access</span>
        </div>
      </section>

      <section className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              </div>

              <span className="text-xl font-semibold tracking-tight text-slate-950">
                BusinessOS
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/40 sm:p-9">
            <header className="mb-8">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                Welcome back
              </h1>

              <p className="mt-3 leading-6 text-slate-600">
                Sign in using your authorised BusinessOS account.
              </p>
            </header>

            {state.status === "error" && state.message ? (
              <div
                role="alert"
                aria-live="polite"
                className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
              >
                {state.message}
              </div>
            ) : null}

            <form action={formAction} className="space-y-5" noValidate>
              <input
                type="hidden"
                name="returnTo"
                value={
                  typeof window !== "undefined"
                    ? new URLSearchParams(window.location.search).get(
                        "returnTo",
                      ) ?? ""
                    : ""
                }
              />

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-slate-800"
                >
                  Work email
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={254}
                  aria-invalid={Boolean(emailErrorId)}
                  aria-describedby={emailErrorId}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="name@company.co.uk"
                />

                <FieldError
                  id="login-email-error"
                  errors={state.fieldErrors?.email}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-slate-800"
                  >
                    Password
                  </label>

                  <span className="text-xs text-slate-500">
                    Password reset coming next
                  </span>
                </div>

                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1_024}
                  aria-invalid={Boolean(passwordErrorId)}
                  aria-describedby={passwordErrorId}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="Enter your password"
                />

                <FieldError
                  id="login-password-error"
                  errors={state.fieldErrors?.password}
                />
              </div>

              <SubmitButton />
            </form>

            <div className="mt-7 border-t border-slate-200 pt-6">
              <div className="flex items-start gap-3 text-sm leading-6 text-slate-600">
                <LockKeyhole
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-700"
                />

                <p>
                  Access is restricted to authorised users. Activity may be
                  recorded for security, compliance and fraud prevention.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-slate-500">
            Protected by secure session management and organisation-level
            access controls.
          </p>
        </div>
      </section>
    </main>
  );
}