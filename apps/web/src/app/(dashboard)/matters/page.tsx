import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MattersWorkspace } from "@/components/case-management/matters-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Matters | BusinessOS",
  description:
    "Manage controlled matter lifecycles, parties, assignments and compliance.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

function permissions(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

export default async function MattersPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const granted = permissions(organisation.permissions);

  if (!granted.has("matters.read")) {
    redirect("/dashboard");
  }

  return (
    <MattersWorkspace
      organisationId={organisation.organisationId}
      canCreate={
        granted.has("matters.create") &&
        granted.has("matters.parties.manage")
      }
      canUpdate={granted.has("matters.update")}
      canAssign={granted.has("matters.assign")}
      canManageStatus={granted.has("matters.status.manage")}
      canManageCompliance={granted.has("matters.compliance.manage")}
      canManageParties={granted.has("matters.parties.manage")}
      canArchive={granted.has("matters.archive")}
    />
  );
}