import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";

import { InvitationsWorkspace } from "../../../../components/invitations/invitations-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Workforce Onboarding | BusinessOS",
  description: "Securely configure and invite organisation workforce members.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  const canManageOnboarding = permissions.has("onboarding.manage");
  const canOpenOperatingModel = [
    "workforce.read",
    "job_profiles.read",
    "kpis.read",
    "agent_profiles.read",
  ].every((permission) => permissions.has(permission));

  if (!canManageOnboarding) {
    return (
      <section className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <h1 className="text-xl font-semibold">
            Workforce onboarding unavailable
          </h1>
          <p className="mt-2 text-sm leading-6">
            Your verified organisation role does not include the protected
            workforce-onboarding permission. An organisation owner or system
            administrator must perform this action with the required security
            assurance.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {canOpenOperatingModel ? (
        <div className="flex justify-end">
          <Link
            href="/settings/workforce"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            <Settings2 aria-hidden="true" className="h-4 w-4" />
            Configure operating model
          </Link>
        </div>
      ) : null}

      <InvitationsWorkspace
        organisationId={organisation.organisationId}
        canRead={canManageOnboarding}
        canCreate={canManageOnboarding}
        canRevoke={canManageOnboarding}
      />
    </div>
  );
}