import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CommandCentreWorkspace } from "@/components/command-centre/command-centre-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Command Centre | BusinessOS",
  description: "Monitor urgent work, operational risk and service health.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function CommandCentrePage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("command_centre.read")) redirect("/dashboard");

  return (
    <CommandCentreWorkspace organisationId={organisation.organisationId} />
  );
}
