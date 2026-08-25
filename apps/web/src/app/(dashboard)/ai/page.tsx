import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MyAiWorkspace } from "@/components/my-ai/my-ai-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "My AI | BusinessOS",
  description: "Your governed, role-aware BusinessOS assistant.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function MyAiPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("ai.workspace.access")) redirect("/dashboard");

  return <MyAiWorkspace organisationId={organisation.organisationId} />;
}
