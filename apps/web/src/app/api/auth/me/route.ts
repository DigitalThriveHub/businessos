/**
 * Current authenticated user route.
 *
 * Security:
 * - Reads the session from secure Supabase cookies.
 * - Never accepts tokens, roles, or organisation IDs from browser input.
 * - NestJS independently validates the JWT and resolves RBAC.
 * - Sensitive upstream errors are not exposed.
 */

import { NextResponse } from "next/server";

import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      return NextResponse.json(
        {
          message: "Authentication is required.",
        },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    // NestJS validates this token independently and resolves the user's
    // organisation, membership, roles, and permissions.
    const currentUser = await apiFetch("/auth/me", {
      method: "GET",
      accessToken: session.access_token,
      timeoutMs: 10_000,
    });

    return NextResponse.json(currentUser, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;

    return NextResponse.json(
      {
        message:
          status === 401
            ? "Authentication is required."
            : status === 403
              ? "You do not have access to this workspace."
              : status === 504
                ? "The account service timed out."
                : "The account service is temporarily unavailable.",
      },
      {
        status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}