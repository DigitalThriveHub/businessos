"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { clientPortalRequest } from "@/components/client-portal/client-portal-client";
import { portalInvitationAcceptanceSchema } from "@/lib/client-portal";

export function PortalInvitationAcceptance() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validToken = /^bop_v1_[A-Za-z0-9_-]{43}$/.test(token);
  const returnTo = `/portal/invitations/accept?${new URLSearchParams({ token }).toString()}`;

  async function accept() {
    if (!validToken) return;
    setBusy(true);
    setError(null);
    try {
      await clientPortalRequest(
        "/api/client-portal/mutations",
        portalInvitationAcceptanceSchema,
        {
          method: "POST",
          body: JSON.stringify({ operation: "invitation.accept", payload: { token } }),
        },
      );
      router.replace("/portal");
      router.refresh();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white"><ShieldCheck className="h-6 w-6" /></span>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Activate secure client access</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Your signed-in account must use the exact verified email address named in the invitation. Access is limited to the authorised client and matters.</p>
        {!validToken ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">This invitation link is incomplete or invalid. Ask your case team to issue a new link.</p> : null}
        {error ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
        <div className="mt-6 flex flex-col gap-3"><button type="button" onClick={() => void accept()} disabled={!validToken || busy} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Activating…" : "Accept secure invitation"}</button><div className="grid gap-3 sm:grid-cols-2"><Link prefetch={false} href={`/login?${new URLSearchParams({ returnTo }).toString()}`} className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold">Sign in first</Link><Link prefetch={false} href={`/signup?${new URLSearchParams({ returnTo }).toString()}`} className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold">Create account</Link></div><Link prefetch={false} href="/portal" className="text-center text-sm font-semibold text-blue-800">Go to existing portal access</Link></div>
      </section>
    </main>
  );
}
