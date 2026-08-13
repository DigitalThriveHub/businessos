import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EnquiriesWorkspace } from "@/components/enquiries/enquiries-workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Enquiries | BusinessOS",
  description: "Securely manage organisation enquiries and follow-ups.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

const AUTH_ME_ENDPOINT = "/api/v1/auth/me";
const ACTIVE_STATUS = "ACTIVE";

type CurrentUserResponse = {
  organisationId?: string;
  activeOrganisationId?: string;
  organisation?: {
    id?: string;
  };
  organisations?: Array<{
    organisationId?: string;
    organisationStatus?: string;
  }>;
  membership?: {
    organisationId?: string;
  };
  memberships?: Array<{
    organisationId?: string;
    status?: string;
    organisation?: {
      id?: string;
      status?: string;
    };
  }>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isActiveStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.toUpperCase() === ACTIVE_STATUS
  );
}

function resolveOrganisationId(
  currentUser: CurrentUserResponse,
): string | null {
  /*
   * Prefer an explicitly active organisation returned by the
   * authenticated account endpoint.
   */
  const activeOrganisation = currentUser.organisations?.find(
    (organisation) =>
      isActiveStatus(organisation.organisationStatus) &&
      isUuid(organisation.organisationId),
  );

  if (
    activeOrganisation &&
    isUuid(activeOrganisation.organisationId)
  ) {
    return activeOrganisation.organisationId;
  }

  /*
   * Support membership-based account responses while ensuring
   * that the membership and, when supplied, organisation are active.
   */
  const activeMembership = currentUser.memberships?.find(
    (membership) => {
      const organisationId =
        membership.organisationId ??
        membership.organisation?.id;

      const organisationIsActive =
        membership.organisation?.status === undefined ||
        isActiveStatus(membership.organisation.status);

      return (
        isActiveStatus(membership.status) &&
        organisationIsActive &&
        isUuid(organisationId)
      );
    },
  );

  const activeMembershipOrganisationId =
    activeMembership?.organisationId ??
    activeMembership?.organisation?.id;

  if (isUuid(activeMembershipOrganisationId)) {
    return activeMembershipOrganisationId;
  }

  /*
   * Compatibility fallback for authenticated account-response
   * formats that expose the selected organisation directly.
   * NestJS must still enforce membership, RBAC and tenant isolation.
   */
  const directCandidates = [
    currentUser.activeOrganisationId,
    currentUser.organisationId,
    currentUser.organisation?.id,
    currentUser.membership?.organisationId,
  ];

  return directCandidates.find(isUuid) ?? null;
}

export default async function EnquiriesPage() {
  const supabase = await createClient();

  /*
   * getUser() validates the current identity with Supabase Auth.
   */
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?returnTo=/enquiries");
  }

  /*
   * The access token is forwarded to NestJS, where authentication,
   * organisation access and RBAC are enforced again.
   */
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    redirect("/login?returnTo=/enquiries");
  }

  let currentUser: CurrentUserResponse;

  try {
    currentUser = await apiFetch<CurrentUserResponse>(
      AUTH_ME_ENDPOINT,
      {
        accessToken: session.access_token,
      },
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401
    ) {
      redirect("/login?returnTo=/enquiries");
    }

    const errorMessage =
      error instanceof ApiError && error.status === 403
        ? "You do not have permission to access this workspace."
        : "The secure account service is temporarily unavailable.";

    return (
      <main className="min-h-screen bg-slate-50">
        <section className="mx-auto max-w-7xl p-6 lg:p-8">
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
          >
            {errorMessage}
          </div>
        </section>
      </main>
    );
  }

  const organisationId =
    resolveOrganisationId(currentUser);

  if (!organisationId) {
    return (
      <main className="min-h-screen bg-slate-50">
        <section className="mx-auto max-w-7xl p-6 lg:p-8">
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
          >
            No active organisation membership is available for this
            account.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <EnquiriesWorkspace organisationId={organisationId} />
    </main>
  );
}