"use client";

import {
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import {
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/client";

type SessionState =
  | {
      status: "checking";
    }
  | {
      status: "anonymous";
    }
  | {
      status: "authenticated";
      email: string;
    }
  | {
      status: "error";
    };

type AcceptedInvitation = {
  organisationName: string;
  jobTitle: string | null;
};

type ApiMessage = {
  message?: unknown;
};

const INVITATION_TOKEN_PATTERN =
  /^boi_v1_[A-Za-z0-9_-]{43}$/;

const REQUEST_TIMEOUT_MS = 15_000;

function safeApiMessage(
  value: unknown,
): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const message =
    (value as ApiMessage).message;

  return typeof message === "string" &&
    message.length > 0 &&
    message.length <= 500
    ? message
    : null;
}

function parseAcceptedInvitation(
  value: unknown,
): AcceptedInvitation | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const record = value as Record<
    string,
    unknown
  >;

  if (
    record.status !== "ACCEPTED" ||
    typeof record.organisationName !==
      "string" ||
    !record.organisationName.trim() ||
    !(
      record.jobTitle === null ||
      typeof record.jobTitle === "string"
    )
  ) {
    return null;
  }

  return {
    organisationName:
      record.organisationName.trim(),
    jobTitle:
      typeof record.jobTitle === "string"
        ? record.jobTitle.trim() || null
        : null,
  };
}

export function InvitationAcceptanceLoading() {
  return (
    <AuthShell
      title="Checking invitation"
      description={
        <p>
          Verifying the secure invitation
          link and your current session.
        </p>
      }
    >
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
      >
        <LoaderCircle
          aria-hidden="true"
          className="h-5 w-5 animate-spin"
        />

        Preparing secure access…
      </div>
    </AuthShell>
  );
}

export function InvitationAcceptance() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tokenValues =
    searchParams.getAll("token");

  const token =
    tokenValues.length === 1
      ? tokenValues[0]?.trim() ?? ""
      : "";

  const validToken =
    INVITATION_TOKEN_PATTERN.test(token);

  const [session, setSession] =
    useState<SessionState>({
      status: "checking",
    });

  const [accepting, setAccepting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [accepted, setAccepted] =
    useState<AcceptedInvitation | null>(
      null,
    );

  useEffect(() => {
    let active = true;

    const startSessionCheck =
      window.setTimeout(() => {
        void (async () => {
          try {
            const supabase =
              createClient();

            const {
              data: { user },
              error: userError,
            } =
              await supabase.auth.getUser();

            if (!active) {
              return;
            }

            if (userError || !user) {
              setSession({
                status: "anonymous",
              });
              return;
            }

            setSession({
              status: "authenticated",
              email:
                user.email ??
                "verified account",
            });
          } catch {
            if (active) {
              setSession({
                status: "error",
              });
            }
          }
        })();
      }, 0);

    return () => {
      active = false;
      window.clearTimeout(
        startSessionCheck,
      );
    };
  }, []);

  const returnTo =
    validToken
      ? `/invitations/accept?token=${encodeURIComponent(
          token,
        )}`
      : "/invitations/accept";

  const loginHref =
    `/login?returnTo=${encodeURIComponent(
      returnTo,
    )}`;

  const signupHref =
    `/signup?returnTo=${encodeURIComponent(
      returnTo,
    )}`;

  async function acceptInvitation(): Promise<void> {
    if (
      !validToken ||
      session.status !==
        "authenticated" ||
      accepting
    ) {
      return;
    }

    setAccepting(true);
    setError(null);

    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

    try {
      const response = await fetch(
        "/api/invitations/accept",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            token,
          }),
        },
      );

      let responseBody: unknown = null;

      try {
        responseBody =
          await response.json();
      } catch {
        // A malformed response is handled below.
      }

      if (!response.ok) {
        if (response.status === 401) {
          setSession({
            status: "anonymous",
          });

          throw new Error(
            "Your secure session has expired. Sign in again to accept the invitation.",
          );
        }

        if (response.status === 403) {
          throw new Error(
            "This invitation belongs to a different verified email address.",
          );
        }

        if (
          response.status === 400 ||
          response.status === 404
        ) {
          throw new Error(
            "This invitation link is invalid or has expired.",
          );
        }

        if (response.status === 409) {
          throw new Error(
            "This invitation has already been accepted, revoked or is no longer available.",
          );
        }

        if (response.status === 429) {
          throw new Error(
            "Too many attempts. Please wait before trying again.",
          );
        }

        throw new Error(
          safeApiMessage(responseBody) ??
            "The invitation service is temporarily unavailable.",
        );
      }

      const result =
        parseAcceptedInvitation(
          responseBody,
        );

      if (!result) {
        throw new Error(
          "The invitation service returned an invalid response.",
        );
      }

      setAccepted(result);

      window.history.replaceState(
        null,
        "",
        "/invitations/accept?accepted=1",
      );
    } catch (caughtError) {
      if (
        caughtError instanceof DOMException &&
        caughtError.name === "AbortError"
      ) {
        setError(
          "The request timed out. Please try again.",
        );
      } else {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "The invitation could not be accepted.",
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setAccepting(false);
    }
  }

  if (session.status === "checking") {
    return <InvitationAcceptanceLoading />;
  }

  if (accepted) {
    return (
      <AuthShell
        title="Invitation accepted"
        description={
          <p>
            Your authorised organisation
            access is now active.
          </p>
        }
      >
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
        >
          <div className="flex gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700"
            />

            <div>
              <h2 className="font-semibold">
                Access confirmed
              </h2>

              <p className="mt-2 text-sm leading-6">
                You have joined{" "}
                <strong>
                  {accepted.organisationName}
                </strong>
                {accepted.jobTitle
                  ? ` as ${accepted.jobTitle}`
                  : ""}
                .
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            router.replace("/dashboard");
            router.refresh();
          }}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
        >
          Open BusinessOS

          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4"
          />
        </button>
      </AuthShell>
    );
  }

  if (!validToken) {
    return (
      <AuthShell
        title="Invitation unavailable"
        description={
          <p>
            This secure invitation link is
            invalid, incomplete or expired.
          </p>
        }
        backHref="/login"
        backLabel="Go to sign in"
      >
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />

          <p>
            Ask your organisation
            administrator to issue a new
            invitation. For security, expired
            or revoked links cannot be reused.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (session.status === "error") {
    return (
      <AuthShell
        title="Session unavailable"
        description={
          <p>
            Your authentication status could
            not be verified securely.
          </p>
        }
      >
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />

          <p>
            Refresh the page and try again. If
            the problem continues, contact your
            organisation administrator.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (session.status === "anonymous") {
    return (
      <AuthShell
        title="Accept your invitation"
        description={
          <p>
            Sign in or create an account using
            the exact email address that
            received this invitation.
          </p>
        }
      >
        {error && (
          <div
            role="alert"
            className="mb-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
          >
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />

            <p>{error}</p>
          </div>
        )}

        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
          <div className="flex gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0"
            />

            <p>
              BusinessOS will verify that your
              signed-in email matches the
              invitation before granting any
              organisation access.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <Link
            href={loginHref}
            prefetch={false}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            <LogIn
              aria-hidden="true"
              className="h-4 w-4"
            />

            Sign in to accept
          </Link>

          <Link
            href={signupHref}
            prefetch={false}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
          >
            <UserPlus
              aria-hidden="true"
              className="h-4 w-4"
            />

            Create secure account
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Confirm organisation access"
      description={
        <p>
          Review and accept the invitation for
          your verified BusinessOS account.
        </p>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"
        >
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />

          <p>{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Signed in as
        </p>

        <p className="mt-1 break-all text-sm font-medium text-slate-950">
          {session.email}
        </p>
      </div>

      <p className="mt-5 text-sm leading-6 text-slate-600">
        Only accept if you expected this
        invitation and recognise the
        organisation that sent it. Access will
        be assigned only after the backend
        verifies your email and invitation.
      </p>

      <button
        type="button"
        disabled={accepting}
        onClick={() =>
          void acceptInvitation()
        }
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {accepting ? (
          <>
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 animate-spin"
            />

            Accepting securely…
          </>
        ) : (
          <>
            <ShieldCheck
              aria-hidden="true"
              className="h-4 w-4"
            />

            Accept organisation invitation
          </>
        )}
      </button>
    </AuthShell>
  );
}