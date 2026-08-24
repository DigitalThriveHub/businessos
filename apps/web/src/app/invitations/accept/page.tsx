import type { Metadata } from "next";
import { Suspense } from "react";

import {
  InvitationAcceptance,
  InvitationAcceptanceLoading,
} from "@/components/invitations/invitation-acceptance";

export const metadata: Metadata = {
  title: "Accept Workforce Invitation | BusinessOS",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<InvitationAcceptanceLoading />}>
      <InvitationAcceptance />
    </Suspense>
  );
}
