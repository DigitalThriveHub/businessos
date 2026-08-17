import {
  NextResponse,
  type NextRequest,
} from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RECOVERY_DESTINATION =
  "/reset-password";

function createRedirect(
  request: NextRequest,
  pathname: string,
  parameters?: Record<string, string>,
): NextResponse {
  const url = request.nextUrl.clone();

  url.pathname = pathname;
  url.search = "";

  Object.entries(parameters ?? {}).forEach(
    ([key, value]) => {
      url.searchParams.set(key, value);
    },
  );

  const response =
    NextResponse.redirect(url, 303);

  response.headers.set(
    "Cache-Control",
    "no-store, private",
  );
  response.headers.set(
    "Pragma",
    "no-cache",
  );
  response.headers.set(
    "Referrer-Policy",
    "no-referrer",
  );
  response.headers.set(
    "X-Content-Type-Options",
    "nosniff",
  );

  return response;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  const code =
    request.nextUrl.searchParams
      .get("code")
      ?.trim();

  if (!code || code.length > 4_096) {
    return createRedirect(
      request,
      "/forgot-password",
      {
        error:
          "recovery_link_invalid",
      },
    );
  }

  const requestedDestination =
    request.nextUrl.searchParams.get(
      "next",
    );

  const destination =
    requestedDestination ===
    RECOVERY_DESTINATION
      ? RECOVERY_DESTINATION
      : "/dashboard";

  try {
    const supabase =
      await createClient();

    const {
      data: exchangeData,
      error: exchangeError,
    } =
      await supabase.auth
        .exchangeCodeForSession(code);

    if (
      exchangeError ||
      !exchangeData.session ||
      !exchangeData.user
    ) {
      return createRedirect(
        request,
        "/forgot-password",
        {
          error:
            "recovery_link_invalid",
        },
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
      (
        assurance.currentLevel ===
          "aal1" &&
        assurance.nextLevel ===
          "aal2"
      )
    ) {
      return createRedirect(
        request,
        "/mfa/challenge",
        {
          returnTo: destination,
        },
      );
    }

    return createRedirect(
      request,
      destination,
    );
  } catch {
    return createRedirect(
      request,
      "/forgot-password",
      {
        error:
          "recovery_unavailable",
      },
    );
  }
}