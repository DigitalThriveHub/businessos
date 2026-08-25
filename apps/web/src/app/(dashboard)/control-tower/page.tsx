import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OperationalIntelligenceWorkspace } from "@/components/operational-intelligence/operational-intelligence-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Control Tower | BusinessOS",
  description: "Operational workload, risk and value evidence.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function ControlTowerPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("control_tower.read")) redirect("/dashboard");

  return (
    <OperationalIntelligenceWorkspace
      organisationId={organisation.organisationId}
      view="control-tower"
    />
  );
}
