"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route failed", {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <section
      role="alert"
      className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm"
    >
      <AlertTriangle aria-hidden="true" className="h-7 w-7 text-red-700" />
      <h1 className="mt-3 text-xl font-bold">This workspace could not load</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        No change was made. Check your connection, then retry. If the problem
        continues, give support the time of the failure—never send passwords or
        API keys.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"
      >
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
        Try again
      </button>
    </section>
  );
}
