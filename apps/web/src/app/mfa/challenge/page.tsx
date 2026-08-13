"use client";

import {
  type FormEvent,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import { getSafePostAuthenticationPath } from "@/lib/security/safe-return-path";
import { createClient } from "@/lib/supabase/client";

interface FactorOption {
  id: string;
  name: string;
}

export default function MfaChallengePage() {
  const router = useRouter();

  const [returnTo, setReturnTo] =
    useState("/dashboard");
  const [factors, setFactors] = useState<
    FactorOption[]
  >([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] =
    useState(false);
  const [signingOut, setSigningOut] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState<string>();

  useEffect(() => {
    let active = true;

    async function initialise(): Promise<void> {
      const requestedReturnPath =
        new URLSearchParams(
          window.location.search,
        ).get("returnTo");

      const safeReturnPath =
        getSafePostAuthenticationPath(
          requestedReturnPath,
        );

      if (active) {
        setReturnTo(safeReturnPath);
      }

      const supabase = createClient();

      try {
        const assuranceResult =
          await supabase.auth.mfa
            .getAuthenticatorAssuranceLevel();

        if (!active) {
          return;
        }

        if (assuranceResult.error) {
          throw assuranceResult.error;
        }

        const { currentLevel, nextLevel } =
          assuranceResult.data;

        if (currentLevel === "aal2") {
          router.replace(safeReturnPath);
          router.refresh();
          return;
        }

        if (
          currentLevel !== "aal1" ||
          nextLevel !== "aal2"
        ) {
          setErrorMessage(
            "No verified authenticator is available for this account.",
          );
          setLoading(false);
          return;
        }

        const factorsResult =
          await supabase.auth.mfa.listFactors();

        if (!active) {
          return;
        }

        if (factorsResult.error) {
          throw factorsResult.error;
        }

        const verifiedFactors = (
          factorsResult.data.totp ?? []
        )
          .filter(
            (factor) =>
              factor.status === "verified",
          )
          .map((factor, index) => ({
            id: factor.id,
            name:
              factor.friendly_name?.trim() ||
              `Authenticator app ${index + 1}`,
          }));

        if (!verifiedFactors.length) {
          setErrorMessage(
            "No verified authenticator is available for this account.",
          );
          setLoading(false);
          return;
        }

        setFactors(verifiedFactors);
        setFactorId(verifiedFactors[0].id);
        setLoading(false);
      } catch {
        if (active) {
          setErrorMessage(
            "The secure verification service is temporarily unavailable. Please try again.",
          );
          setLoading(false);
        }
      }
    }

    void initialise();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleVerify(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrorMessage(undefined);

    if (!factorId) {
      setErrorMessage(
        "Select an authenticator before continuing.",
      );
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setErrorMessage(
        "Enter the six-digit code from your authenticator app.",
      );
      return;
    }

    setVerifying(true);

    try {
      const supabase = createClient();

      const verificationResult =
        await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code,
        });

      if (verificationResult.error) {
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

      router.replace(returnTo);
      router.refresh();
    } catch {
      setErrorMessage(
        "The secure verification service is temporarily unavailable. Please try again.",
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    setErrorMessage(undefined);

    try {
      const supabase = createClient();

      const result = await supabase.auth.signOut({
        scope: "local",
      });

      if (result.error) {
        setErrorMessage(
          "We could not securely end this session. Please try again.",
        );
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setErrorMessage(
        "We could not securely end this session. Please try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white">
              <ShieldCheck
                aria-hidden="true"
                className="h-6 w-6"
              />
            </div>

            <div>
              <p className="font-semibold text-slate-950">
                BusinessOS
              </p>
              <p className="text-sm text-slate-500">
                Secure identity verification
              </p>
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/40 sm:p-9">
          <header className="mb-7">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <Smartphone
                aria-hidden="true"
                className="h-6 w-6"
              />
            </div>

            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              Verify your identity
            </h1>

            <p className="mt-3 leading-6 text-slate-600">
              Enter the current six-digit code from your
              authenticator app.
            </p>
          </header>

          {errorMessage ? (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
            >
              {errorMessage}
            </div>
          ) : null}

          {loading ? (
            <div
              role="status"
              className="flex items-center justify-center gap-3 py-10 text-sm text-slate-600"
            >
              <LoaderCircle
                aria-hidden="true"
                className="h-5 w-5 animate-spin"
              />
              Loading secure verification…
            </div>
          ) : factors.length ? (
            <form
              onSubmit={handleVerify}
              className="space-y-5"
              noValidate
            >
              {factors.length > 1 ? (
                <div>
                  <label
                    htmlFor="mfa-factor"
                    className="mb-2 block text-sm font-medium text-slate-800"
                  >
                    Authenticator
                  </label>

                  <select
                    id="mfa-factor"
                    value={factorId}
                    onChange={(event) =>
                      setFactorId(event.target.value)
                    }
                    disabled={verifying}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  >
                    {factors.map((factor) => (
                      <option
                        key={factor.id}
                        value={factor.id}
                      >
                        {factor.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="mfa-code"
                  className="mb-2 block text-sm font-medium text-slate-800"
                >
                  Verification code
                </label>

                <div className="relative">
                  <KeyRound
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    id="mfa-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) =>
                      setCode(
                        event.target.value
                          .replace(/\D/g, "")
                          .slice(0, 6),
                      )
                    }
                    disabled={verifying}
                    required
                    autoFocus
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-4 text-center font-mono text-xl tracking-[0.35em] text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                    aria-describedby="mfa-code-help"
                  />
                </div>

                <p
                  id="mfa-code-help"
                  className="mt-2 text-sm text-slate-500"
                >
                  Codes refresh approximately every 30
                  seconds.
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  verifying ||
                  signingOut ||
                  code.length !== 6
                }
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                    Verifying securely…
                  </>
                ) : (
                  <>
                    <LockKeyhole
                      aria-hidden="true"
                      className="h-4 w-4"
                    />
                    Verify and continue
                  </>
                )}
              </button>
            </form>
          ) : null}

          <div className="mt-7 border-t border-slate-200 pt-6">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={verifying || signingOut}
              className="flex w-full items-center justify-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingOut ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                <LogOut
                  aria-hidden="true"
                  className="h-4 w-4"
                />
              )}
              Sign out and use another account
            </button>
          </div>
        </section>

        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          Verification codes and authentication secrets
          are never stored by BusinessOS.
        </p>
      </div>
    </main>
  );
}