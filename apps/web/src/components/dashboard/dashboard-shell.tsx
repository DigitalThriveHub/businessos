"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  BriefcaseBusiness,
  FileText,
  Gauge,
  Landmark,
  Route,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Plug,
  Settings,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
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
  children: ReactNode;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permissions?: string[];
};

const navigationItems: NavigationItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Command Centre",
    href: "/command-centre",
    icon: Gauge,
    permissions: ["command_centre.read"],
  },
  {
    label: "Your profile",
    href: "/settings/profile",
    icon: UserRound,
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
    label: "Team",
    href: "/settings/team",
    icon: UserPlus,
    permissions: [
      "invitations.read",
      "invitations.create",
      "invitations.revoke",
    ],
  },
  {
    label: "Clients",
    href: "/clients",
    icon: Users,
    permissions: ["clients.read", "client.read", "clients.view"],
  },
  {
    label: "Matters",
    href: "/matters",
    icon: BriefcaseBusiness,
    permissions: ["matters.read", "matters.read_all"],
  },
  {
    label: "Operations",
    href: "/operations",
    icon: Activity,
    permissions: ["automation.read"],
  },
  {
    label: "Communications",
    href: "/communications",
    icon: MessagesSquare,
    permissions: ["communications.read"],
  },
  {
    label: "Finance",
    href: "/finance",
    icon: Landmark,
    permissions: ["finance.read"],
  },
  {
    label: "Service Lifecycle",
    href: "/service-lifecycle",
    icon: Route,
    permissions: ["engagements.read"],
  },
  {
    label: "Integrations",
    href: "/integrations",
    icon: Plug,
    permissions: ["integrations.read"],
  },
  {
    label: "Pilot Readiness",
    href: "/pilot-readiness",
    icon: ClipboardCheck,
    permissions: ["command_centre.read"],
  },
  {
    label: "AI Workspace",
    href: "/ai",
    icon: Bot,
    permissions: ["ai.use", "ai.execute", "ai.workspace.access"],
  },
  {
    label: "Organisation",
    href: "/settings/organisation",
    icon: Settings,
    permissions: [
      "organisation.manage",
      "organisations.manage",
      "settings.manage",
    ],
  },
];

function hasAnyPermission(
  grantedPermissions: string[],
  requiredPermissions?: string[],
): boolean {
  if (!requiredPermissions?.length) {
    return true;
  }

  const granted = new Set(
    grantedPermissions.map((permission) => permission.toLowerCase()),
  );

  return requiredPermissions.some((permission) =>
    granted.has(permission.toLowerCase()),
  );
}

function getDisplayName(user: DashboardUser): string {
  if (user.displayName?.trim()) {
    return user.displayName.trim();
  }

  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || user.email || "Authorised user";
}

function getAccessLabel(organisation: DashboardOrganisation): string {
  if (organisation.jobTitle?.trim()) {
    return organisation.jobTitle.trim();
  }

  if (organisation.roles.length > 0) {
    return organisation.roles.join(", ");
  }

  return "Authorised user";
}

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({
  user,
  organisation,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();

  const visibleNavigation = navigationItems.filter((item) =>
    hasAnyPermission(organisation.permissions, item.permissions),
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <a
        href="#workspace-content"
        className="sr-only z-[100] rounded-lg bg-white px-4 py-2 font-medium text-slate-950 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
              <LayoutDashboard aria-hidden="true" className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <p className="font-semibold tracking-tight">BusinessOS</p>

              <p className="truncate text-xs text-slate-500">
                {organisation.organisationName}
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{getDisplayName(user)}</p>

              <p className="max-w-52 truncate text-xs text-slate-500">
                {getAccessLabel(organisation)}
              </p>
            </div>

            <form action={logout}>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />

                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav
            aria-label="Primary navigation"
            className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {visibleNavigation.map((item) => {
              const Icon = item.icon;

              const active = isActiveRoute(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "flex min-h-11 shrink-0 items-center gap-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-sm"
                      : "flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
                  }
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />

                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main id="workspace-content" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
