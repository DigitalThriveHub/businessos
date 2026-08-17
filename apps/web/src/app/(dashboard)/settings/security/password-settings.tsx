"use client";

import {
  type FormEvent,
  useState,
} from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type FieldErrors = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

type StatusMessage = {
  type: "idle" | "error" | "success";
  message?: string;
};

function validatePasswordForm(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!currentPassword) {
    errors.currentPassword =
      "Enter your current password.";
  } else if (
    currentPassword.length > 1_024
  ) {
    errors.currentPassword =
      "The current password is too long.";
  }

  if (newPassword.length < 12) {
    errors.newPassword =
      "Use at least 12 characters.";
  } else if (
    newPassword.length > 128
  ) {
    errors.newPassword =
      "Use no more than 128 characters.";
  } else if (
    !/[a-z]/.test(newPassword)
  ) {
    errors.newPassword =
      "Add a lowercase letter.";
  } else if (
    !/[A-Z]/.test(newPassword)
  ) {
    errors.newPassword =
      "Add an uppercase letter.";
  } else if (
    !/\d/.test(newPassword)
  ) {
    errors.newPassword =
      "Add a number.";
  } else if (
    !/[^A-Za-z0-9]/.test(newPassword)
  ) {
    errors.newPassword =
      "Add a special character.";
  } else if (
    newPassword === currentPassword
  ) {
    errors.newPassword =
      "Choose a password different from your current password.";
  }

  if (!confirmPassword) {
    errors.confirmPassword =
      "Confirm your new password.";
  } else if (
    newPassword !== confirmPassword
  ) {
    errors.confirmPassword =
      "The passwords do not match.";
  }

  return errors;
}

function resolveUpdateError(
  errorCode?: string,
): string {
  switch (
    errorCode?.toLowerCase()
  ) {
    case "invalid_credentials":
    case "reauthentication_not_valid":
      return "Your current password is incorrect.";

    case "same_password":
      return "Choose a password different from your current password.";

    case "weak_password":
      return "Choose a stronger password that has not been compromised or commonly used.";

    case "session_not_found":
    case "refresh_token_not_found":
      return "Your session has expired. Sign in again before changing your password.";

    default:
      return "Your password could not be changed. Please try again.";
  }
}

export function PasswordSettings() {
  const [
    currentPassword,
    setCurrentPassword,
  ] = useState("");

  const [
    newPassword,
    setNewPassword,
  ] = useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    showCurrentPassword,
    setShowCurrentPassword,
  ] = useState(false);

  const [
    showNewPassword,
    setShowNewPassword,
  ] = useState(false);

  const [
    showConfirmation,
    setShowConfirmation,
  ] = useState(false);

  const [
    fieldErrors,
    setFieldErrors,
  ] = useState<FieldErrors>({});

  const [status, setStatus] =
    useState<StatusMessage>({
      type: "idle",
    });

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const validationErrors =
      validatePasswordForm(
        currentPassword,
        newPassword,
        confirmPassword,
      );

    setFieldErrors(
      validationErrors,
    );
    setStatus({
      type: "idle",
    });

    if (
      Object.keys(validationErrors)
        .length > 0
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase =
        createClient();

      const {
        data: { user },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (
        userError ||
        !user
      ) {
        window.location.replace(
          "/login?returnTo=%2Fsettings%2Fsecurity",
        );
        return;
      }

      const {
        data: assurance,
        error: assuranceError,
      } =
        await supabase.auth.mfa
          .getAuthenticatorAssuranceLevel();

      if (
        assuranceError ||
        !assurance.currentLevel ||
        !assurance.nextLevel
      ) {
        setStatus({
          type: "error",
          message:
            "Your authentication level could not be verified. Please try again.",
        });
        return;
      }

      if (
        assurance.currentLevel ===
          "aal1" &&
        assurance.nextLevel ===
          "aal2"
      ) {
        window.location.assign(
          "/mfa/challenge?returnTo=%2Fsettings%2Fsecurity",
        );
        return;
      }

      const {
        error: updateError,
      } =
        await supabase.auth.updateUser({
          current_password:
            currentPassword,
          password: newPassword,
        });

      if (updateError) {
        setCurrentPassword("");

        setStatus({
          type: "error",
          message:
            resolveUpdateError(
              updateError.code,
            ),
        });

        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFieldErrors({});

      setStatus({
        type: "success",
        message:
          "Password changed successfully. Signing you out securely...",
      });

      /*
       * Revoke refreshable sessions after a password change.
       */
      const { error: signOutError } =
        await supabase.auth.signOut({
          scope: "global",
        });

      if (signOutError) {
        await supabase.auth.signOut({
          scope: "local",
        });
      }

      window.location.replace(
        "/login",
      );
    } catch {
      setStatus({
        type: "error",
        message:
          "The secure authentication service is temporarily unavailable.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="password-settings-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
          <KeyRound
            aria-hidden="true"
            className="h-5 w-5"
          />
        </div>

        <div>
          <h2
            id="password-settings-heading"
            className="text-lg font-semibold"
          >
            Change password
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-600">
            Confirm your current password
            before choosing a new one.
          </p>
        </div>
      </div>

      {status.type !== "idle" &&
        status.message && (
          <div
            role={
              status.type === "error"
                ? "alert"
                : "status"
            }
            aria-live="polite"
            className={
              status.type === "error"
                ? "mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
                : "mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
            }
          >
            {status.type ===
              "error" && (
              <AlertCircle
                aria-hidden="true"
                className="h-5 w-5 shrink-0"
              />
            )}

            <p>{status.message}</p>
          </div>
        )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-7 space-y-5"
      >
        <PasswordField
          id="current-password"
          name="currentPassword"
          label="Current password"
          value={currentPassword}
          onChange={
            setCurrentPassword
          }
          visible={
            showCurrentPassword
          }
          onToggle={() =>
            setShowCurrentPassword(
              (visible) => !visible,
            )
          }
          autoComplete="current-password"
          error={
            fieldErrors.currentPassword
          }
          disabled={isSubmitting}
        />

        <PasswordField
          id="new-account-password"
          name="newPassword"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          visible={showNewPassword}
          onToggle={() =>
            setShowNewPassword(
              (visible) => !visible,
            )
          }
          autoComplete="new-password"
          error={
            fieldErrors.newPassword
          }
          disabled={isSubmitting}
          help="Use 12–128 characters with uppercase, lowercase, number and special character."
        />

        <PasswordField
          id="confirm-account-password"
          name="confirmPassword"
          label="Confirm new password"
          value={confirmPassword}
          onChange={
            setConfirmPassword
          }
          visible={showConfirmation}
          onToggle={() =>
            setShowConfirmation(
              (visible) => !visible,
            )
          }
          autoComplete="new-password"
          error={
            fieldErrors.confirmPassword
          }
          disabled={isSubmitting}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />

              Changing password...
            </>
          ) : (
            "Change password"
          )}
        </button>
      </form>
    </section>
  );
}

type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete:
    | "current-password"
    | "new-password";
  error?: string;
  help?: string;
  disabled: boolean;
};

function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
  error,
  help,
  disabled,
}: PasswordFieldProps) {
  const errorId =
    error
      ? `${id}-error`
      : undefined;

  const helpId =
    help
      ? `${id}-help`
      : undefined;

  const describedBy = [
    helpId,
    errorId,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-slate-800"
      >
        {label}
      </label>

      <div className="relative mt-2">
        <input
          id={id}
          name={name}
          type={
            visible
              ? "text"
              : "password"
          }
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value,
            )
          }
          autoComplete={autoComplete}
          required
          maxLength={
            autoComplete ===
            "current-password"
              ? 1_024
              : 128
          }
          disabled={disabled}
          aria-invalid={
            error
              ? true
              : undefined
          }
          aria-describedby={
            describedBy
          }
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid=true]:border-red-500"
        />

        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {visible ? (
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

      {help && (
        <p
          id={helpId}
          className="mt-2 text-xs leading-5 text-slate-500"
        >
          {help}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}