"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

import {
  assignableInvitationRoleListSchema,
  createInvitationRequestSchema,
  type AssignableInvitationRole,
  type Invitation,
  type InvitationAgentProfileOption,
  invitationListSchema,
  invitationSchema,
  type InvitationStatus,
  type InvitationWorkforceOptions,
  invitationWorkforceOptionsSchema,
  revokeInvitationRequestSchema,
} from "@/lib/invitations";

type InvitationsWorkspaceProps = {
  organisationId: string;
  canRead: boolean;
  canCreate: boolean;
  canRevoke: boolean;
};

type ApiMessage = {
  message?: string;
};

const PAGE_SIZE = 25;
const REQUEST_TIMEOUT_MS = 15_000;

const EMPTY_WORKFORCE_OPTIONS: InvitationWorkforceOptions = {
  configurationReady: false,
  assignableRoleCount: 0,
  jobProfiles: [],
  departments: [],
  teams: [],
  managers: [],
  agentProfiles: [],
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;

  const abortFromCaller = () => {
    controller.abort(callerSignal?.reason);
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error("The request timed out. Please try again.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiMessage;

    if (body.message) {
      return body.message;
    }
  } catch {
    // Never expose malformed or untrusted upstream response data.
  }

  if (response.status === 401) {
    return "Your secure session has expired. Sign in again.";
  }

  if (response.status === 403) {
    return "This action requires protected workforce-onboarding access and the required security assurance.";
  }

  if (response.status === 409) {
    return "An active invitation already exists or the person is already a member.";
  }

  return "The request could not be completed. Please try again.";
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: InvitationStatus): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "ACCEPTED":
      return "Accepted";
    case "EXPIRED":
      return "Expired";
    case "REVOKED":
      return "Revoked";
    default:
      return "Unknown";
  }
}

function statusClass(status: InvitationStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-amber-100 text-amber-900";
    case "ACCEPTED":
      return "bg-emerald-100 text-emerald-900";
    case "REVOKED":
      return "bg-red-100 text-red-900";
    case "EXPIRED":
      return "bg-slate-200 text-slate-800";
    default:
      return "bg-slate-200 text-slate-800";
  }
}

function deliveryClass(status: Invitation["deliveryStatus"]): string {
  switch (status) {
    case "SENT":
      return "text-emerald-700";
    case "FAILED":
      return "text-red-700";
    case "QUEUED":
      return "text-amber-700";
    default:
      return "text-slate-700";
  }
}

function roleScopeLabel(role: AssignableInvitationRole): string {
  switch (role.scope) {
    case "ORGANISATION":
      return "Organisation";
    case "DEPARTMENT":
      return "Department";
    case "TEAM":
      return "Team";
    default:
      return "Scoped";
  }
}

function authorityLabel(profile: InvitationAgentProfileOption): string {
  switch (profile.authorityCeiling) {
    case "DISABLED":
      return "Disabled";
    case "READ":
      return "Read only";
    case "DRAFT":
      return "Draft only";
    case "PROPOSE":
      return "Propose actions";
    case "EXECUTE_WITH_APPROVAL":
      return "Execute with approval";
    case "EXECUTE_AUTOMATIC":
      return "Approved automatic execution";
    default:
      return "Restricted";
  }
}

function canInvitationBeRevoked(invitation: Invitation): boolean {
  return (
    invitation.status === "PENDING" &&
    new Date(invitation.expiresAt).getTime() > Date.now()
  );
}

export function InvitationsWorkspace({
  organisationId,
  canRead,
  canCreate,
  canRevoke,
}: InvitationsWorkspaceProps) {
  const [roles, setRoles] = useState<AssignableInvitationRole[]>([]);
  const [workforceOptions, setWorkforceOptions] =
    useState<InvitationWorkforceOptions>(EMPTY_WORKFORCE_OPTIONS);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [loadingInvitations, setLoadingInvitations] = useState(canRead);
  const [loadingRoles, setLoadingRoles] = useState(canCreate);
  const [loadingWorkforceOptions, setLoadingWorkforceOptions] =
    useState(canCreate);

  const [email, setEmail] = useState("");
  const [jobProfileId, setJobProfileId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [managerOrganisationMembershipId, setManagerId] = useState("");
  const [agentProfileId, setAgentProfileId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [isDepartmentManager, setIsDepartmentManager] = useState(false);
  const [isTeamLead, setIsTeamLead] = useState(false);
  const [selectedRoleKeys, setSelectedRoleKeys] = useState<string[]>([]);

  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [revocationReason, setRevocationReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const roleNameByKey = useMemo(
    () => new Map(roles.map((role) => [role.key, role.name])),
    [roles],
  );
  const departmentNameById = useMemo(
    () =>
      new Map(
        workforceOptions.departments.map((department) => [
          department.id,
          department.name,
        ]),
      ),
    [workforceOptions.departments],
  );
  const teamNameById = useMemo(
    () => new Map(workforceOptions.teams.map((team) => [team.id, team.name])),
    [workforceOptions.teams],
  );
  const agentNameById = useMemo(
    () =>
      new Map(
        workforceOptions.agentProfiles.map((profile) => [
          profile.id,
          profile.name,
        ]),
      ),
    [workforceOptions.agentProfiles],
  );

  const selectedJobProfile = useMemo(
    () =>
      workforceOptions.jobProfiles.find(
        (profile) => profile.id === jobProfileId,
      ) ?? null,
    [jobProfileId, workforceOptions.jobProfiles],
  );

  const selectedAgentProfile = useMemo(
    () =>
      workforceOptions.agentProfiles.find(
        (profile) => profile.id === agentProfileId,
      ) ?? null,
    [agentProfileId, workforceOptions.agentProfiles],
  );

  const availableTeams = useMemo(() => {
    if (!departmentId) {
      return workforceOptions.teams;
    }

    return workforceOptions.teams.filter(
      (team) => team.departmentId === departmentId,
    );
  }, [departmentId, workforceOptions.teams]);

  const availableAgents = useMemo(
    () =>
      workforceOptions.agentProfiles.filter(
        (profile) =>
          profile.departmentId === null ||
          (!!departmentId && profile.departmentId === departmentId),
      ),
    [departmentId, workforceOptions.agentProfiles],
  );

  const availableRoles = useMemo(
    () =>
      roles.filter(
        (role) =>
          role.scope === "ORGANISATION" ||
          (role.scope === "DEPARTMENT" && !!departmentId) ||
          (role.scope === "TEAM" && !!teamId),
      ),
    [departmentId, roles, teamId],
  );

  const loadingConfiguration = loadingRoles || loadingWorkforceOptions;
  const configurationReady =
    workforceOptions.configurationReady &&
    workforceOptions.jobProfiles.length > 0 &&
    roles.length > 0;

  const retainCompatibleRoles = useCallback(
    (nextDepartmentId: string, nextTeamId: string) => {
      const allowedRoleKeys = new Set(
        roles
          .filter(
            (role) =>
              role.scope === "ORGANISATION" ||
              (role.scope === "DEPARTMENT" && !!nextDepartmentId) ||
              (role.scope === "TEAM" && !!nextTeamId),
          )
          .map((role) => role.key),
      );

      setSelectedRoleKeys((current) =>
        current.filter((roleKey) => allowedRoleKeys.has(roleKey)),
      );
    },
    [roles],
  );

  const loadInvitations = useCallback(
    async (signal?: AbortSignal) => {
      if (!canRead) {
        setLoadingInvitations(false);
        return;
      }

      setLoadingInvitations(true);

      const query = new URLSearchParams({
        organisationId,
        page: String(page),
        limit: String(PAGE_SIZE),
      });

      try {
        const response = await fetchWithTimeout(
          `/api/invitations?${query.toString()}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal,
            headers: { Accept: "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const result = invitationListSchema.parse(await response.json());

        setInvitations(result.items);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Invitations could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoadingInvitations(false);
        }
      }
    },
    [canRead, organisationId, page],
  );

  const loadRoles = useCallback(
    async (signal?: AbortSignal) => {
      if (!canCreate) {
        setLoadingRoles(false);
        return;
      }

      setLoadingRoles(true);

      try {
        const query = new URLSearchParams({ organisationId });
        const response = await fetchWithTimeout(
          `/api/invitations/roles?${query.toString()}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal,
            headers: { Accept: "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const result = assignableInvitationRoleListSchema.parse(
          await response.json(),
        );

        setRoles(result.items);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Assignable roles could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoadingRoles(false);
        }
      }
    },
    [canCreate, organisationId],
  );

  const loadWorkforceOptions = useCallback(
    async (signal?: AbortSignal) => {
      if (!canCreate) {
        setLoadingWorkforceOptions(false);
        return;
      }

      setLoadingWorkforceOptions(true);

      try {
        const query = new URLSearchParams({ organisationId });
        const response = await fetchWithTimeout(
          `/api/invitations/workforce-options?${query.toString()}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal,
            headers: { Accept: "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        setWorkforceOptions(
          invitationWorkforceOptionsSchema.parse(await response.json()),
        );
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Workforce configuration could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoadingWorkforceOptions(false);
        }
      }
    },
    [canCreate, organisationId],
  );

  useEffect(() => {
    const controller = new AbortController();

    const startRequest = window.setTimeout(() => {
      void loadInvitations(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(startRequest);
      controller.abort();
    };
  }, [loadInvitations]);

  useEffect(() => {
    const controller = new AbortController();

    const startRequests = window.setTimeout(() => {
      void Promise.all([
        loadRoles(controller.signal),
        loadWorkforceOptions(controller.signal),
      ]);
    }, 0);

    return () => {
      window.clearTimeout(startRequests);
      controller.abort();
    };
  }, [loadRoles, loadWorkforceOptions]);

  function handleJobProfileChange(nextJobProfileId: string): void {
    const nextProfile = workforceOptions.jobProfiles.find(
      (profile) => profile.id === nextJobProfileId,
    );
    const nextDepartmentId = nextProfile?.departmentId ?? "";

    setJobProfileId(nextJobProfileId);
    setJobTitle(nextProfile?.name ?? "");
    setDepartmentId(nextDepartmentId);
    setTeamId("");
    setAgentProfileId("");
    setIsDepartmentManager(false);
    setIsTeamLead(false);
    retainCompatibleRoles(nextDepartmentId, "");
    setError(null);
  }

  function handleDepartmentChange(nextDepartmentId: string): void {
    const currentTeam = workforceOptions.teams.find(
      (team) => team.id === teamId,
    );
    const nextTeamId =
      currentTeam?.departmentId === nextDepartmentId ? teamId : "";
    const currentAgent = workforceOptions.agentProfiles.find(
      (profile) => profile.id === agentProfileId,
    );
    const keepAgent =
      currentAgent?.departmentId === null ||
      currentAgent?.departmentId === nextDepartmentId;

    setDepartmentId(nextDepartmentId);
    setTeamId(nextTeamId);
    setAgentProfileId(keepAgent ? agentProfileId : "");
    setIsDepartmentManager(nextDepartmentId ? isDepartmentManager : false);
    setIsTeamLead(nextTeamId ? isTeamLead : false);
    retainCompatibleRoles(nextDepartmentId, nextTeamId);
    setError(null);
  }

  function handleTeamChange(nextTeamId: string): void {
    const selectedTeam = workforceOptions.teams.find(
      (team) => team.id === nextTeamId,
    );
    const nextDepartmentId = selectedTeam?.departmentId ?? departmentId;

    setTeamId(nextTeamId);

    if (selectedTeam?.departmentId && !selectedJobProfile?.departmentId) {
      setDepartmentId(selectedTeam.departmentId);
    }

    setIsTeamLead(nextTeamId ? isTeamLead : false);
    retainCompatibleRoles(nextDepartmentId, nextTeamId);
    setError(null);
  }

  function toggleRole(roleKey: string): void {
    setError(null);

    if (selectedRoleKeys.includes(roleKey)) {
      setSelectedRoleKeys((current) =>
        current.filter((key) => key !== roleKey),
      );
      return;
    }

    if (selectedRoleKeys.length >= 8) {
      setError("No more than eight roles can be selected.");
      return;
    }

    setSelectedRoleKeys((current) => [...current, roleKey]);
  }

  function resetInvitationForm(): void {
    setEmail("");
    setJobProfileId("");
    setJobTitle("");
    setDepartmentId("");
    setTeamId("");
    setManagerId("");
    setAgentProfileId("");
    setStartsAt("");
    setIsDepartmentManager(false);
    setIsTeamLead(false);
    setSelectedRoleKeys([]);
  }

  async function submitInvitation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!canCreate || creating || !configurationReady) {
      return;
    }

    setError(null);
    setNotice(null);

    let startsAtIso: string | undefined;

    if (startsAt) {
      const parsedStart = new Date(startsAt);

      if (Number.isNaN(parsedStart.getTime())) {
        setError("Select a valid employment start date and time.");
        return;
      }

      startsAtIso = parsedStart.toISOString();
    }

    const validation = createInvitationRequestSchema.safeParse({
      organisationId,
      email,
      roleKeys: selectedRoleKeys,
      jobProfileId,
      jobTitle,
      departmentId: departmentId || undefined,
      teamId: teamId || undefined,
      managerOrganisationMembershipId:
        managerOrganisationMembershipId || undefined,
      agentProfileId: agentProfileId || undefined,
      startsAt: startsAtIso,
      isDepartmentManager,
      isTeamLead,
    });

    if (!validation.success) {
      setError(
        validation.error.issues[0]?.message ??
          "Check the workforce invitation details.",
      );
      return;
    }

    setCreating(true);

    try {
      const response = await fetchWithTimeout("/api/invitations", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validation.data),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const created = invitationSchema.parse(await response.json());

      resetInvitationForm();
      setNotice(
        created.deliveryStatus === "SENT"
          ? `Workforce invitation sent securely to ${created.email}.`
          : `Workforce invitation created for ${created.email}.`,
      );

      if (canRead) {
        if (page !== 1) {
          setPage(1);
        } else {
          await loadInvitations();
        }
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The workforce invitation could not be created.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function submitRevocation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!revokeTarget || !canRevoke || revoking) {
      return;
    }

    setError(null);
    setNotice(null);

    const validation = revokeInvitationRequestSchema.safeParse({
      reason: revocationReason,
    });

    if (!validation.success) {
      setError(
        validation.error.issues[0]?.message ?? "Enter a revocation reason.",
      );
      return;
    }

    setRevoking(true);

    try {
      const query = new URLSearchParams({ organisationId });
      const response = await fetchWithTimeout(
        `/api/invitations/${encodeURIComponent(
          revokeTarget.id,
        )}/revoke?${query.toString()}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(validation.data),
        },
      );

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      invitationSchema.parse(await response.json());

      const revokedEmail = revokeTarget.email;
      setRevokeTarget(null);
      setRevocationReason("");
      setNotice(`Invitation for ${revokedEmail} was revoked.`);

      if (invitations.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadInvitations();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The invitation could not be revoked.",
      );
    } finally {
      setRevoking(false);
    }
  }

  const visibleFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const visibleTo = Math.min(page * PAGE_SIZE, total);

  return (
    <section className="mx-auto max-w-7xl">
      <header className="mb-7">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
          Workforce onboarding
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Team access and work assignment
        </h1>

        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          Invite an employee with an approved job profile, reporting line,
          department or team, KPI snapshot, least-privilege roles and an
          optional governed AI agent. Access is provisioned atomically only
          after verified-email acceptance.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,500px)_minmax(0,1fr)]">
        <aside>
          {canCreate ? (
            <form
              onSubmit={submitInvitation}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              noValidate
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <UserPlus aria-hidden="true" className="h-5 w-5" />
                </div>

                <div>
                  <h2 className="font-semibold text-slate-950">
                    Onboard team member
                  </h2>
                  <p className="text-sm text-slate-500">
                    Configuration is frozen when the invitation is issued.
                  </p>
                </div>
              </div>

              {!loadingConfiguration && !configurationReady && (
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                  <strong>Workforce setup required.</strong> Configure at least
                  one active job profile and assignable organisation role before
                  issuing employee access. No unsafe default role or job will be
                  invented.
                </div>
              )}

              <div className="mt-6">
                <label
                  htmlFor="invitation-email"
                  className="block text-sm font-medium text-slate-800"
                >
                  Verified work email
                </label>
                <input
                  id="invitation-email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="employee@company.co.uk"
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                />
              </div>

              <div className="mt-6 border-t border-slate-200 pt-6">
                <div className="flex items-center gap-2">
                  <BriefcaseBusiness
                    aria-hidden="true"
                    className="h-4 w-4 text-slate-600"
                  />
                  <h3 className="text-sm font-semibold text-slate-950">
                    Job and accountability
                  </h3>
                </div>

                <label
                  htmlFor="invitation-job-profile"
                  className="mt-4 block text-sm font-medium text-slate-800"
                >
                  Approved job profile
                </label>
                <select
                  id="invitation-job-profile"
                  required
                  value={jobProfileId}
                  disabled={loadingWorkforceOptions}
                  onChange={(event) =>
                    handleJobProfileChange(event.target.value)
                  }
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:bg-slate-100"
                >
                  <option value="">Select job profile</option>
                  {workforceOptions.jobProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.activeDutyCount} duties ·{" "}
                      {profile.activeKpiCount} KPIs
                    </option>
                  ))}
                </select>

                {selectedJobProfile?.description && (
                  <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    {selectedJobProfile.description}
                  </p>
                )}

                <label
                  htmlFor="invitation-job-title"
                  className="mt-4 block text-sm font-medium text-slate-800"
                >
                  Employee job title
                </label>
                <input
                  id="invitation-job-title"
                  type="text"
                  maxLength={160}
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder="Case Worker"
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                />

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="invitation-department"
                      className="block text-sm font-medium text-slate-800"
                    >
                      Department
                    </label>
                    <select
                      id="invitation-department"
                      value={departmentId}
                      disabled={!!selectedJobProfile?.departmentId}
                      onChange={(event) =>
                        handleDepartmentChange(event.target.value)
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-950 disabled:bg-slate-100"
                    >
                      <option value="">No department</option>
                      {workforceOptions.departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="invitation-team"
                      className="block text-sm font-medium text-slate-800"
                    >
                      Team
                    </label>
                    <select
                      id="invitation-team"
                      value={teamId}
                      onChange={(event) => handleTeamChange(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-950"
                    >
                      <option value="">No team</option>
                      {availableTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label
                  htmlFor="invitation-manager"
                  className="mt-4 block text-sm font-medium text-slate-800"
                >
                  Reporting manager
                </label>
                <select
                  id="invitation-manager"
                  value={managerOrganisationMembershipId}
                  onChange={(event) => setManagerId(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-950"
                >
                  <option value="">No reporting manager</option>
                  {workforceOptions.managers.map((manager) => (
                    <option
                      key={manager.organisationMembershipId}
                      value={manager.organisationMembershipId}
                    >
                      {manager.displayName}
                      {manager.jobTitle ? ` · ${manager.jobTitle}` : ""}
                    </option>
                  ))}
                </select>

                <label
                  htmlFor="invitation-starts-at"
                  className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-800"
                >
                  <CalendarClock aria-hidden="true" className="h-4 w-4" />
                  Employment/access start
                </label>
                <input
                  id="invitation-starts-at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
                />
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Leave blank to use the secure acceptance time.
                </p>

                {selectedJobProfile?.isManagerial && (
                  <div className="mt-4 space-y-2 rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-800">
                      Approved management duties
                    </p>
                    <label className="flex items-center gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        disabled={!departmentId}
                        checked={isDepartmentManager}
                        onChange={(event) =>
                          setIsDepartmentManager(event.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Department manager
                    </label>
                    <label className="flex items-center gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        disabled={!teamId}
                        checked={isTeamLead}
                        onChange={(event) =>
                          setIsTeamLead(event.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Team lead
                    </label>
                  </div>
                )}
              </div>

              <div className="mt-6 border-t border-slate-200 pt-6">
                <div className="flex items-center gap-2">
                  <Bot aria-hidden="true" className="h-4 w-4 text-slate-600" />
                  <h3 className="text-sm font-semibold text-slate-950">
                    Governed AI assistant
                  </h3>
                </div>

                <label
                  htmlFor="invitation-agent"
                  className="mt-4 block text-sm font-medium text-slate-800"
                >
                  Approved AI-agent profile
                </label>
                <select
                  id="invitation-agent"
                  value={agentProfileId}
                  onChange={(event) => setAgentProfileId(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-950"
                >
                  <option value="">No AI agent assigned</option>
                  {availableAgents.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {authorityLabel(profile)}
                    </option>
                  ))}
                </select>

                {selectedAgentProfile && (
                  <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 p-3 text-xs leading-5 text-sky-950">
                    <p>{selectedAgentProfile.description}</p>
                    <p className="mt-1 font-medium">
                      Authority ceiling: {authorityLabel(selectedAgentProfile)}.
                      {selectedAgentProfile.requiresHumanReview
                        ? " Human review is mandatory."
                        : " Actions remain limited by the employee’s effective permissions."}
                    </p>
                  </div>
                )}
              </div>

              <fieldset className="mt-6 border-t border-slate-200 pt-6">
                <legend className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                  Least-privilege access roles
                </legend>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Organisation roles are always available. Department and team
                  roles appear only after compatible structure is selected.
                </p>

                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                  {loadingRoles ? (
                    <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                      Loading authorised roles…
                    </p>
                  ) : availableRoles.length === 0 ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      No compatible assignable roles are available for the
                      selected structure.
                    </p>
                  ) : (
                    availableRoles.map((role) => (
                      <label
                        key={role.key}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRoleKeys.includes(role.key)}
                          onChange={() => toggleRole(role.key)}
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {role.name}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              {roleScopeLabel(role)}
                            </span>
                          </span>
                          {role.description && (
                            <span className="mt-1 block text-xs leading-5 text-slate-500">
                              {role.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={
                  creating ||
                  loadingConfiguration ||
                  !configurationReady ||
                  !jobProfileId ||
                  selectedRoleKeys.length === 0
                }
                className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MailPlus aria-hidden="true" className="h-4 w-4" />
                {creating
                  ? "Creating protected onboarding…"
                  : "Create and send workforce invitation"}
              </button>
            </form>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <ShieldCheck className="h-6 w-6 text-slate-700" />
              <h2 className="mt-4 font-semibold">
                Workforce onboarding restricted
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Your verified role can view this area but cannot create
                protected workforce-onboarding plans.
              </p>
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {canRead ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-950">
                    Onboarding history
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Pending and completed workforce access invitations
                  </p>
                </div>

                <button
                  type="button"
                  disabled={loadingInvitations}
                  onClick={() => void loadInvitations()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={`h-4 w-4 ${
                      loadingInvitations ? "animate-spin" : ""
                    }`}
                  />
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Employee
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Work assignment
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Access
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {loadingInvitations && invitations.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-12 text-center text-sm text-slate-500"
                        >
                          Loading workforce invitations…
                        </td>
                      </tr>
                    ) : invitations.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center">
                          <p className="font-medium text-slate-900">
                            No workforce invitations found
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Configure the workforce and issue the first secure
                            employee invitation.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      invitations.map((invitation) => (
                        <tr
                          key={invitation.id}
                          className="align-top hover:bg-slate-50"
                        >
                          <td className="px-4 py-4">
                            <p className="font-medium text-slate-950">
                              {invitation.email}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {invitation.jobTitle ?? "Legacy invitation"}
                            </p>
                          </td>

                          <td className="px-4 py-4 text-xs leading-5 text-slate-600">
                            <p className="flex items-center gap-1.5">
                              <Building2
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              {invitation.departmentId
                                ? (departmentNameById.get(
                                    invitation.departmentId,
                                  ) ?? "Configured department")
                                : "Organisation-wide"}
                            </p>
                            {invitation.teamId && (
                              <p className="mt-1 flex items-center gap-1.5">
                                <Users
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                />
                                {teamNameById.get(invitation.teamId) ??
                                  "Configured team"}
                              </p>
                            )}
                            {invitation.agentProfileId && (
                              <p className="mt-1 flex items-center gap-1.5 text-sky-700">
                                <Bot
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                />
                                {agentNameById.get(invitation.agentProfileId) ??
                                  "Governed AI profile"}
                              </p>
                            )}
                            {invitation.startsAt && (
                              <p className="mt-1">
                                Starts {formatDate(invitation.startsAt)}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-4">
                            <p className="text-sm text-slate-700">
                              {invitation.roleKeys.length > 0
                                ? invitation.roleKeys
                                    .map((key) => roleNameByKey.get(key) ?? key)
                                    .join(", ")
                                : "Legacy access"}
                            </p>
                          </td>

                          <td className="whitespace-nowrap px-4 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(
                                invitation.status,
                              )}`}
                            >
                              {statusLabel(invitation.status)}
                            </span>
                            <p
                              className={`mt-2 text-xs font-medium ${deliveryClass(
                                invitation.deliveryStatus,
                              )}`}
                            >
                              Email: {invitation.deliveryStatus.toLowerCase()}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Expires {formatDate(invitation.expiresAt)}
                            </p>
                          </td>

                          <td className="whitespace-nowrap px-4 py-4 text-right">
                            {canRevoke && canInvitationBeRevoked(invitation) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRevokeTarget(invitation);
                                  setRevocationReason("");
                                  setError(null);
                                }}
                                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600"
                              >
                                Revoke
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-slate-600">
                  Showing {visibleFrom}–{visibleTo} of {total}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || loadingInvitations}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={
                      totalPages === 0 ||
                      page >= totalPages ||
                      loadingInvitations
                    }
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <ShieldCheck className="h-6 w-6 text-slate-700" />
              <h2 className="mt-4 font-semibold">
                Onboarding history restricted
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Your role cannot view protected workforce-onboarding records.
              </p>
            </div>
          )}
        </div>
      </div>

      {revokeTarget && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !revoking) {
              setRevokeTarget(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="revoke-invitation-title"
            className="w-full rounded-t-2xl bg-white p-6 shadow-2xl sm:max-w-lg sm:rounded-2xl"
          >
            <h2
              id="revoke-invitation-title"
              className="text-xl font-semibold text-slate-950"
            >
              Revoke workforce invitation
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Revoke the pending invitation and its immutable onboarding plan
              for <strong>{revokeTarget.email}</strong>. The reason is retained
              in the protected audit trail.
            </p>

            <form onSubmit={submitRevocation} className="mt-5">
              <label
                htmlFor="revocation-reason"
                className="block text-sm font-medium text-slate-800"
              >
                Revocation reason
              </label>
              <textarea
                id="revocation-reason"
                required
                autoFocus
                rows={4}
                maxLength={500}
                value={revocationReason}
                onChange={(event) => setRevocationReason(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="Explain why this onboarding invitation is being revoked."
              />

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={revoking}
                  onClick={() => setRevokeTarget(null)}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={revoking || !revocationReason.trim()}
                  className="min-h-11 rounded-xl bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {revoking ? "Revoking…" : "Confirm revocation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}