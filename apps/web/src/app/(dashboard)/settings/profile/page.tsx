import type { Metadata } from "next";

import { getAuthenticatedWorkspace } from "@/lib/authenticated-workspace";

import { ProfileSettings } from "./profile-settings";

export const metadata: Metadata = {
  title: "Profile | BusinessOS",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { user } =
    await getAuthenticatedWorkspace();

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
          Account
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Your profile
        </h1>

        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Keep your personal details accurate across your
          BusinessOS workspace.
        </p>
      </header>

      <ProfileSettings
        initialProfile={{
          id: user.id,
          email:
            user.email ??
            "Authenticated account",
          displayName:
            user.displayName ?? null,
          firstName:
            user.firstName ?? null,
          lastName:
            user.lastName ?? null,
        }}
      />
    </div>
  );
}