import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { CaseOperationsWorkspace } from "@/components/case-operations/case-operations-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Matter Operations | BusinessOS",
  description:
    "Run protected matter tasks, deadlines, document requests and private documents.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const matterIdSchema = z.string().uuid();

export default async function MatterOperationsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const route = await params;
  const parsedMatterId = matterIdSchema.safeParse(route.matterId);
  if (!parsedMatterId.success) notFound();

  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("matters.read")) redirect("/dashboard");

  return (
    <CaseOperationsWorkspace
      organisationId={organisation.organisationId}
      matterId={parsedMatterId.data}
      permissions={organisation.permissions}
    />
  );
}