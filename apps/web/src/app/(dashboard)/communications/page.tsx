import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GateLWorkspace } from "@/components/communications/gate-l-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Communications | BusinessOS",
  description: "Manage secure client messages, portal access and reminders.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function CommunicationsPage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );

  if (!permissions.has("communications.read")) redirect("/dashboard");

  return (
    <GateLWorkspace
      organisationId={organisation.organisationId}
      canSend={permissions.has("communications.send")}
      canManageCommunications={permissions.has("communications.manage")}
      canManageIntegrations={permissions.has("integrations.manage")}
      canManagePortal={permissions.has("portal_access.manage")}
      canPublishUpdates={permissions.has("portal_updates.publish")}
      canManageTemplates={permissions.has("communication_templates.manage")}
      canManageReminders={permissions.has("communication_reminders.manage")}
    />
  );
}
