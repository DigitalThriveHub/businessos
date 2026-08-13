/**
 * BusinessOS Next.js request proxy.
 *
 * Refreshes Supabase authentication and performs initial route-access checks.
 * Final organisation and RBAC authorisation remains enforced by NestJS and
 * PostgreSQL Row Level Security.
 */

import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/login/:path*",
    "/signup/:path*",
    "/mfa/:path*",
    "/dashboard/:path*",
    "/enquiries/:path*",
    "/clients/:path*",
    "/matters/:path*",
    "/tasks/:path*",
    "/documents/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/api/:path*",
  ],
};