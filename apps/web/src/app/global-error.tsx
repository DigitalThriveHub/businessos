"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en-GB">
      <body className="bg-slate-50 text-slate-950">
        <main className="flex min-h-screen items-center justify-center p-6">
          <section className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-2xl font-bold">BusinessOS needs to reload</h1>
            <p className="mt-3 text-sm text-slate-600">
              No operation is being reported as complete. Reload the secured workspace
              and retry only after its current state is visible.
            </p>
            <button
              className="mt-5 h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"
              onClick={reset}
            >
              Reload workspace
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
