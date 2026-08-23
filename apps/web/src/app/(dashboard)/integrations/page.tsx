import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IntegrationsWorkspace } from "@/components/integrations/integrations-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Integrations | BusinessOS",
  description: "Manage controlled external intake and payment connections.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("integrations.read")) redirect("/dashboard");

  return (
    <IntegrationsWorkspace
      organisationId={organisation.organisationId}
      canManage={permissions.has("integrations.manage")}
    />
  );
}
