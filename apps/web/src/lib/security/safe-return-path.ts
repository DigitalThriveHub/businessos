const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
const MAX_RETURN_PATH_LENGTH = 2_048;
const TRUSTED_ORIGIN = "https://businessos.invalid";

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