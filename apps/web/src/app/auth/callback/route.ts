import {
  NextResponse,
  type NextRequest,
} from "next/server";

import {
  getMfaChallengePath,
  getSafePostAuthenticationPath,
} from "@/lib/security/safe-return-path";
import { createClient } from "@/lib/supabase/server";

export const dynamic =
  "force-dynamic";

const DEFAULT_DESTINATION =
  "/dashboard";

const RECOVERY_DESTINATION =
  "/reset-password";

type CallbackFlow =
  | "recovery"
  | "signup";

type ParameterResult = {
  valid: boolean;
  value: string | null;
};

function readSingleParameter(
  request: NextRequest,
  name: string,
  options: {
    required: boolean;
    maxLength: number;
  },
): ParameterResult {
  const values =
    request.nextUrl.searchParams
      .getAll(name);

  if (values.length === 0) {
    return {
      valid: !options.required,
      value: null,
    };
  }

  if (values.length !== 1) {
    return {
      valid: false,
      value: null,
    };
  }

  const value =
    values[0]?.trim() ?? "";

  if (
    !value ||
    value.length >
      options.maxLength ||
    /[\u0000-\u001f\u007f]/.test(
      value,
    )
  ) {
    return {
      valid: false,
      value: null,
    };
  }

  return {
    valid: true,
    value,
  };
}

function createRedirect(
  request: NextRequest,
  destination: string,
  parameters?: Record<
    string,
    string
  >,
): NextResponse {
  const baseUrl =
    request.nextUrl.clone();

  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  let destinationUrl: URL;

  try {
    destinationUrl = new URL(
      destination,
      baseUrl.origin,
    );
  } catch {
    destinationUrl = new URL(
      DEFAULT_DESTINATION,
      baseUrl.origin,
    );
  }

  if (
    destinationUrl.origin !==
      baseUrl.origin ||
    !destinationUrl.pathname
      .startsWith("/") ||
    destinationUrl.pathname
      .startsWith("//")
  ) {
    destinationUrl = new URL(
      DEFAULT_DESTINATION,
      baseUrl.origin,
    );
  }

  Object.entries(
    parameters ?? {},
  ).forEach(([key, value]) => {
    destinationUrl.searchParams.set(
      key,
      value,
    );
  });

  const response =
    NextResponse.redirect(
      destinationUrl,
      303,
    );

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

  response.headers.set(
    "X-Robots-Tag",
    "noindex, nofollow, noarchive",
  );

  return response;
}

function signupDestination(
  requestedDestination:
    | string
    | null,
): string {
  const destination =
    getSafePostAuthenticationPath(
      requestedDestination,
    );

  const destinationUrl = new URL(
    destination,
    "https://businessos.invalid",
  );

  const blockedSignupRoutes = [
    "/reset-password",
    "/forgot-password",
    "/auth",
  ] as const;

  if (
    blockedSignupRoutes.some(
      (route) =>
        destinationUrl.pathname ===
          route ||
        destinationUrl.pathname
          .startsWith(
            `${route}/`,
          ),
    )
  ) {
    return DEFAULT_DESTINATION;
  }

  return destination;
}

function failureRedirect(
  request: NextRequest,
  flow: CallbackFlow,
  destination: string,
  unavailable: boolean,
): NextResponse {
  if (flow === "signup") {
    return createRedirect(
      request,
      "/signup",
      {
        error: unavailable
          ? "confirmation_unavailable"
          : "confirmation_link_invalid",
        returnTo: destination,
      },
    );
  }

  return createRedirect(
    request,
    "/forgot-password",
    {
      error: unavailable
        ? "recovery_unavailable"
        : "recovery_link_invalid",
    },
  );
}

async function clearLocalSession(
  supabase: Awaited<
    ReturnType<
      typeof createClient
    >
  >,
): Promise<void> {
  try {
    await supabase.auth.signOut({
      scope: "local",
    });
  } catch {
    // Preserve the original callback failure.
  }
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  const codeParameter =
    readSingleParameter(
      request,
      "code",
      {
        required: true,
        maxLength: 4_096,
      },
    );

  const flowParameter =
    readSingleParameter(
      request,
      "flow",
      {
        required: false,
        maxLength: 32,
      },
    );

  const nextParameter =
    readSingleParameter(
      request,
      "next",
      {
        required: true,
        maxLength: 2_048,
      },
    );

  const isSignupFlow =
    flowParameter.valid &&
    flowParameter.value ===
      "signup";

  const isRecoveryFlow =
    flowParameter.valid &&
    flowParameter.value ===
      null &&
    nextParameter.valid &&
    nextParameter.value ===
      RECOVERY_DESTINATION;

  const flow: CallbackFlow =
    isSignupFlow
      ? "signup"
      : "recovery";

  const destination =
    isSignupFlow
      ? signupDestination(
          nextParameter.valid
            ? nextParameter.value
            : null,
        )
      : RECOVERY_DESTINATION;

  if (
    !codeParameter.valid ||
    !codeParameter.value ||
    !nextParameter.valid ||
    (
      !isSignupFlow &&
      !isRecoveryFlow
    )
  ) {
    return failureRedirect(
      request,
      flow,
      destination,
      false,
    );
  }

  let supabase: Awaited<
    ReturnType<
      typeof createClient
    >
  > | null = null;

  let sessionExchanged = false;

  try {
    supabase =
      await createClient();

    const {
      data: exchangeData,
      error: exchangeError,
    } =
      await supabase.auth
        .exchangeCodeForSession(
          codeParameter.value,
        );

    if (
      exchangeError ||
      !exchangeData.session ||
      !exchangeData.user
    ) {
      return failureRedirect(
        request,
        flow,
        destination,
        false,
      );
    }

    sessionExchanged = true;

    if (
      !exchangeData.user.email ||
      !exchangeData.user
        .email_confirmed_at
    ) {
      await clearLocalSession(
        supabase,
      );

      return failureRedirect(
        request,
        flow,
        destination,
        false,
      );
    }

    const {
      data: assurance,
      error: assuranceError,
    } =
      await supabase.auth.mfa
        .getAuthenticatorAssuranceLevel();

    if (assuranceError) {
      await clearLocalSession(
        supabase,
      );

      return failureRedirect(
        request,
        flow,
        destination,
        true,
      );
    }

    if (
      assurance.currentLevel ===
        "aal1" &&
      assurance.nextLevel ===
        "aal2"
    ) {
      return createRedirect(
        request,
        getMfaChallengePath(
          destination,
        ),
      );
    }

    const validAssuranceLevel =
      (
        assurance.currentLevel ===
          "aal1" &&
        assurance.nextLevel ===
          "aal1"
      ) ||
      (
        assurance.currentLevel ===
          "aal2" &&
        assurance.nextLevel ===
          "aal2"
      );

    if (!validAssuranceLevel) {
      await clearLocalSession(
        supabase,
      );

      return failureRedirect(
        request,
        flow,
        destination,
        true,
      );
    }

    return createRedirect(
      request,
      destination,
    );
  } catch {
    if (
      supabase &&
      sessionExchanged
    ) {
      await clearLocalSession(
        supabase,
      );
    }

    return failureRedirect(
      request,
      flow,
      destination,
      true,
    );
  }
}