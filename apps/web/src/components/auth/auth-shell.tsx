import type {
  ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

type AuthShellProps = {
  title: string;
  description: ReactNode;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
};

export function AuthShell({
  title,
  description,
  children,
  backHref,
  backLabel = "Back",
}: AuthShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 lg:flex">
      <section className="hidden min-h-screen w-1/2 flex-col justify-between bg-slate-950 p-12 text-white lg:flex xl:p-16">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck
              aria-hidden="true"
              className="h-6 w-6"
            />
          </div>

          <div>
            <p className="text-lg font-semibold tracking-tight">
              BusinessOS
            </p>

            <p className="text-sm text-slate-400">
              Secure AI Business Operations
            </p>
          </div>
        </div>

        <div className="max-w-xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
            Work intelligently
          </p>

          <h2 className="text-5xl font-semibold leading-tight tracking-tight">
            One secure operating system for your
            entire business.
          </h2>

          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Manage enquiries, clients, work,
            communication and growth from one
            permission-controlled platform.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-400">
          <LockKeyhole
            aria-hidden="true"
            className="h-4 w-4"
          />

          <span>
            Encrypted authentication and
            controlled access
          </span>
        </div>
      </section>

      <section className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-5 w-5"
                />
              </div>

              <div>
                <p className="text-xl font-semibold tracking-tight text-slate-950">
                  BusinessOS
                </p>

                <p className="text-xs text-slate-500">
                  Secure AI Business Operations
                </p>
              </div>
            </div>
          </div>

          {backHref && (
            <Link
              href={backHref}
              className="mb-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-slate-600 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
            >
              <ArrowLeft
                aria-hidden="true"
                className="h-4 w-4"
              />

              {backLabel}
            </Link>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/40 sm:p-9">
            <header className="mb-8">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>

              <div className="mt-3 leading-6 text-slate-600">
                {description}
              </div>
            </header>

            {children}

            <div className="mt-7 border-t border-slate-200 pt-6">
              <div className="flex items-start gap-3 text-sm leading-6 text-slate-600">
                <LockKeyhole
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-700"
                />

                <p>
                  Access is restricted to authorised
                  users. Activity may be recorded for
                  security, compliance and fraud
                  prevention.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-slate-500">
            Protected by secure session management
            and organisation-level access controls.
          </p>
        </div>
      </section>
    </main>
  );
}