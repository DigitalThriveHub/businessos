import { LoaderCircle } from "lucide-react";

export default function WorkforceConfigurationLoading() {
  return (
    <section
      role="status"
      className="mx-auto flex min-h-72 max-w-7xl items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 shadow-sm"
    >
      <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
      Opening protected operating model…
    </section>
  );
}