import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  LogOut,
  ShieldCheck,
} from "lucide-react";

import { logout } from "@/app/dashboard/actions";
import { MfaSettings } from "./mfa-settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect(
      "/login?returnTo=%2Fsettings%2Fsecurity",
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
              <ShieldCheck
                aria-hidden="true"
                className="h-5 w-5"
              />
            </div>

            <div>
              <p className="font-semibold">BusinessOS</p>
              <p className="text-xs text-slate-500">
                Account security
              </p>
            </div>
          </Link>

          <form action={logout}>
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
            >
              <LogOut
                aria-hidden="true"
                className="h-4 w-4"
              />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
        >
          <ArrowLeft
            aria-hidden="true"
            className="h-4 w-4"
          />
          Back to dashboard
        </Link>

        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Identity protection
          </p>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Security settings
          </h1>

          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            Protect your BusinessOS account using an
            authenticator application and time-based
            verification codes.
          </p>
        </header>

        <MfaSettings
          accountEmail={
            user.email ?? "Authenticated account"
          }
        />
      </div>
    </main>
  );
}