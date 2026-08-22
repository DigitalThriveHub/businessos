import type { Metadata } from "next";

import { ClientPortalWorkspace } from "@/components/client-portal/client-portal-workspace";

export const metadata: Metadata = {
  title: "Client Portal | BusinessOS",
  description: "Secure case progress, documents and messages.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function ClientPortalPage() {
  return <ClientPortalWorkspace />;
}
