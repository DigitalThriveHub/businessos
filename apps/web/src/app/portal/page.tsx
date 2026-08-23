import type { Metadata } from "next";

import { ClientPortalWorkspace } from "@/components/client-portal/client-portal-workspace";

export const metadata: Metadata = {
  title: "Client Portal | BusinessOS",
  description: "Secure case progress, documents and messages.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function ClientPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string | string[] }>;
}) {
  const payment = (await searchParams).payment;
  const paymentResult =
    payment === "success" || payment === "cancelled" ? payment : null;

  return <ClientPortalWorkspace paymentResult={paymentResult} />;
}
