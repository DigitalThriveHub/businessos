/**
 * BusinessOS login Server Action.
 *
 * Security:
 * - Validates login input on the server.
 * - Authenticates through Supabase.
 * - Detects enrolled MFA factors through the session AAL.
 * - Redirects AAL1 sessions requiring verification to the MFA challenge.
 * - Prevents external or authentication-flow redirect targets.
 * - Returns neutral errors to prevent account enumeration.
 */

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  getMfaChallengePath,
  getSafePostAuthenticationPath,
} from "@/lib/security/safe-return-path";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required.")
    .email("Enter a valid email address.")
    .max(254, "Email address is too long.")
    .transform((value) => value.toLowerCase()),

  password: z
    .string()
    .min(1, "Password is required.")
    .max(1_024, "Password is too long."),

  returnTo: z.string().max(2_048).optional(),
});

export type LoginActionState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: {
    email?: string[];
    password?: string[];
  };
};

async function clearLocalSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    await supabase.auth.signOut({
      scope: "local",
    });
  } catch {
    // Preserve the original authentication failure.
  }
}

export async function login(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const validation = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!validation.success) {
    const errors =
      validation.error.flatten().fieldErrors;

    return {
      status: "error",
      message:
        "Check the highlighted fields and try again.",
      fieldErrors: {
        email: errors.email,
        password: errors.password,
      },
    };
  }

  const { email, password, returnTo } =
    validation.data;

  const supabase = await createClient();
  const safeReturnPath =
    getSafePostAuthenticationPath(returnTo);

  let destination = safeReturnPath;

  try {
    const signInResult =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (signInResult.error) {
      return {
        status: "error",
        message:
          "We could not sign you in with those details. Check your email and password and try again.",
      };
    }

    const assuranceResult =
      await supabase.auth.mfa
        .getAuthenticatorAssuranceLevel();

    if (assuranceResult.error) {
      await clearLocalSession(supabase);

      return {
        status: "error",
        message:
          "The secure sign-in service is temporarily unavailable. Please try again.",
      };
    }

    const { currentLevel, nextLevel } =
      assuranceResult.data;

    if (
      currentLevel === "aal1" &&
      nextLevel === "aal2"
    ) {
      destination =
        getMfaChallengePath(safeReturnPath);
    } else if (
      !(
        (currentLevel === "aal1" &&
          nextLevel === "aal1") ||
        (currentLevel === "aal2" &&
          nextLevel === "aal2")
      )
    ) {
      await clearLocalSession(supabase);

      return {
        status: "error",
        message:
          "Your authentication session could not be verified. Please sign in again.",
      };
    }
  } catch {
    await clearLocalSession(supabase);

    return {
      status: "error",
      message:
        "The secure sign-in service is temporarily unavailable. Please try again.",
    };
  }

  redirect(destination);
}