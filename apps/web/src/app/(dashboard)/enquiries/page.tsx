import type { Metadata } from "next";
import { EnquiriesWorkspace } from "@/components/enquiries/enquiries-workspace";

export const metadata: Metadata = {
  title: "Enquiries | BusinessOS",
  description: "Securely manage organisation enquiries and follow-ups.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

export default function EnquiriesPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <EnquiriesWorkspace />
    </main>
  );
}