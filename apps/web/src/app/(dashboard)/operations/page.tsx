import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OperationsWorkspace } from "@/components/automation-control/operations-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Operations | BusinessOS",
  description:
    "Control workflow work, service levels, approvals and escalations.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

function permissionSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

export default async function OperationsPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const granted = permissionSet(organisation.permissions);

  if (!granted.has("automation.read")) {
    redirect("/dashboard");
  }

  return (
    <OperationsWorkspace
      organisationId={organisation.organisationId}
      canComplete={granted.has("work_items.complete")}
      canDecideApprovals={granted.has("approvals.decide")}
      canManageSla={granted.has("sla.manage")}
    />
  );
}
