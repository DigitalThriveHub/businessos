/**
 * BusinessOS Supabase session proxy.
 *
 * Security:
 * - Validates signed Supabase JWT claims.
 * - Refreshes authentication cookies.
 * - Redirects unauthenticated users away from protected routes.
 * - Allows authenticated AAL1 users to reach the MFA challenge flow.
 * - Never performs RBAC using browser-controlled data.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_ROUTES = [
  "/mfa",
  "/dashboard",
  "/enquiries",
  "/clients",
  "/matters",
  "/tasks",
  "/documents",
  "/settings",
  "/admin",
];

const AUTH_ROUTES = ["/login", "/signup"];

function isMatchingRoute(
  pathname: string,
  routes: readonly string[],
): boolean {
  return routes.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(`${route}/`),
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
    throw new Error(
      "Missing required Supabase frontend configuration.",
    );
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
  const returnTo =
    `${request.nextUrl.pathname}${request.nextUrl.search}`;

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

function createDashboardRedirect(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const dashboardUrl = request.nextUrl.clone();

  dashboardUrl.pathname = "/dashboard";
  dashboardUrl.search = "";

  const redirectResponse =
    NextResponse.redirect(dashboardUrl);

  copyResponseCookies(response, redirectResponse);

  return redirectResponse;
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const { url, publishableKey } =
    getSupabaseConfiguration();

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    url,
    publishableKey,
    {
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

          cookiesToSet.forEach(
            ({ name, value, options }) => {
              response.cookies.set(name, value, {
                ...options,
                secure:
                  process.env.NODE_ENV === "production",
                sameSite:
                  options?.sameSite ?? "lax",
                path: options?.path ?? "/",
              });
            },
          );
        },
      },
    },
  );

  /*
   * Do not place application logic between client creation
   * and getClaims(). This validates and refreshes the session.
   */
  const { data, error } =
    await supabase.auth.getClaims();

  const isAuthenticated =
    Boolean(data?.claims?.sub) && !error;

  const pathname = request.nextUrl.pathname;

  if (
    !isAuthenticated &&
    isMatchingRoute(pathname, PROTECTED_ROUTES)
  ) {
    return createLoginRedirect(request, response);
  }

  if (
    isAuthenticated &&
    isMatchingRoute(pathname, AUTH_ROUTES)
  ) {
    return createDashboardRedirect(request, response);
  }

  return response;
}