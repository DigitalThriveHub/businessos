import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PilotReadinessWorkspace } from "@/components/pilot-readiness/pilot-readiness-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";
export const metadata: Metadata = { title: "Pilot Readiness | BusinessOS", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function PilotReadinessPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(organisation.permissions.map((value) => value.toLowerCase()));
  if (!permissions.has("command_centre.read")) redirect("/dashboard");
  return <PilotReadinessWorkspace organisationId={organisation.organisationId} canManage={permissions.has("organisation.update")} />;
}
