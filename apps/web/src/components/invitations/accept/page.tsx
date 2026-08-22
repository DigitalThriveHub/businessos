import {
  Suspense,
} from "react";
import type { Metadata } from "next";

import {
  InvitationAcceptance,
  InvitationAcceptanceLoading,
} from "@/components/invitations/invitation-acceptance";

export const metadata: Metadata = {
  title: "Accept invitation | BusinessOS",
  description:
    "Securely accept an authorised BusinessOS organisation invitation.",
  robots:
    "noindex, nofollow, noarchive",
  referrer: "no-referrer",
};

export default function InvitationAcceptancePage() {
  return (
    <Suspense
      fallback={
        <InvitationAcceptanceLoading />
      }
    >
      <InvitationAcceptance />
    </Suspense>
  );
}