import type { Metadata } from "next";

import { EnquiriesWorkspace } from "@/components/enquiries/enquiries-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Enquiries | BusinessOS",
  description:
    "Securely manage organisation enquiries and follow-ups.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

export default async function EnquiriesPage() {
  const { organisation } =
    await getAuthenticatedWorkspace();

  return (
    <EnquiriesWorkspace
      organisationId={organisation.organisationId}
    />
  );
}