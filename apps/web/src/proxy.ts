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
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)",
  ],
};