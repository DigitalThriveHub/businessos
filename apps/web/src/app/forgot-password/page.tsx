import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title:
    "Forgot Password | BusinessOS",
  description:
    "Request a secure BusinessOS password-reset link.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

function resolveRecoveryError(
  value:
    | string
    | string[]
    | undefined,
): string | null {
  const errorCode =
    Array.isArray(value)
      ? value[0]
      : value;

  switch (errorCode) {
    case "recovery_link_invalid":
      return "This password-recovery link is invalid, has expired or has already been used. Request a new secure link.";

    case "recovery_unavailable":
      return "Password recovery is temporarily unavailable. Please request a new link and try again.";

    default:
      return null;
  }
}

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const parameters =
    await searchParams;

  const recoveryError =
    resolveRecoveryError(
      parameters.error,
    );

  return (
    <AuthShell
      title="Forgot your password?"
      description={
        <p>
          Enter your account email and we
          will send a short-lived link that
          allows you to choose a new
          password securely.
        </p>
      }
      backHref="/login"
      backLabel="Back to sign in"
    >
      {recoveryError && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />

          <p>{recoveryError}</p>
        </div>
      )}

      <ForgotPasswordForm />
    </AuthShell>
  );
}