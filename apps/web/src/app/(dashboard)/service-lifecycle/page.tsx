import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ServiceLifecycleWorkspace } from "@/components/service-lifecycle/service-lifecycle-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";
export const metadata: Metadata = {
  title: "Service Lifecycle | BusinessOS",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";
export default async function Page() {
  const { organisation } = await getAuthenticatedWorkspace();
  if (
    !organisation.permissions
      .map((p) => p.toLowerCase())
      .includes("engagements.read")
  )
    redirect("/dashboard");
  return (
    <ServiceLifecycleWorkspace organisationId={organisation.organisationId} />
  );
}
