/**
 * Password-recovery Server Action.
 *
 * Security:
 * - Validates and normalises the submitted email.
 * - Uses a trusted application origin for recovery links.
 * - Returns a neutral response to prevent account enumeration.
 * - Never logs email addresses, passwords or recovery tokens.
 * - Supabase applies its authentication rate limits.
 */

"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required.")
    .email("Enter a valid email address.")
    .max(254, "Email address is too long.")
    .transform((value) =>
      value.toLowerCase(),
    ),
});

export type ForgotPasswordActionState = {
  status:
    | "idle"
    | "success"
    | "error";
  message?: string;
  fieldErrors?: {
    email?: string[];
  };
};

const NEUTRAL_SUCCESS_MESSAGE =
  "If an account exists for that email address, a secure password-reset link has been sent.";

function parseConfiguredOrigin(
  value: string,
): string {
  const parsed = new URL(value);

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "The configured application URL is invalid.",
    );
  }

  const isHttps =
    parsed.protocol === "https:";

  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost"
    );

  if (
    !isHttps &&
    !isLocalDevelopment
  ) {
    throw new Error(
      "The application URL must use HTTPS.",
    );
  }

  return parsed.origin;
}

async function getApplicationOrigin():
  Promise<string> {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  if (configuredOrigin?.trim()) {
    return parseConfiguredOrigin(
      configuredOrigin.trim(),
    );
  }

  /*
   * Development-only fallback supports whichever local port
   * Next.js is currently using. Production must explicitly
   * configure NEXT_PUBLIC_APP_URL.
   */
  if (
    process.env.NODE_ENV !== "production"
  ) {
    const requestHeaders =
      await headers();

    const requestOrigin =
      requestHeaders.get("origin");

    if (requestOrigin) {
      return parseConfiguredOrigin(
        requestOrigin,
      );
    }

    return "http://127.0.0.1:3000";
  }

  throw new Error(
    "NEXT_PUBLIC_APP_URL is required in production.",
  );
}

function createRecoveryRedirectUrl(
  applicationOrigin: string,
): string {
  const callbackUrl = new URL(
    "/auth/callback",
    applicationOrigin,
  );

  callbackUrl.searchParams.set(
    "next",
    "/reset-password",
  );

  return callbackUrl.toString();
}

export async function requestPasswordReset(
  _previousState: ForgotPasswordActionState,
  formData: FormData,
): Promise<ForgotPasswordActionState> {
  const validation =
    forgotPasswordSchema.safeParse({
      email: formData.get("email"),
    });

  if (!validation.success) {
    return {
      status: "error",
      message:
        "Check the highlighted field and try again.",
      fieldErrors:
        validation.error.flatten()
          .fieldErrors,
    };
  }

  try {
    const applicationOrigin =
      await getApplicationOrigin();

    const supabase =
      await createClient();

    /*
     * Never vary the browser response based on whether the
     * account exists or whether Supabase accepted the request.
     */
    await supabase.auth.resetPasswordForEmail(
      validation.data.email,
      {
        redirectTo:
          createRecoveryRedirectUrl(
            applicationOrigin,
          ),
      },
    );

    return {
      status: "success",
      message:
        NEUTRAL_SUCCESS_MESSAGE,
    };
  } catch {
    /*
     * Configuration or service failures are still presented
     * without disclosing whether an account exists.
     */
    return {
      status: "error",
      message:
        "Password recovery is temporarily unavailable. Please try again shortly.",
    };
  }
}