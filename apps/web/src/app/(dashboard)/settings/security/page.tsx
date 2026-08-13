import type { Metadata } from "next";

import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

import { MfaSettings } from "./mfa-settings";

export const metadata: Metadata = {
  title: "Account Security | BusinessOS",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const { user } = await getAuthenticatedWorkspace();

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
          Identity protection
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Security settings
        </h1>

        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Protect your BusinessOS account using authenticator
          applications and time-based verification codes.
        </p>
      </header>

      <MfaSettings
        accountEmail={
          user.email ?? "Authenticated account"
        }
      />
    </div>
  );
}