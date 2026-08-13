/**
 * BusinessOS login Server Action.
 *
 * Purpose:
 * - Validates login input on the server.
 * - Authenticates users through Supabase.
 * - Creates secure server-managed authentication cookies.
 * - Redirects authenticated users only to safe internal routes.
 *
 * Security:
 * - Returns neutral errors to prevent account enumeration.
 * - Never logs credentials, tokens or authentication cookies.
 * - Never accepts roles, permissions or organisation IDs from the browser.
 * - RBAC and organisation access remain enforced by the NestJS API.
 */

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

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

function getSafeReturnPath(value?: string): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  ) {
    return "/dashboard";
  }

  try {
    const trustedOrigin = "https://businessos.invalid";
    const parsed = new URL(value, trustedOrigin);

    if (parsed.origin !== trustedOrigin) {
      return "/dashboard";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
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
    const errors = validation.error.flatten().fieldErrors;

    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: {
        email: errors.email,
        password: errors.password,
      },
    };
  }

  const { email, password, returnTo } = validation.data;
  const supabase = await createClient();

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        status: "error",
        message:
          "We could not sign you in with those details. Check your email and password and try again.",
      };
    }
  } catch {
    return {
      status: "error",
      message:
        "The secure sign-in service is temporarily unavailable. Please try again.",
    };
  }

  redirect(getSafeReturnPath(returnTo));
}