/**
 * BusinessOS Next.js request proxy.
 *
 * Refreshes Supabase authentication and performs an initial route-access check.
 * Final organisation and RBAC authorization remains enforced by the NestJS API.
 */

import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/enquiries/:path*",
    "/api/:path*",
  ],
};