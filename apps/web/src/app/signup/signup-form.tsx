"use client";

import {
  useActionState,
  useState,
} from "react";
import Link from "next/link";
import {
  useFormStatus,
} from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import {
  signup,
  type SignupActionState,
} from "./actions";

type SignupFormProps = {
  returnTo: string;
};

type FieldErrorProps = {
  id: string;
  messages?: string[];
};

const INITIAL_STATE:
  SignupActionState = {
    status: "idle",
  };

function FieldError({
  id,
  messages,
}: FieldErrorProps) {
  if (!messages?.length) {
    return null;
  }

  return (
    <div
      id={id}
      role="alert"
      className="mt-2 space-y-1 text-sm text-red-700"
    >
      {messages.map((message) => (
        <p key={message}>
          {message}
        </p>
      ))}
    </div>
  );
}

function SubmitButton() {
  const { pending } =
    useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 animate-spin"
          />

          Creating secure account…
        </>
      ) : (
        <>
          <UserPlus
            aria-hidden="true"
            className="h-4 w-4"
          />

          Create secure account
        </>
      )}
    </button>
  );
}

export function SignupForm({
  returnTo,
}: SignupFormProps) {
  const [state, formAction] =
    useActionState<
      SignupActionState,
      FormData
    >(
      signup,
      INITIAL_STATE,
    );

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    showConfirmation,
    setShowConfirmation,
  ] = useState(false);

  const loginHref =
    `/login?returnTo=${encodeURIComponent(
      returnTo,
    )}`;

  const emailErrors =
    state.fieldErrors?.email;

  const passwordErrors =
    state.fieldErrors?.password;

  const confirmationErrors =
    state.fieldErrors
      ?.confirmPassword;

  if (
    state.status === "success" &&
    state.message
  ) {
    return (
      <div>
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
        >
          <div className="flex gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700"
            />

            <div>
              <h2 className="font-semibold">
                Check your email
              </h2>

              <p className="mt-2 text-sm leading-6">
                {state.message}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
          <div className="flex gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />

            <p>
              Open the confirmation link in
              the same browser. After your
              email is verified, BusinessOS
              will return you to the secure
              invitation.
            </p>
          </div>
        </div>

        <Link
          href={loginHref}
          prefetch={false}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
        >
          Already confirmed? Sign in

          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4"
          />
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-5"
    >
      <input
        type="hidden"
        name="returnTo"
        value={returnTo}
      />

      <div
        aria-hidden="true"
        className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor="company-website">
          Company website
        </label>

        <input
          id="company-website"
          name="companyWebsite"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {state.status === "error" &&
        state.message && (
          <div
            role="alert"
            aria-live="polite"
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
          htmlFor="signup-email"
          className="block text-sm font-medium text-slate-800"
        >
          Work email
        </label>

        <input
          id="signup-email"
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
              ? "signup-email-error"
              : "signup-email-help"
          }
          className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 aria-[invalid=true]:border-red-500"
          placeholder="name@company.co.uk"
        />

        {emailErrors?.length ? (
          <FieldError
            id="signup-email-error"
            messages={emailErrors}
          />
        ) : (
          <p
            id="signup-email-help"
            className="mt-2 text-xs leading-5 text-slate-500"
          >
            For an invitation, use the exact
            email address that received it.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="signup-password"
          className="block text-sm font-medium text-slate-800"
        >
          Password
        </label>

        <div className="relative mt-2">
          <input
            id="signup-password"
            name="password"
            type={
              showPassword
                ? "text"
                : "password"
            }
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            aria-invalid={
              passwordErrors?.length
                ? true
                : undefined
            }
            aria-describedby={
              passwordErrors?.length
                ? "signup-password-help signup-password-error"
                : "signup-password-help"
            }
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 aria-[invalid=true]:border-red-500"
          />

          <button
            type="button"
            onClick={() =>
              setShowPassword(
                (visible) => !visible,
              )
            }
            aria-label={
              showPassword
                ? "Hide password"
                : "Show password"
            }
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-950"
          >
            {showPassword ? (
              <EyeOff
                aria-hidden="true"
                className="h-5 w-5"
              />
            ) : (
              <Eye
                aria-hidden="true"
                className="h-5 w-5"
              />
            )}
          </button>
        </div>

        <p
          id="signup-password-help"
          className="mt-2 text-xs leading-5 text-slate-500"
        >
          Use 12–128 characters with
          uppercase, lowercase, number and
          special character.
        </p>

        <FieldError
          id="signup-password-error"
          messages={passwordErrors}
        />
      </div>

      <div>
        <label
          htmlFor="signup-confirm-password"
          className="block text-sm font-medium text-slate-800"
        >
          Confirm password
        </label>

        <div className="relative mt-2">
          <input
            id="signup-confirm-password"
            name="confirmPassword"
            type={
              showConfirmation
                ? "text"
                : "password"
            }
            autoComplete="new-password"
            required
            maxLength={128}
            aria-invalid={
              confirmationErrors?.length
                ? true
                : undefined
            }
            aria-describedby={
              confirmationErrors?.length
                ? "signup-confirm-password-error"
                : undefined
            }
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 aria-[invalid=true]:border-red-500"
          />

          <button
            type="button"
            onClick={() =>
              setShowConfirmation(
                (visible) => !visible,
              )
            }
            aria-label={
              showConfirmation
                ? "Hide password confirmation"
                : "Show password confirmation"
            }
            aria-pressed={
              showConfirmation
            }
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-950"
          >
            {showConfirmation ? (
              <EyeOff
                aria-hidden="true"
                className="h-5 w-5"
              />
            ) : (
              <Eye
                aria-hidden="true"
                className="h-5 w-5"
              />
            )}
          </button>
        </div>

        <FieldError
          id="signup-confirm-password-error"
          messages={
            confirmationErrors
          }
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
        BusinessOS uses your email and account
        security data to authenticate you,
        protect organisation access and
        maintain security audit records.
        Access is not granted until your email
        and invitation are verified.
      </div>

      <SubmitButton />

      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link
          href={loginHref}
          prefetch={false}
          className="font-semibold text-sky-700 hover:text-sky-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}