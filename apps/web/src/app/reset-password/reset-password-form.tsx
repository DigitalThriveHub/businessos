"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
} from "lucide-react";

import {
  resetPassword,
  type ResetPasswordActionState,
} from "./actions";

const INITIAL_STATE:
  ResetPasswordActionState = {
    status: "idle",
  };

function SubmitButton() {
  const { pending } = useFormStatus();

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

          Updating password...
        </>
      ) : (
        <>
          <KeyRound
            aria-hidden="true"
            className="h-4 w-4"
          />

          Update password
        </>
      )}
    </button>
  );
}

function FieldErrors({
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
      className="mt-2 space-y-1 text-sm text-red-700"
    >
      {errors.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] =
    useActionState<
      ResetPasswordActionState,
      FormData
    >(
      resetPassword,
      INITIAL_STATE,
    );

  const formRef =
    useRef<HTMLFormElement>(null);

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    showConfirmation,
    setShowConfirmation,
  ] = useState(false);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setShowPassword(false);
      setShowConfirmation(false);
    }
  }, [state.status]);

  const passwordErrors =
    state.fieldErrors?.password;

  const confirmationErrors =
    state.fieldErrors
      ?.confirmPassword;

  if (
    state.status === "success"
  ) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
      >
        <div className="flex gap-3">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700"
          />

          <div>
            <h2 className="font-semibold">
              Password updated
            </h2>

            <p className="mt-2 text-sm leading-6">
              {state.message}
            </p>
          </div>
        </div>

        <Link
          href="/login"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
        >
          Sign in with new password

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
      ref={formRef}
      action={formAction}
      noValidate
      className="space-y-5"
    >
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
          htmlFor="new-password"
          className="block text-sm font-medium text-slate-800"
        >
          New password
        </label>

        <div className="relative mt-2">
          <input
            id="new-password"
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
                ? "new-password-requirements new-password-error"
                : "new-password-requirements"
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
                ? "Hide new password"
                : "Show new password"
            }
            aria-pressed={
              showPassword
            }
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
          id="new-password-requirements"
          className="mt-2 text-xs leading-5 text-slate-500"
        >
          Use 12–128 characters with uppercase,
          lowercase, number and special character.
        </p>

        <FieldErrors
          id="new-password-error"
          errors={passwordErrors}
        />
      </div>

      <div>
        <label
          htmlFor="confirm-password"
          className="block text-sm font-medium text-slate-800"
        >
          Confirm new password
        </label>

        <div className="relative mt-2">
          <input
            id="confirm-password"
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
                ? "confirm-password-error"
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

        <FieldErrors
          id="confirm-password-error"
          errors={confirmationErrors}
        />
      </div>

      <SubmitButton />
    </form>
  );
}