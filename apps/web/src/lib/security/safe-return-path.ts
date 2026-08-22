const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
const MAX_RETURN_PATH_LENGTH = 2_048;
const TRUSTED_ORIGIN = "https://businessos.invalid";
const PORTAL_INVITATION_PATH =
  "/portal/invitations/accept";
const PORTAL_INVITATION_TOKEN =
  /^bop_v1_[A-Za-z0-9_-]{43}$/;

const BLOCKED_RETURN_ROUTES = [
  "/login",
  "/signup",
  "/mfa",
  "/api",
] as const;

function matchesRoute(
  pathname: string,
  route: string,
): boolean {
  return (
    pathname === route ||
    pathname.startsWith(`${route}/`)
  );
}

export function getSafePostAuthenticationPath(
  value?: string | null,
): string {
  if (
    !value ||
    value.length > MAX_RETURN_PATH_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  try {
    const parsed = new URL(value, TRUSTED_ORIGIN);

    if (
      parsed.origin !== TRUSTED_ORIGIN ||
      BLOCKED_RETURN_ROUTES.some((route) =>
        matchesRoute(parsed.pathname, route),
      )
    ) {
      return DEFAULT_AUTHENTICATED_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }
}

export function getMfaChallengePath(
  returnTo?: string | null,
): string {
  const query = new URLSearchParams({
    returnTo:
      getSafePostAuthenticationPath(returnTo),
  });

  return `/mfa/challenge?${query.toString()}`;
}

export function isPortalInvitationReturnPath(
  value?: string | null,
): boolean {
  if (!value) {
    return false;
  }

  const safePath =
    getSafePostAuthenticationPath(value);

  try {
    const parsed = new URL(
      safePath,
      TRUSTED_ORIGIN,
    );

    const tokenValues =
      parsed.searchParams.getAll("token");

    const parameterNames = [
      ...parsed.searchParams.keys(),
    ];

    return (
      parsed.pathname ===
        PORTAL_INVITATION_PATH &&
      parsed.hash === "" &&
      tokenValues.length === 1 &&
      PORTAL_INVITATION_TOKEN.test(
        tokenValues[0] ?? "",
      ) &&
      parameterNames.length === 1 &&
      parameterNames[0] === "token"
    );
  } catch {
    return false;
  }
}
