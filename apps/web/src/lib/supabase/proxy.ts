/**
 * BusinessOS Supabase session proxy.
 *
 * Security:
 * - Validates signed JWT claims.
 * - Refreshes authentication cookies.
 * - Redirects unauthenticated users away from protected routes.
 * - Never performs RBAC using browser-controlled data.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_ROUTES = [
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

function isMatchingRoute(pathname: string, routes: string[]): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function getSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error("Missing required Supabase frontend configuration.");
  }

  return { url, publishableKey };
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const { url, publishableKey } = getSupabaseConfiguration();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },

      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

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
   * Do not place application logic between client creation and getClaims().
   * getClaims() validates the JWT signature and refreshes the session when needed.
   */
  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub) && !error;
  const pathname = request.nextUrl.pathname;

  if (!isAuthenticated && isMatchingRoute(pathname, PROTECTED_ROUTES)) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.search = "";

    const returnTo = `${pathname}${request.nextUrl.search}`;

    if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      loginUrl.searchParams.set("returnTo", returnTo);
    }

    const redirectResponse = NextResponse.redirect(loginUrl);

    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });

    return redirectResponse;
  }

  if (isAuthenticated && isMatchingRoute(pathname, AUTH_ROUTES)) {
    const dashboardUrl = request.nextUrl.clone();

    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";

    const redirectResponse = NextResponse.redirect(dashboardUrl);

    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });

    return redirectResponse;
  }

  return response;
}