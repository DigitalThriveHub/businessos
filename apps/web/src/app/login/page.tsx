/**
 * BusinessOS secure login page.
 *
 * Authentication is performed by a Server Action. The browser
 * is never trusted to determine a user's organisation, role
 * or permissions.
 */

"use client";

import {
  Suspense,
  useActionState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ArrowRight } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import {
  getSafePostAuthenticationPath,
  isPortalInvitationReturnPath,
} from "@/lib/security/safe-return-path";

import {
  login,
  type LoginActionState,
} from "./actions";

const initialLoginState:
  LoginActionState = {
    status: "idle",
  };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        "Signing in securely..."
      ) : (
        <>
          Sign in securely

          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4"
          />
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
    <div
      id={id}
      role="alert"
      className="mt-2 text-sm text-red-700"
    >
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();

  const returnTo =
    getSafePostAuthenticationPath(
      searchParams.get("returnTo"),
    );

  const portalInvitationFlow =
    isPortalInvitationReturnPath(
      returnTo,
    );

  const signupHref =
    `/signup?returnTo=${encodeURIComponent(
      returnTo,
    )}`;

  const [state, formAction] =
    useActionState<
      LoginActionState,
      FormData
    >(
      login,
      initialLoginState,
    );

  const emailErrorId =
    state.fieldErrors?.email?.length
      ? "login-email-error"
      : undefined;

  const passwordErrorId =
    state.fieldErrors?.password?.length
      ? "login-password-error"
      : undefined;

  return (
    <AuthShell
      title="Welcome back"
      description={
        <p>
          {portalInvitationFlow
            ? "Sign in with the exact email address that received your secure client invitation."
            : "Sign in using your authorised BusinessOS account."}
        </p>
      }
    >
      {state.status === "error" &&
        state.message && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
          >
            {state.message}
          </div>
        )}

      <form
        action={formAction}
        className="space-y-5"
        noValidate
      >
        <input
          type="hidden"
          name="returnTo"
          value={returnTo}
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
            aria-invalid={
              emailErrorId
                ? true
                : undefined
            }
            aria-describedby={
              emailErrorId
            }
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 aria-[invalid=true]:border-red-500"
            placeholder="name@company.co.uk"
          />

          <FieldError
            id="login-email-error"
            errors={
              state.fieldErrors?.email
            }
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-4">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-800"
            >
              Password
            </label>

            <Link
              href="/forgot-password"
              className="rounded-md text-sm font-medium text-sky-700 transition hover:text-sky-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
            >
              Forgot password?
            </Link>
          </div>

          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1_024}
            aria-invalid={
              passwordErrorId
                ? true
                : undefined
            }
            aria-describedby={
              passwordErrorId
            }
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 aria-[invalid=true]:border-red-500"
            placeholder="Enter your password"
          />

          <FieldError
            id="login-password-error"
            errors={
              state.fieldErrors?.password
            }
          />
        </div>

        <SubmitButton />
      </form>

      <div className="mt-6 border-t border-slate-200 pt-6 text-center text-sm text-slate-600">
        <p>
          {portalInvitationFlow
            ? "First time using the client portal?"
            : "New to BusinessOS?"}{" "}

          <Link
            href={signupHref}
            prefetch={false}
            className="font-semibold text-sky-700 hover:text-sky-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            {portalInvitationFlow
              ? "Create your client account"
              : "Create an account"}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

function LoginFallback() {
  return (
    <AuthShell
      title="Welcome back"
      description={
        <p>
          Preparing secure sign-in…
        </p>
      }
    >
      <div
        role="status"
        className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"
      >
        Loading secure authentication…
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={<LoginFallback />}
    >
      <LoginContent />
    </Suspense>
  );
}
