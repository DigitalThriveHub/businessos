"use client";

import { useEffect } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Production telemetry captures the digest; no sensitive request data is logged here.
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
      <CircleAlert aria-hidden className="mx-auto h-9 w-9 text-rose-600" />
      <h1 className="mt-3 text-xl font-bold">This workspace could not load</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your data was not changed. Retry the safe request. If the problem continues,
        give support reference {error.digest ?? "shown in the error notification"}.
      </p>
      <button
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"
        onClick={reset}
      >
        <RefreshCw aria-hidden className="h-4 w-4" /> Retry
      </button>
    </section>
  );
}
