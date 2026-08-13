import { redirect } from "next/navigation";

import { logout } from "@/app/dashboard/actions";
import { ApiError, apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

type CurrentUserResponse = {
  authenticated: boolean;
  onboardingRequired: boolean;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user: authenticatedUser },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !authenticatedUser) {
    redirect("/login?returnTo=%2Fonboarding");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    redirect("/login?returnTo=%2Fonboarding");
  }

  let currentUser: CurrentUserResponse;

  try {
    currentUser = await apiFetch<CurrentUserResponse>(
      "/api/v1/auth/me",
      {
        accessToken: session.access_token,
      },
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect("/login?returnTo=%2Fonboarding");
    }

    throw error;
  }

  if (!currentUser.authenticated) {
    redirect("/login?returnTo=%2Fonboarding");
  }

  if (!currentUser.onboardingRequired) {
    redirect("/dashboard");
  }

  if (!authenticatedUser.email) {
    throw new Error(
      "The authenticated account does not contain an email address.",
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="font-semibold">BusinessOS</p>
            <p className="text-xs text-slate-500">
              Secure organisation setup
            </p>
          </div>

          <form action={logout}>
            <button
              type="submit"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Initial setup
          </p>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Create your organisation
          </h1>

          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            Set up your organisation workspace. You will become
            its first owner and receive the organisation permissions
            defined by the secure bootstrap process.
          </p>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <OnboardingForm
            email={authenticatedUser.email}
            initialDisplayName={
              currentUser.displayName ?? ""
            }
            initialFirstName={
              currentUser.firstName ?? ""
            }
            initialLastName={
              currentUser.lastName ?? ""
            }
          />
        </section>

        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          Organisation membership, owner role assignment and tenant
          access are created atomically by the protected backend.
        </p>
      </div>
    </main>
  );
}