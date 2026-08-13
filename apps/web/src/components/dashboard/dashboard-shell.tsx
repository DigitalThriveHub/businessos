/**
 * Permission-aware BusinessOS dashboard shell.
 *
 * This component displays only the modules indicated by server-resolved
 * permissions. Hiding a module is not an authorisation boundary:
 * the NestJS API must still check every protected operation.
 */

import Link from "next/link";
import {
  Bot,
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

import { logout } from "@/app/dashboard/actions";

export type DashboardOrganisation = {
  organisationId: string;
  membershipId: string;
  organisationName: string;
  organisationSlug: string;
  organisationStatus: string;
  jobTitle: string | null;
  roles: string[];
  permissions: string[];
};

export type DashboardUser = {
  id: string;
  email?: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status?: string;
  authenticated: boolean;
  onboardingRequired: boolean;
  organisations: DashboardOrganisation[];
};

type DashboardShellProps = {
  user: DashboardUser;
  organisation: DashboardOrganisation;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permissions?: string[];
};

const navigationItems: NavigationItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Account security",
    href: "/settings/security",
    icon: ShieldCheck,
  },
  {
    label: "Enquiries",
    href: "/enquiries",
    icon: FileText,
    permissions: [
      "enquiries.read",
      "enquiry.read",
      "enquiries.view",
      "enquiry.view",
    ],
  },
  {
    label: "Clients",
    href: "/clients",
    icon: Users,
    permissions: [
      "clients.read",
      "client.read",
      "clients.view",
    ],
  },
  {
    label: "AI Workspace",
    href: "/ai",
    icon: Bot,
    permissions: [
      "ai.use",
      "ai.execute",
      "ai.workspace.access",
    ],
  },
  {
    label: "Organisation",
    href: "/settings",
    icon: Settings,
    permissions: [
      "organisation.manage",
      "organisations.manage",
      "settings.manage",
    ],
  },
];

function hasAnyPermission(
  userPermissions: string[],
  requiredPermissions?: string[],
): boolean {
  if (!requiredPermissions?.length) {
    return true;
  }

  const normalisedPermissions = new Set(
    userPermissions.map((permission) =>
      permission.toLowerCase(),
    ),
  );

  return requiredPermissions.some((permission) =>
    normalisedPermissions.has(permission.toLowerCase()),
  );
}

function getDisplayName(user: DashboardUser): string {
  if (user.displayName?.trim()) {
    return user.displayName.trim();
  }

  const fullName = [
    user.firstName,
    user.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) {
    return fullName;
  }

  return user.email ?? "Authorised user";
}

function getAccessLabel(
  organisation: DashboardOrganisation,
): string {
  if (organisation.jobTitle?.trim()) {
    return organisation.jobTitle.trim();
  }

  if (organisation.roles.length > 0) {
    return organisation.roles.join(", ");
  }

  return "Authorised user";
}

export function DashboardShell({
  user,
  organisation,
}: DashboardShellProps) {
  const visibleNavigation = navigationItems.filter(
    (item) =>
      hasAnyPermission(
        organisation.permissions,
        item.permissions,
      ),
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
              <LayoutDashboard
                aria-hidden="true"
                className="h-5 w-5"
              />
            </div>

            <div className="min-w-0">
              <p className="font-semibold tracking-tight">
                BusinessOS
              </p>

              <p className="truncate text-xs text-slate-500">
                {organisation.organisationName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">
                {getDisplayName(user)}
              </p>

              <p className="max-w-52 truncate text-xs text-slate-500">
                {getAccessLabel(organisation)}
              </p>
            </div>

            <form action={logout}>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
              >
                <LogOut
                  aria-hidden="true"
                  className="h-4 w-4"
                />

                <span className="hidden sm:inline">
                  Sign out
                </span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[240px_1fr] lg:px-8">
        <aside>
          <nav
            aria-label="Primary navigation"
            className="flex gap-2 overflow-x-auto lg:flex-col"
          >
            {visibleNavigation.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4"
                  />

                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main>
          <section className="rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">
              Business command centre
            </p>

            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Dashboard
            </h1>

            <p className="mt-3 text-xl text-white">
              Welcome back, {getDisplayName(user)}.
            </p>

            <p className="mt-4 max-w-2xl leading-7 text-slate-300">
              Your workspace is securely connected to{" "}
              {organisation.organisationName}. Available
              features are controlled by your verified
              organisation membership and permissions.
            </p>
          </section>

          <section
            aria-label="Workspace status"
            className="mt-7 grid gap-5 md:grid-cols-3"
          >
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <Building2
                aria-hidden="true"
                className="h-6 w-6 text-slate-700"
              />

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
              <ShieldCheck
                aria-hidden="true"
                className="h-6 w-6 text-slate-700"
              />

              <p className="mt-5 text-sm text-slate-500">
                Access roles
              </p>

              <p className="mt-1 font-semibold">
                {organisation.roles.length > 0
                  ? organisation.roles.join(", ")
                  : "Restricted access"}
              </p>

              <p className="mt-2 text-xs text-slate-500">
                Server-verified access
              </p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <FileText
                aria-hidden="true"
                className="h-6 w-6 text-slate-700"
              />

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
              Authentication, organisation access, RBAC and
              the Enquiries workflow are securely connected.
              Use the navigation to manage your available
              workspace modules.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}