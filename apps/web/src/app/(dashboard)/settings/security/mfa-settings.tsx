"use client";

import {
  type FormEvent,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Plus,
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";

import { getMfaChallengePath } from "@/lib/security/safe-return-path";
import { createClient } from "@/lib/supabase/client";

type AssuranceLevel = "aal1" | "aal2" | null;

interface MfaFactor {
  id: string;
  name: string;
  status: "verified" | "unverified";
  createdAt?: string;
}

interface EnrollmentState {
  factorId: string;
  friendlyName: string;
  qrCode: string;
  secret: string;
}

interface MfaSettingsProps {
  accountEmail: string;
}

interface SecurityState {
  assuranceLevel: AssuranceLevel;
  factors: MfaFactor[];
}

async function readSecurityState(): Promise<SecurityState> {
  const supabase = createClient();

  const [assuranceResult, factorsResult] =
    await Promise.all([
      supabase.auth.mfa
        .getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);

  if (
    assuranceResult.error ||
    factorsResult.error
  ) {
    throw new Error(
      "Unable to retrieve MFA security state.",
    );
  }

  const factors = (factorsResult.data.totp ?? [])
    .filter(
      (factor) =>
        factor.status === "verified" ||
        factor.status === "unverified",
    )
    .map<MfaFactor>((factor, index) => ({
      id: factor.id,
      name:
        factor.friendly_name?.trim() ||
        `Authenticator app ${index + 1}`,
      status:
        factor.status === "verified"
          ? "verified"
          : "unverified",
      createdAt: factor.created_at,
    }))
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "verified" ? -1 : 1;
      }

      return (
        Date.parse(right.createdAt ?? "") -
        Date.parse(left.createdAt ?? "")
      );
    });

  return {
    assuranceLevel:
  assuranceResult.data.currentLevel === "aal2"
    ? "aal2"
    : assuranceResult.data.currentLevel === "aal1"
      ? "aal1"
      : null,
    factors,
  };
}

function formatCreatedAt(
  value?: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isValidQrCode(value: string): boolean {
  return (
    value.startsWith("data:image/svg+xml") &&
    value.length <= 500_000
  );
}

export function MfaSettings({
  accountEmail,
}: MfaSettingsProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [operation, setOperation] =
    useState<string>();
  const [assuranceLevel, setAssuranceLevel] =
    useState<AssuranceLevel>(null);
  const [factors, setFactors] = useState<
    MfaFactor[]
  >([]);
  const [friendlyName, setFriendlyName] =
    useState("BusinessOS authenticator");
  const [enrollment, setEnrollment] =
    useState<EnrollmentState>();
  const [verificationCode, setVerificationCode] =
    useState("");
  const [
    confirmingFactorId,
    setConfirmingFactorId,
  ] = useState<string>();
  const [errorMessage, setErrorMessage] =
    useState<string>();
  const [successMessage, setSuccessMessage] =
    useState<string>();

  const busy = Boolean(operation);

  async function refreshSecurityState(): Promise<void> {
    const state = await readSecurityState();

    setAssuranceLevel(state.assuranceLevel);
    setFactors(state.factors);
  }

  useEffect(() => {
    let active = true;

    async function initialise(): Promise<void> {
      try {
        const state = await readSecurityState();

        if (!active) {
          return;
        }

        setAssuranceLevel(state.assuranceLevel);
        setFactors(state.factors);
      } catch {
        if (active) {
          setErrorMessage(
            "Your security settings are temporarily unavailable. Please try again.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void initialise();

    return () => {
      active = false;
    };
  }, []);

  async function handleStartEnrollment(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrorMessage(undefined);
    setSuccessMessage(undefined);

    const normalisedName = friendlyName.trim();

    if (
      normalisedName.length < 3 ||
      normalisedName.length > 64
    ) {
      setErrorMessage(
        "Authenticator name must contain between 3 and 64 characters.",
      );
      return;
    }

    if (
      factors.some(
        (factor) =>
          factor.status === "unverified",
      )
    ) {
      setErrorMessage(
        "Remove the incomplete authenticator setup before adding another one.",
      );
      return;
    }

    if (factors.length >= 10) {
      setErrorMessage(
        "The maximum number of authentication factors has been reached.",
      );
      return;
    }

    setOperation("enroll");

    const supabase = createClient();

    try {
      const result =
        await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: normalisedName,
        });

      if (result.error) {
        setErrorMessage(
          "A new authenticator could not be created. Check the name and try again.",
        );
        return;
      }

      const qrCode = result.data.totp?.qr_code;
      const secret = result.data.totp?.secret;

      if (
        !qrCode ||
        !secret ||
        !isValidQrCode(qrCode)
      ) {
        try {
          await supabase.auth.mfa.unenroll({
            factorId: result.data.id,
          });
        } catch {
          // The invalid incomplete factor can be
          // removed from this page after reloading.
        }

        setErrorMessage(
          "The authenticator setup response could not be validated. Please try again.",
        );
        return;
      }

      setEnrollment({
        factorId: result.data.id,
        friendlyName: normalisedName,
        qrCode,
        secret,
      });

      setVerificationCode("");
    } catch {
      setErrorMessage(
        "The secure enrolment service is temporarily unavailable. Please try again.",
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function handleVerifyEnrollment(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrorMessage(undefined);
    setSuccessMessage(undefined);

    if (!enrollment) {
      setErrorMessage(
        "Start authenticator setup before entering a verification code.",
      );
      return;
    }

    if (!/^\d{6}$/.test(verificationCode)) {
      setErrorMessage(
        "Enter the six-digit code from your authenticator app.",
      );
      return;
    }

    setOperation("verify");

    try {
      const supabase = createClient();

      const result =
        await supabase.auth.mfa
          .challengeAndVerify({
            factorId: enrollment.factorId,
            code: verificationCode,
          });

      if (result.error) {
        setErrorMessage(
          "The verification code is invalid or expired. Enter the latest code and try again.",
        );
        return;
      }

      const assuranceResult =
        await supabase.auth.mfa
          .getAuthenticatorAssuranceLevel();

      if (
        assuranceResult.error ||
        assuranceResult.data.currentLevel !==
          "aal2"
      ) {
        setErrorMessage(
          "The stronger authentication session could not be confirmed. Please try again.",
        );
        return;
      }

      setEnrollment(undefined);
      setVerificationCode("");
      setFriendlyName(
        "BusinessOS authenticator",
      );

      await refreshSecurityState();

      setSuccessMessage(
        "Authenticator enabled successfully. Your current session is now protected at AAL2.",
      );

      router.refresh();
    } catch {
      setErrorMessage(
        "The secure verification service is temporarily unavailable. Please try again.",
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function handleCancelEnrollment(): Promise<void> {
    if (!enrollment) {
      return;
    }

    setOperation("cancel");
    setErrorMessage(undefined);
    setSuccessMessage(undefined);

    try {
      const supabase = createClient();

      const result =
        await supabase.auth.mfa.unenroll({
          factorId: enrollment.factorId,
        });

      if (result.error) {
        setErrorMessage(
          "The incomplete authenticator setup could not be removed. Please try again.",
        );
        return;
      }

      setEnrollment(undefined);
      setVerificationCode("");

      await refreshSecurityState();

      setSuccessMessage(
        "Authenticator setup cancelled.",
      );
    } catch {
      setErrorMessage(
        "The incomplete authenticator setup could not be removed. Please try again.",
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function handleRemoveFactor(
    factor: MfaFactor,
  ): Promise<void> {
    setErrorMessage(undefined);
    setSuccessMessage(undefined);

    if (
      factor.status === "verified" &&
      assuranceLevel !== "aal2"
    ) {
      setErrorMessage(
        "Verify your identity at AAL2 before removing an active authenticator.",
      );
      return;
    }

    if (confirmingFactorId !== factor.id) {
      setConfirmingFactorId(factor.id);
      return;
    }

    setOperation(`remove:${factor.id}`);

    try {
      const supabase = createClient();

      const result =
        await supabase.auth.mfa.unenroll({
          factorId: factor.id,
        });

      if (result.error) {
        setErrorMessage(
          factor.status === "verified"
            ? "The authenticator could not be removed. Verify your identity and try again."
            : "The incomplete authenticator setup could not be removed.",
        );
        return;
      }

      if (factor.status === "verified") {
        const refreshResult =
          await supabase.auth.refreshSession();

        if (refreshResult.error) {
          await supabase.auth.signOut({
            scope: "local",
          });

          router.replace(
            "/login?returnTo=%2Fsettings%2Fsecurity",
          );
          router.refresh();
          return;
        }
      }

      setConfirmingFactorId(undefined);
      await refreshSecurityState();

      setSuccessMessage(
        factor.status === "verified"
          ? "Authenticator removed successfully."
          : "Incomplete authenticator setup removed.",
      );

      router.refresh();
    } catch {
      setErrorMessage(
        "The authenticator could not be removed. Please try again.",
      );
    } finally {
      setOperation(undefined);
    }
  }

  const verifiedFactors = factors.filter(
    (factor) => factor.status === "verified",
  );

  return (
    <div className="space-y-7">
      {errorMessage ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800"
        >
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          {successMessage}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-sm text-slate-500">
              Signed-in account
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {accountEmail}
            </h2>
          </div>

          <div
            className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${
              assuranceLevel === "aal2"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            <ShieldCheck
              aria-hidden="true"
              className="h-4 w-4"
            />
            {assuranceLevel === "aal2"
              ? "AAL2 verified session"
              : "AAL1 standard session"}
          </div>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-6">
          <p className="font-medium">
            Multi-factor authentication
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {verifiedFactors.length
              ? `${verifiedFactors.length} verified authenticator${verifiedFactors.length === 1 ? "" : "s"} protect this account.`
              : "No verified authenticator currently protects this account."}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="flex items-start gap-3">
          <Smartphone
            aria-hidden="true"
            className="mt-0.5 h-6 w-6 text-slate-700"
          />

          <div>
            <h2 className="text-lg font-semibold">
              Authenticator applications
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Manage the authenticator devices attached
              to your account.
            </p>
          </div>
        </div>

        {loading ? (
          <div
            role="status"
            className="flex items-center gap-3 py-10 text-sm text-slate-600"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-5 w-5 animate-spin"
            />
            Loading authentication factors…
          </div>
        ) : factors.length ? (
          <div className="mt-6 space-y-3">
            {factors.map((factor) => {
              const createdAt = formatCreatedAt(
                factor.createdAt,
              );

              const removing =
                operation ===
                `remove:${factor.id}`;

              return (
                <article
                  key={factor.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="flex items-start gap-3">
                      <KeyRound
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 text-slate-600"
                      />

                      <div>
                        <p className="font-medium">
                          {factor.name}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {factor.status === "verified"
                            ? "Verified authenticator"
                            : "Incomplete setup"}
                          {createdAt
                            ? ` · Added ${createdAt}`
                            : ""}
                        </p>
                      </div>
                    </div>

                    {factor.status === "verified" &&
                    assuranceLevel !== "aal2" ? (
                      <Link
                        href={getMfaChallengePath(
                          "/settings/security",
                        )}
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50"
                      >
                        Verify to manage
                      </Link>
                    ) : confirmingFactorId ===
                      factor.id ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleRemoveFactor(
                              factor,
                            )
                          }
                          className="inline-flex h-10 items-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
                        >
                          {removing ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="h-4 w-4 animate-spin"
                            />
                          ) : (
                            <Trash2
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          )}
                          Confirm
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirmingFactorId(
                              undefined,
                            )
                          }
                          className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void handleRemoveFactor(
                            factor,
                          )
                        }
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        <Trash2
                          aria-hidden="true"
                          className="h-4 w-4"
                        />
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-6 text-sm leading-6 text-slate-600">
            No authenticator application has been added.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        {enrollment ? (
          <>
            <div className="flex items-start gap-3">
              <QrCode
                aria-hidden="true"
                className="mt-0.5 h-6 w-6 text-slate-700"
              />

              <div>
                <h2 className="text-lg font-semibold">
                  Scan the QR code
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Add {enrollment.friendlyName} to
                  Microsoft Authenticator, Google
                  Authenticator, 1Password or another
                  compatible application.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
              <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollment.qrCode}
                  alt="Authenticator setup QR code"
                  width={208}
                  height={208}
                  className="h-52 w-52"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-slate-800">
                  Cannot scan the code?
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Enter this secret manually. Treat it like
                  a password and never share it.
                </p>

                <code className="mt-3 block break-all rounded-xl bg-slate-950 p-4 text-sm text-white">
                  {enrollment.secret}
                </code>
              </div>
            </div>

            <form
              onSubmit={handleVerifyEnrollment}
              className="mt-6 space-y-4"
              noValidate
            >
              <div>
                <label
                  htmlFor="enrollment-code"
                  className="mb-2 block text-sm font-medium text-slate-800"
                >
                  Six-digit verification code
                </label>

                <input
                  id="enrollment-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(event) =>
                    setVerificationCode(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, 6),
                    )
                  }
                  disabled={busy}
                  className="h-12 w-full max-w-xs rounded-xl border border-slate-300 px-4 font-mono text-lg tracking-[0.3em] outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={
                    busy ||
                    verificationCode.length !== 6
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {operation === "verify" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                  ) : (
                    <CheckCircle2
                      aria-hidden="true"
                      className="h-4 w-4"
                    />
                  )}
                  Enable authenticator
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void handleCancelEnrollment()
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 px-5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  <X
                    aria-hidden="true"
                    className="h-4 w-4"
                  />
                  Cancel setup
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">
              Add an authenticator
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Add at least two authenticators where
              possible so losing one device does not lock
              you out of your account.
            </p>

            <form
              onSubmit={handleStartEnrollment}
              className="mt-5 flex flex-col gap-3 sm:flex-row"
              noValidate
            >
              <div className="flex-1">
                <label
                  htmlFor="factor-name"
                  className="sr-only"
                >
                  Authenticator name
                </label>

                <input
                  id="factor-name"
                  value={friendlyName}
                  onChange={(event) =>
                    setFriendlyName(
                      event.target.value.slice(0, 64),
                    )
                  }
                  maxLength={64}
                  disabled={busy}
                  className="h-11 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="e.g. Work phone authenticator"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {operation === "enroll" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                ) : (
                  <Plus
                    aria-hidden="true"
                    className="h-4 w-4"
                  />
                )}
                Begin setup
              </button>
            </form>
          </>
        )}
      </section>

      <aside className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        Store access to a backup authenticator securely.
        BusinessOS administrators must never request your
        authenticator secret or current verification code.
      </aside>
    </div>
  );
}