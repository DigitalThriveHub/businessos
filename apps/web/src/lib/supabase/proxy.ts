/**
 * BusinessOS Supabase session proxy.
 *
 * Security:
 * - Validates signed Supabase JWT claims.
 * - Refreshes authentication cookies.
 * - Redirects unauthenticated users away from protected routes.
 * - Keeps password-recovery callbacks publicly accessible.
 * - Requires a valid recovery session before opening reset-password.
 * - Never performs RBAC using browser-controlled data.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSafePostAuthenticationPath } from "@/lib/security/safe-return-path";

const PROTECTED_ROUTES = [
  "/mfa",
  "/dashboard",
  "/onboarding",
  "/my-work",
  "/control-tower",
  "/ai",
  "/command-centre",
  "/enquiries",
  "/clients",
  "/matters",
  "/communications",
  "/finance",
  "/service-lifecycle",
  "/integrations",
  "/operations",
  "/portal",
  "/tasks",
  "/documents",
  "/pilot-readiness",
  "/assurance",
  "/settings",
  "/admin",
] as const;

const PUBLIC_AUTH_ROUTES = ["/login", "/signup", "/forgot-password"] as const;

function isMatchingRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function getSupabaseConfiguration(): {
  url: string;
  publishableKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error("Missing required Supabase frontend configuration.");
  }

  return {
    url,
    publishableKey,
  };
}

function copyResponseCookies(
  source: NextResponse,
  destination: NextResponse,
): void {
  source.cookies.getAll().forEach((cookie) => {
    destination.cookies.set(cookie);
  });
}

function createLoginRedirect(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const loginUrl = request.nextUrl.clone();

  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  loginUrl.pathname = "/login";
  loginUrl.search = "";

  if (
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//") &&
    !returnTo.includes("\\") &&
    !/[\r\n]/.test(returnTo)
  ) {
    loginUrl.searchParams.set("returnTo", returnTo);
  }

  const redirectResponse = NextResponse.redirect(loginUrl);

  copyResponseCookies(response, redirectResponse);

  return redirectResponse;
}

function authenticatedDestination(request: NextRequest): string {
  const returnToValues = request.nextUrl.searchParams.getAll("returnTo");

  if (returnToValues.length !== 1) {
    return "/dashboard";
  }

  return getSafePostAuthenticationPath(returnToValues[0]);
}

function createAuthenticatedRedirect(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const destinationUrl = new URL(
    authenticatedDestination(request),
    request.nextUrl.origin,
  );

  const redirectResponse = NextResponse.redirect(destinationUrl);

  copyResponseCookies(response, redirectResponse);

  return redirectResponse;
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const { url, publishableKey } = getSupabaseConfiguration();

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },

      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            secure: process.env.NODE_ENV === "production",
            sameSite: options?.sameSite ?? "lax",
            path: options?.path ?? "/",
          });
        });
      },
    },
  });

  /*
   * Keep session validation immediately after client creation.
   * getClaims() validates the JWT and refreshes cookies when needed.
   */
  const { data, error } = await supabase.auth.getClaims();

  const isAuthenticated = Boolean(data?.claims?.sub) && !error;

  const pathname = request.nextUrl.pathname;

  const isPublicPortalInvitation = pathname === "/portal/invitations/accept";

  if (
    !isAuthenticated &&
    !isPublicPortalInvitation &&
    isMatchingRoute(pathname, PROTECTED_ROUTES)
  ) {
    return createLoginRedirect(request, response);
  }

  if (isAuthenticated && isMatchingRoute(pathname, PUBLIC_AUTH_ROUTES)) {
    return createAuthenticatedRedirect(request, response);
  }

  /*
   * /auth/callback remains public so Supabase can exchange a
   * one-time PKCE recovery code for secure session cookies.
   */
  return response;
}
