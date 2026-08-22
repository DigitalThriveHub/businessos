"use server";

import { redirect } from "next/navigation";

import { isPortalInvitationReturnPath } from "@/lib/security/safe-return-path";
import { createClient } from "@/lib/supabase/server";

async function signOutLocal(): Promise<void> {
  const supabase = await createClient();

  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Continue to the trusted login destination even if the
    // local session has already expired.
  }
}

export async function portalLogout(): Promise<never> {
  await signOutLocal();
  redirect("/login?returnTo=%2Fportal");
}

export async function portalInvitationLogout(
  formData: FormData,
): Promise<never> {
  const submittedReturnTo =
    formData.get("returnTo");

  const returnTo =
    typeof submittedReturnTo === "string" &&
    isPortalInvitationReturnPath(
      submittedReturnTo,
    )
      ? submittedReturnTo
      : "/portal";

  await signOutLocal();

  redirect(
    `/login?returnTo=${encodeURIComponent(
      returnTo,
    )}`,
  );
}
