import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ClientsWorkspace } from "@/components/case-management/clients-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Clients | BusinessOS",
  description: "Manage protected organisation client records and conversions.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

function permissions(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

export default async function ClientsPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const granted = permissions(organisation.permissions);

  if (!granted.has("clients.read")) {
    redirect("/dashboard");
  }

  return (
    <ClientsWorkspace
      organisationId={organisation.organisationId}
      canCreate={granted.has("clients.create")}
      canUpdate={granted.has("clients.update")}
      canArchive={granted.has("clients.archive")}
      canConvert={
        granted.has("enquiries.convert") &&
        granted.has("enquiries.update") &&
        granted.has("clients.create") &&
        granted.has("matters.create") &&
        granted.has("matters.parties.manage")
      }
    />
  );
}