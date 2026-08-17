/**
 * Secure password replacement Server Action.
 *
 * Security:
 * - Requires a server-validated Supabase user.
 * - Requires AAL2 when the account has verified MFA.
 * - Enforces strong password requirements.
 * - Never logs or returns passwords.
 * - Signs out refreshable sessions after success.
 */

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const passwordSchema = z
  .string()
  .min(
    12,
    "Password must contain at least 12 characters.",
  )
  .max(
    128,
    "Password must contain no more than 128 characters.",
  )
  .refine(
    (value) => /[a-z]/.test(value),
    "Password must contain a lowercase letter.",
  )
  .refine(
    (value) => /[A-Z]/.test(value),
    "Password must contain an uppercase letter.",
  )
  .refine(
    (value) => /\d/.test(value),
    "Password must contain a number.",
  )
  .refine(
    (value) =>
      /[^A-Za-z0-9]/.test(value),
    "Password must contain a special character.",
  );

const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z
      .string()
      .min(
        1,
        "Confirm your new password.",
      )
      .max(
        128,
        "Password confirmation is too long.",
      ),
  })
  .superRefine(
    (
      {
        password,
        confirmPassword,
      },
      context,
    ) => {
      if (
        password !==
        confirmPassword
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmPassword"],
          message:
            "The passwords do not match.",
        });
      }
    },
  );

export type ResetPasswordActionState = {
  status:
    | "idle"
    | "success"
    | "error";
  message?: string;
  fieldErrors?: {
    password?: string[];
    confirmPassword?: string[];
  };
};

function errorState(
  message: string,
): ResetPasswordActionState {
  return {
    status: "error",
    message,
  };
}

export async function resetPassword(
  _previousState: ResetPasswordActionState,
  formData: FormData,
): Promise<ResetPasswordActionState> {
  const validation =
    resetPasswordSchema.safeParse({
      password:
        formData.get("password"),
      confirmPassword:
        formData.get(
          "confirmPassword",
        ),
    });

  if (!validation.success) {
    return {
      status: "error",
      message:
        "Check the highlighted fields and try again.",
      fieldErrors:
        validation.error.flatten()
          .fieldErrors,
    };
  }

  let supabase:
    Awaited<
      ReturnType<typeof createClient>
    >;

  try {
    supabase =
      await createClient();
  } catch {
    return errorState(
      "The secure account service is temporarily unavailable.",
    );
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
    return errorState(
      "This password-recovery session is invalid or has expired. Request a new recovery link.",
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
    return errorState(
      "Your authentication level could not be verified. Please try again.",
    );
  }

  /*
   * An enrolled authenticator must be completed before
   * changing the account password.
   */
  if (
    assurance.currentLevel ===
      "aal1" &&
    assurance.nextLevel === "aal2"
  ) {
    redirect(
      "/mfa/challenge?returnTo=%2Freset-password",
    );
  }

  const {
    error: updateError,
  } =
    await supabase.auth.updateUser({
      password:
        validation.data.password,
    });

  if (updateError) {
    const errorCode =
      (
        updateError as {
          code?: string;
        }
      ).code?.toLowerCase();

    if (
      errorCode ===
        "weak_password" ||
      errorCode ===
        "same_password"
    ) {
      return {
        status: "error",
        message:
          "Choose a stronger password that you have not used for this account.",
        fieldErrors: {
          password: [
            "This password could not be accepted.",
          ],
        },
      };
    }

    return errorState(
      "Your password could not be updated. The recovery link may have expired; request a new one and try again.",
    );
  }

  /*
   * Revoke refreshable sessions after changing the password.
   * The user must authenticate again using the new password.
   */
  try {
    await supabase.auth.signOut({
      scope: "global",
    });
  } catch {
    /*
     * The password has already been replaced. Do not expose
     * internal sign-out details or reverse the successful update.
     */
  }

  return {
    status: "success",
    message:
      "Your password has been updated securely. Sign in again using your new password.",
  };
}