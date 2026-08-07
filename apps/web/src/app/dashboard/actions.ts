/**
 * BusinessOS dashboard Server Actions.
 *
 * Logout is performed on the server so session cookies are securely cleared.
 */

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function logout(): Promise<never> {
  const supabase = await createClient();

  try {
    await supabase.auth.signOut({
      scope: "local",
    });
  } finally {
    redirect("/login");
  }
}