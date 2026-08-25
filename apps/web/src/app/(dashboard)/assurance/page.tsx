import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ComplianceAssuranceWorkspace } from "@/components/compliance-assurance/compliance-assurance-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Assurance Centre | BusinessOS",
  description: "UK compliance operations and production release assurance.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function AssurancePage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("compliance.read")) redirect("/dashboard");
  return (
    <ComplianceAssuranceWorkspace
      organisationId={organisation.organisationId}
    />
  );
}
