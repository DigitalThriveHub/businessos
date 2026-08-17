import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/server";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title:
    "Reset Password | BusinessOS",
  description:
    "Securely choose a new BusinessOS account password.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

function AssuranceError() {
  return (
    <AuthShell
      title="Authentication unavailable"
      description={
        <p>
          We could not verify the security
          level of this recovery session.
        </p>
      }
      backHref="/forgot-password"
      backLabel="Request another recovery link"
    >
      <div
        role="alert"
        className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
      >
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0"
        />

        <p>
          Your password has not been changed.
          Retry the verification or request a
          new recovery email.
        </p>
      </div>

      <Link
        href="/reset-password"
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
      >
        <RefreshCw
          aria-hidden="true"
          className="h-4 w-4"
        />

        Retry verification
      </Link>
    </AuthShell>
  );
}

export default async function ResetPasswordPage() {
  let supabase:
    Awaited<
      ReturnType<typeof createClient>
    >;

  try {
    supabase =
      await createClient();
  } catch {
    return <AssuranceError />;
  }

  const {
    data: { user },
    error: userError,
  } =
    await supabase.auth.getUser();

  if (
    userError ||
    !user
  ) {
    redirect(
      "/forgot-password?error=recovery_link_invalid",
    );
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
    return <AssuranceError />;
  }

  if (
    assurance.currentLevel ===
      "aal1" &&
    assurance.nextLevel === "aal2"
  ) {
    redirect(
      "/mfa/challenge?returnTo=%2Freset-password",
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description={
        <p>
          Create a strong, unique password
          for your BusinessOS account. Your
          other refreshable sessions will be
          signed out after the change.
        </p>
      }
      backHref="/login"
      backLabel="Back to sign in"
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}