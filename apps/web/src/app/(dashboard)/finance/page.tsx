import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FinanceWorkspace } from "@/components/finance/finance-workspace";
import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Finance | BusinessOS",
  description: "Manage controlled invoices, payments and accounting evidence.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const { organisation } = await getAuthenticatedWorkspace();
  const permissions = new Set(
    organisation.permissions.map((permission) => permission.toLowerCase()),
  );
  if (!permissions.has("finance.read")) redirect("/dashboard");

  return (
    <FinanceWorkspace
      organisationId={organisation.organisationId}
      canManageSettings={permissions.has("finance.settings.manage")}
      canCreate={permissions.has("invoices.create")}
      canIssue={permissions.has("invoices.issue")}
      canVoid={permissions.has("invoices.void")}
      canRecordPayments={permissions.has("payments.record")}
      canReadLedger={permissions.has("ledger.read")}
    />
  );
}
