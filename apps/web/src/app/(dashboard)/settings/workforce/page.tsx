import type { Metadata } from "next";

import { WorkforceConfigurationWorkspace } from "@/components/workforce-configuration/workforce-configuration-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Operating Model | BusinessOS",
  description:
    "Configure protected organisation structure, job duties, KPIs and AI-agent policies.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

export default async function WorkforceConfigurationPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  const requiredReadPermissions = [
    "workforce.read",
    "job_profiles.read",
    "kpis.read",
    "agent_profiles.read",
  ];
  const canReadConfiguration = requiredReadPermissions.every((permission) =>
    permissions.has(permission),
  );

  if (!canReadConfiguration) {
    return (
      <section className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <h1 className="text-xl font-semibold">Operating model unavailable</h1>
          <p className="mt-2 text-sm leading-6">
            Your verified organisation role does not include all protected read
            permissions required to view workforce structure, job profiles, KPIs
            and AI policies together. Ask an organisation owner or system
            administrator to review your access.
          </p>
        </div>
      </section>
    );
  }

  return (
    <WorkforceConfigurationWorkspace
      organisationId={organisation.organisationId}
      canManageStructure={permissions.has("workforce.manage")}
      canManageJobProfiles={permissions.has("job_profiles.manage")}
      canManageKpis={permissions.has("kpis.manage")}
      canManageAgentProfiles={permissions.has("agent_profiles.manage")}
    />
  );
}