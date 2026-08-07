/**
 * BusinessOS browser-side Supabase client.
 *
 * Purpose:
 * - Supports secure signup, login and logout.
 * - Maintains and refreshes the authenticated browser session.
 * - Uses Supabase's PKCE authentication flow.
 *
 * Security:
 * - Only NEXT_PUBLIC variables are permitted here.
 * - Never add the service-role key, database password or private secrets.
 * - RBAC and organisation isolation must still be enforced by the API
 *   and PostgreSQL Row Level Security—not trusted to the browser.
 */

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

function getSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Configure it in the frontend environment.",
    );
  }

  if (!publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return { url, publishableKey };
}

export function createClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const { url, publishableKey } = getSupabaseConfiguration();

  browserClient = createBrowserClient(url, publishableKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
}