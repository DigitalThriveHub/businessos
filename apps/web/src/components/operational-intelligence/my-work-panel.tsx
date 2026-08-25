import Link from "next/link";
import { CalendarClock, CheckSquare2 } from "lucide-react";

import type { OperationalIntelligenceDashboard } from "@/lib/operational-intelligence";

import {
  EmptyState,
  formatDateTime,
  formatLabel,
  MetricCard,
} from "./operational-intelligence-ui";

type Props = {
  data: OperationalIntelligenceDashboard["myWork"];
};

export function MyWorkPanel({ data }: Props) {
  const summary = data.summary;
  const metrics = [
    ["Open tasks", summary.openTasks, "default"],
    [
      "Overdue",
      summary.overdueTasks,
      summary.overdueTasks ? "danger" : "success",
    ],
    [
      "Deadlines (7d)",
      summary.deadlinesNextSevenDays,
      summary.deadlinesNextSevenDays ? "warning" : "default",
    ],
    [
      "My approvals",
      summary.pendingApprovals,
      summary.pendingApprovals ? "warning" : "default",
    ],
    ["Waiting on customer", summary.waitingOnCustomer, "default"],
    [
      "Document reviews",
      summary.documentReviews,
      summary.documentReviews ? "warning" : "default",
    ],
  ] as const;

  return (
    <div className="space-y-4">
      <section
        aria-label="My work summary"
        className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"
      >
        {metrics.map(([label, value, tone]) => (
          <MetricCard key={label} label={label} value={value} tone={tone} />
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-semibold">Prioritised queue</h2>
            <p className="text-xs text-slate-500">
              Your open tasks and deadlines, due first.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {data.items.length} shown
          </span>
        </div>

        {data.items.length ? (
          <div className="max-h-[52vh] overflow-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Work</th>
                  <th className="px-4 py-2.5 font-semibold">Matter</th>
                  <th className="px-4 py-2.5 font-semibold">Due</th>
                  <th className="px-4 py-2.5 font-semibold">Priority</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item) => {
                  const Icon =
                    item.kind === "TASK" ? CheckSquare2 : CalendarClock;
                  return (
                    <tr
                      key={`${item.kind}:${item.id}`}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/matters/${item.matterId}`}
                          className="flex items-center gap-2 font-medium text-slate-950 hover:underline"
                        >
                          <Icon
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-slate-500"
                          />
                          <span className="line-clamp-1">{item.title}</span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {item.matterNumber}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDateTime(item.dueAt)}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600">
                        {formatLabel(item.priority)}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600">
                        {formatLabel(item.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState>
              No open tasks or deadlines are assigned to you.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
