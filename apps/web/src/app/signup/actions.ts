/**
 * BusinessOS invitation-aware signup Server Action.
 *
 * Security:
 * - Validates and normalises all browser input on the server.
 * - Enforces the same password policy as password reset/change.
 * - Uses Supabase SSR/PKCE and a trusted callback origin.
 * - Preserves only a validated internal return path.
 * - Returns neutral duplicate-account responses.
 * - Never logs credentials, email addresses or invitation tokens.
 */

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getSafePostAuthenticationPath } from "@/lib/security/safe-return-path";
import { createClient } from "@/lib/supabase/server";

const CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f]/;

const signupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(
        1,
        "Email address is required.",
      )
      .email(
        "Enter a valid email address.",
      )
      .max(
        254,
        "Email address is too long.",
      )
      .transform((value) =>
        value.toLowerCase(),
      ),

    password: z
      .string()
      .min(
        12,
        "Use at least 12 characters.",
      )
      .max(
        128,
        "Use no more than 128 characters.",
      )
      .regex(
        /[a-z]/,
        "Add a lowercase letter.",
      )
      .regex(
        /[A-Z]/,
        "Add an uppercase letter.",
      )
      .regex(
        /\d/,
        "Add a number.",
      )
      .regex(
        /[^A-Za-z0-9]/,
        "Add a special character.",
      )
      .refine(
        (value) =>
          !CONTROL_CHARACTERS.test(
            value,
          ),
        "Password contains unsupported characters.",
      ),

    confirmPassword: z
      .string()
      .min(
        1,
        "Confirm your password.",
      )
      .max(
        128,
        "Password confirmation is too long.",
      ),

    returnTo: z
      .string()
      .max(2_048)
      .optional(),

    companyWebsite: z
      .string()
      .max(500)
      .optional(),
  })
  .strict()
  .superRefine(
    (value, context) => {
      if (
        value.password !==
        value.confirmPassword
      ) {
        context.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message:
            "The passwords do not match.",
        });
      }
    },
  );

export type SignupActionState = {
  status:
    | "idle"
    | "success"
    | "error";
  message?: string;
  fieldErrors?: {
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
};

const NEUTRAL_SUCCESS_MESSAGE =
  "If this email can be registered, a secure confirmation link has been sent. Check your inbox and spam folder, or sign in if you already have an account.";

const DUPLICATE_ACCOUNT_CODES =
  new Set([
    "email_exists",
    "user_already_exists",
  ]);

const RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

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
    process.env.NODE_ENV !==
      "production" &&
    parsed.protocol === "http:" &&
    (
      parsed.hostname ===
        "127.0.0.1" ||
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

  if (
    process.env.NODE_ENV !==
    "production"
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

function createSignupCallbackUrl(
  applicationOrigin: string,
  returnTo: string,
): string {
  const callbackUrl = new URL(
    "/auth/callback",
    applicationOrigin,
  );

  callbackUrl.searchParams.set(
    "flow",
    "signup",
  );

  callbackUrl.searchParams.set(
    "next",
    returnTo,
  );

  return callbackUrl.toString();
}

function registrationErrorMessage(
  code?: string,
): string {
  if (
    code &&
    RATE_LIMIT_CODES.has(code)
  ) {
    return "Too many registration attempts have been made. Wait a few minutes before trying again.";
  }

  if (code === "weak_password") {
    return "Choose a stronger password that has not been compromised or commonly used.";
  }

  if (
    code ===
    "email_address_invalid"
  ) {
    return "Enter a valid work email address.";
  }

  if (
    code ===
      "email_provider_disabled" ||
    code === "signup_disabled"
  ) {
    return "Account registration is temporarily unavailable.";
  }

  return "Secure account registration is temporarily unavailable. Please try again.";
}

export async function signup(
  _previousState: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const validation =
    signupSchema.safeParse({
      email: formData.get("email"),
      password:
        formData.get("password"),
      confirmPassword:
        formData.get(
          "confirmPassword",
        ),
      returnTo:
        formData.get("returnTo") ||
        undefined,
      companyWebsite:
        formData.get(
          "companyWebsite",
        ) || undefined,
    });

  if (!validation.success) {
    const errors =
      validation.error.flatten()
        .fieldErrors;

    return {
      status: "error",
      message:
        "Check the highlighted fields and try again.",
      fieldErrors: {
        email: errors.email,
        password: errors.password,
        confirmPassword:
          errors.confirmPassword,
      },
    };
  }

  const {
    email,
    password,
    returnTo,
    companyWebsite,
  } = validation.data;

  /*
   * A filled hidden field is treated neutrally so automated
   * submissions receive no useful account information.
   */
  if (companyWebsite) {
    return {
      status: "success",
      message:
        NEUTRAL_SUCCESS_MESSAGE,
    };
  }

  const safeReturnPath =
    getSafePostAuthenticationPath(
      returnTo,
    );

  let authenticatedImmediately =
    false;

  try {
    const applicationOrigin =
      await getApplicationOrigin();

    const supabase =
      await createClient();

    const { data, error } =
      await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo:
            createSignupCallbackUrl(
              applicationOrigin,
              safeReturnPath,
            ),
        },
      });

    if (error) {
      if (
        error.code &&
        DUPLICATE_ACCOUNT_CODES.has(
          error.code,
        )
      ) {
        return {
          status: "success",
          message:
            NEUTRAL_SUCCESS_MESSAGE,
        };
      }

      return {
        status: "error",
        message:
          registrationErrorMessage(
            error.code,
          ),
      };
    }

    authenticatedImmediately =
      Boolean(
        data.user &&
        data.session,
      );
  } catch {
    return {
      status: "error",
      message:
        "Secure account registration is temporarily unavailable. Please try again.",
    };
  }

  if (authenticatedImmediately) {
    redirect(safeReturnPath);
  }

  return {
    status: "success",
    message:
      NEUTRAL_SUCCESS_MESSAGE,
  };
}