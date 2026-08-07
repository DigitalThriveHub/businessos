/**
 * Protected BusinessOS dashboard.
 *
 * Access process:
 * 1. Verify the user with Supabase Auth.
 * 2. Retrieve a valid server-side access token.
 * 3. Ask NestJS to resolve the user's profile, organisation and RBAC.
 * 4. Reject inactive or missing organisation access.
 */

import { redirect } from "next/navigation";
import {
  DashboardShell,
  type DashboardOrganisation,
  type DashboardUser,
} from "@/components/dashboard/dashboard-shell"; 
import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isActiveOrganisation(
  organisation: DashboardOrganisation,
): boolean {
  return organisation.organisationStatus.toUpperCase() === "ACTIVE";
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user: authenticatedUser },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !authenticatedUser) {
    redirect("/login?returnTo=/dashboard");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    redirect("/login?returnTo=/dashboard");
  }

  let user: DashboardUser;

  try {
    user = await apiFetch<DashboardUser>("/api/v1/auth/me", {
      accessToken: session.access_token,
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect("/login?returnTo=/dashboard");
    }

    throw error;
  }

  if (!user.authenticated) {
    redirect("/login?returnTo=/dashboard");
  }

  if (user.onboardingRequired) {
    redirect("/onboarding");
  }

  const activeOrganisation = user.organisations.find(isActiveOrganisation);

  if (!activeOrganisation) {
    redirect("/access-unavailable");
  }

  return (
    <DashboardShell
      user={user}
      organisation={activeOrganisation}
    />
  );
}