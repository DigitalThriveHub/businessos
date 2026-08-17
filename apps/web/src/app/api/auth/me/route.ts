/**
 * Current authenticated user route.
 *
 * Security:
 * - Reads the session from secure Supabase cookies.
 * - Never accepts access tokens, roles or organisation IDs from input.
 * - Validates same-origin mutation requests.
 * - Limits and validates JSON request bodies.
 * - NestJS independently validates JWT, DTO and database policy.
 * - Sensitive upstream errors are never exposed.
 */

import {
  type NextRequest,
  NextResponse,
} from "next/server";

import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const AUTH_ME_ENDPOINT = "/api/v1/auth/me";
const MAX_PROFILE_BODY_BYTES = 8_192;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function jsonMessage(
  message: string,
  status: number,
) {
  return NextResponse.json(
    { message },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

async function getAccessToken():
  Promise<string | null> {
  const supabase = await createClient();

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    return null;
  }

  return session.access_token;
}

function isSameOrigin(
  request: NextRequest,
): boolean {
  const fetchSite = request.headers
    .get("sec-fetch-site")
    ?.toLowerCase();

  if (
    fetchSite &&
    fetchSite !== "same-origin"
  ) {
    return false;
  }

  const originHeader =
    request.headers.get("origin");

  if (!originHeader) {
    return fetchSite === "same-origin";
  }

  const requestHost = request.headers
    .get("host")
    ?.trim()
    .toLowerCase();

  if (!requestHost) {
    return false;
  }

  try {
    const origin = new URL(originHeader);

    return (
      origin.host.toLowerCase() ===
      requestHost
    );
  } catch {
    return false;
  }
}

function upstreamErrorResponse(
  error: unknown,
) {
  const upstreamStatus =
    error instanceof ApiError
      ? error.status
      : 500;

  switch (upstreamStatus) {
    case 400:
      return jsonMessage(
        "Check the profile details and try again.",
        400,
      );

    case 401:
      return jsonMessage(
        "Authentication is required.",
        401,
      );

    case 403:
      return jsonMessage(
        "This account cannot perform that action.",
        403,
      );

    case 413:
      return jsonMessage(
        "The profile update is too large.",
        413,
      );

    case 422:
      return jsonMessage(
        "The profile details could not be accepted.",
        422,
      );

    case 429:
      return jsonMessage(
        "Too many requests. Please try again shortly.",
        429,
      );

    case 504:
      return jsonMessage(
        "The account service timed out.",
        504,
      );

    case 404:
    case 502:
    case 503:
      return jsonMessage(
        "The account service is temporarily unavailable.",
        503,
      );

    default:
      return jsonMessage(
        "The account service is temporarily unavailable.",
        500,
      );
  }
}

export async function GET() {
  try {
    const accessToken =
      await getAccessToken();

    if (!accessToken) {
      return jsonMessage(
        "Authentication is required.",
        401,
      );
    }

    const currentUser = await apiFetch(
      AUTH_ME_ENDPOINT,
      {
        method: "GET",
        accessToken,
        timeoutMs: 10_000,
      },
    );

    return NextResponse.json(currentUser, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
) {
  if (!isSameOrigin(request)) {
    return jsonMessage(
      "The request origin could not be verified.",
      403,
    );
  }

  const contentType =
    request.headers.get("content-type");

  if (
    !contentType
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return jsonMessage(
      "Content-Type must be application/json.",
      415,
    );
  }

  const declaredLength = Number(
    request.headers.get("content-length"),
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROFILE_BODY_BYTES
  ) {
    return jsonMessage(
      "The profile update is too large.",
      413,
    );
  }

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return jsonMessage(
      "The request body could not be read.",
      400,
    );
  }

  if (
    new TextEncoder().encode(rawBody).byteLength >
    MAX_PROFILE_BODY_BYTES
  ) {
    return jsonMessage(
      "The profile update is too large.",
      413,
    );
  }

  let profilePatch: unknown;

  try {
    profilePatch = JSON.parse(rawBody);
  } catch {
    return jsonMessage(
      "The request body must contain valid JSON.",
      400,
    );
  }

  if (
    typeof profilePatch !== "object" ||
    profilePatch === null ||
    Array.isArray(profilePatch)
  ) {
    return jsonMessage(
      "The profile update must be an object.",
      400,
    );
  }

  try {
    const accessToken =
      await getAccessToken();

    if (!accessToken) {
      return jsonMessage(
        "Authentication is required.",
        401,
      );
    }

    const updatedProfile = await apiFetch(
      AUTH_ME_ENDPOINT,
      {
        method: "PATCH",
        accessToken,
        timeoutMs: 10_000,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profilePatch),
      },
    );

    return NextResponse.json(
      updatedProfile,
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}