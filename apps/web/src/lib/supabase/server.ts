/**
 * BusinessOS server-side Supabase client.
 *
 * Purpose:
 * - Reads the authenticated Supabase session on the server.
 * - Supports protected pages, Server Actions and Route Handlers.
 * - Safely synchronises refreshed authentication cookies.
 *
 * Security:
 * - Uses only the public Supabase publishable/anon key.
 * - Never place service-role keys or database credentials here.
 * - Authentication does not replace server-side RBAC,
 *   organisation isolation, permission checks or audit logging.
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL in the frontend environment.",
    );
  }

  if (!publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return { url, publishableKey };
}

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfiguration();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },

      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, {
              ...options,
              secure: process.env.NODE_ENV === "production",
              sameSite: options?.sameSite ?? "lax",
              path: options?.path ?? "/",
            });
          });
        } catch {
          /*
           * Server Components cannot always modify cookies.
           * The session-refresh proxy will perform cookie updates.
           * Authentication errors must not be silently ignored elsewhere.
           */
        }
      },
    },
  });
}