import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import type {
  DashboardOrganisation,
  DashboardUser,
} from "@/components/dashboard/dashboard-shell";
import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

function isActiveOrganisation(
  organisation: DashboardOrganisation,
): boolean {
  return (
    organisation.organisationStatus.toUpperCase() ===
    "ACTIVE"
  );
}

/**
 * Resolves the authenticated workspace once per server render.
 *
 * NestJS remains authoritative for organisation membership,
 * permissions and tenant access.
 */
export const getAuthenticatedWorkspace = cache(
  async (): Promise<{
    user: DashboardUser;
    organisation: DashboardOrganisation;
  }> => {
    const supabase = await createClient();

    const {
      data: { user: authenticatedUser },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !authenticatedUser) {
      redirect("/login?returnTo=%2Fdashboard");
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      redirect("/login?returnTo=%2Fdashboard");
    }

    let user: DashboardUser;

    try {
      user = await apiFetch<DashboardUser>(
        "/api/v1/auth/me",
        {
          accessToken: session.access_token,
        },
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        redirect("/login?returnTo=%2Fdashboard");
      }

      throw error;
    }

    if (!user.authenticated) {
      redirect("/login?returnTo=%2Fdashboard");
    }

    if (user.onboardingRequired) {
      redirect("/onboarding");
    }

    const organisation =
      user.organisations.find(isActiveOrganisation);

    if (!organisation) {
      redirect("/access-unavailable");
    }

    return {
      user,
      organisation,
    };
  },
);