import type { Metadata } from "next";
import {
  Building2,
  FileText,
  ShieldCheck,
} from "lucide-react";

import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

export const metadata: Metadata = {
  title: "Dashboard | BusinessOS",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

function getDisplayName({
  displayName,
  firstName,
  lastName,
  email,
}: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
}): string {
  if (displayName?.trim()) {
    return displayName.trim();
  }

  const fullName = [firstName, lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || email || "Authorised user";
}

export default async function DashboardPage() {
  const { user, organisation } =
    await getAuthenticatedWorkspace();

  return (
    <>
      <section className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">
          Business command centre
        </p>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Dashboard
        </h1>

        <p className="mt-3 text-xl">
          Welcome back, {getDisplayName(user)}.
        </p>

        <p className="mt-4 max-w-2xl leading-7 text-slate-300">
          Your workspace is securely connected to{" "}
          {organisation.organisationName}. Available features
          are controlled by your verified organisation
          membership and permissions.
        </p>
      </section>

      <section
        aria-label="Workspace status"
        className="mt-7 grid gap-5 md:grid-cols-3"
      >
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Building2 className="h-6 w-6 text-slate-700" />

          <p className="mt-5 text-sm text-slate-500">
            Organisation
          </p>

          <p className="mt-1 font-semibold">
            {organisation.organisationName}
          </p>

          <p className="mt-2 text-xs uppercase tracking-wide text-emerald-700">
            {organisation.organisationStatus}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ShieldCheck className="h-6 w-6 text-slate-700" />

          <p className="mt-5 text-sm text-slate-500">
            Access roles
          </p>

          <p className="mt-1 font-semibold">
            {organisation.roles.length
              ? organisation.roles.join(", ")
              : "Restricted access"}
          </p>

          <p className="mt-2 text-xs text-slate-500">
            Server-verified access
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <FileText className="h-6 w-6 text-slate-700" />

          <p className="mt-5 text-sm text-slate-500">
            Granted permissions
          </p>

          <p className="mt-1 text-2xl font-semibold">
            {organisation.permissions.length}
          </p>

          <p className="mt-2 text-xs text-slate-500">
            Applied through organisation RBAC
          </p>
        </article>
      </section>

      <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">
          Operational workspace
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          Authentication, organisation access, RBAC and the
          Enquiries workflow are securely connected.
        </p>
      </section>
    </>
  );
}