/**
 * Current authenticated user route.
 *
 * Security:
 * - Reads authentication from secure Supabase cookies.
 * - Never accepts an access token, role or organisation ID from the browser.
 * - The NestJS API independently validates the JWT and resolves RBAC.
 * - Sensitive upstream errors are not exposed to the browser.
 */

import { NextResponse } from "next/server";
import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { message: "Authentication is required." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    return NextResponse.json(
      { message: "Your secure session has expired." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const currentUser = await apiFetch<unknown>("/api/v1/auth/me", {
      accessToken: session.access_token,
    });

    return NextResponse.json(currentUser, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;

    return NextResponse.json(
      {
        message:
          status === 401 || status === 403
            ? "Access could not be verified."
            : "The account service is temporarily unavailable.",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}