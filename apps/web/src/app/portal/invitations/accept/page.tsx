import type { Metadata } from "next";
import { Suspense } from "react";

import { PortalInvitationAcceptance } from "@/components/client-portal/portal-invitation-acceptance";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Accept Client Portal Invitation | BusinessOS",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function AcceptPortalInvitationPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return (
    <Suspense fallback={<p className="p-8 text-sm">Loading secure invitation…</p>}>
      <PortalInvitationAcceptance
        authenticated={Boolean(user) && !error}
      />
    </Suspense>
  );
}
