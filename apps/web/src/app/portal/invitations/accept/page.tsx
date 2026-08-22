import type { Metadata } from "next";
import { Suspense } from "react";

import { PortalInvitationAcceptance } from "@/components/client-portal/portal-invitation-acceptance";

export const metadata: Metadata = {
  title: "Accept Client Portal Invitation | BusinessOS",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function AcceptPortalInvitationPage() {
  return <Suspense fallback={<p className="p-8 text-sm">Loading secure invitation…</p>}><PortalInvitationAcceptance /></Suspense>;
}
