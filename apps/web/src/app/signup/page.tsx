import type { Metadata } from "next";
import {
  AlertCircle,
} from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { getSafePostAuthenticationPath } from "@/lib/security/safe-return-path";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title:
    "Create account | BusinessOS",
  description:
    "Create a secure BusinessOS account and continue to your authorised organisation invitation.",
  robots:
    "noindex, nofollow, noarchive",
  referrer: "no-referrer",
};

export const dynamic =
  "force-dynamic";

type SignupPageProps = {
  searchParams: Promise<{
    returnTo?:
      | string
      | string[];
    error?:
      | string
      | string[];
  }>;
};

function firstParameter(
  value:
    | string
    | string[]
    | undefined,
): string | undefined {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.length === 1
    ? value[0]
    : undefined;
}

function resolveConfirmationError(
  value: string | undefined,
): string | null {
  switch (value) {
    case "confirmation_link_invalid":
      return "This email-confirmation link is invalid, expired or has already been used. Create the account again to request a new secure link, or sign in if the account is already confirmed.";

    case "confirmation_unavailable":
      return "Email confirmation is temporarily unavailable. Please try again shortly.";

    default:
      return null;
  }
}

function isInvitationReturnPath(
  value: string,
): boolean {
  return (
    value ===
      "/invitations/accept" ||
    value.startsWith(
      "/invitations/accept?",
    ) ||
    value === "/portal/invitations/accept" ||
    value.startsWith("/portal/invitations/accept?")
  );
}

export default async function SignupPage({
  searchParams,
}: SignupPageProps) {
  const parameters =
    await searchParams;

  const returnTo =
    getSafePostAuthenticationPath(
      firstParameter(
        parameters.returnTo,
      ),
    );

  const confirmationError =
    resolveConfirmationError(
      firstParameter(
        parameters.error,
      ),
    );

  const invitationFlow =
    isInvitationReturnPath(
      returnTo,
    );

  return (
    <AuthShell
      title="Create your account"
      description={
        invitationFlow ? (
          <p>
            Create an account using the exact
            email address that received your
            organisation invitation.
          </p>
        ) : (
          <p>
            Create a secure BusinessOS
            account to begin your authorised
            workspace setup.
          </p>
        )
      }
    >
      {confirmationError && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />

          <p>
            {confirmationError}
          </p>
        </div>
      )}

      <SignupForm
        returnTo={returnTo}
      />
    </AuthShell>
  );
}
