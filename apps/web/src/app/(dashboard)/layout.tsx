import type { ReactNode } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, organisation } =
    await getAuthenticatedWorkspace();

  return (
    <DashboardShell
      user={user}
      organisation={organisation}
    >
      {children}
    </DashboardShell>
  );
}