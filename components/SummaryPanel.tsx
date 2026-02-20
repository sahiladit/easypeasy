import { useState } from "react";
import type { AnalysisResult, TimingBreakdown } from "@/types";

type SummaryPanelProps = {
  analysis: AnalysisResult;
  /** Optional: per-stage timing for Processing Time hover breakdown. */
  timingBreakdown?: TimingBreakdown | null;
};

export function SummaryPanel({ analysis, timingBreakdown }: SummaryPanelProps) {
  const topAccounts = [...analysis.suspicious_accounts].slice(0, 5);
  const [showTimingBreakdown, setShowTimingBreakdown] = useState(false);

  return (
    <div className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-4">
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Total Accounts
        </div>
        <div className="text-2xl font-semibold text-zinc-900">
          {analysis.summary.total_accounts_analyzed}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Suspicious Accounts
        </div>
        <div className="text-2xl font-semibold text-amber-600">
          {analysis.summary.suspicious_accounts_flagged}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Fraud Rings
        </div>
        <div className="text-2xl font-semibold text-rose-600">
          {analysis.summary.fraud_rings_detected}
        </div>
      </div>
      <div
        className="relative space-y-1"
        onMouseEnter={() => setShowTimingBreakdown(true)}
        onMouseLeave={() => setShowTimingBreakdown(false)}
      >
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Processing Time (s)
        </div>
        <div className="text-2xl font-semibold text-zinc-900">
          {analysis.summary.processing_time_seconds.toFixed(1)}
        </div>
        {showTimingBreakdown && timingBreakdown && timingBreakdown.stages.length > 0 && (
          <div className="absolute left-0 top-full z-30 mt-1 min-w-[240px] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
            <div className="mb-2 text-xs font-semibold text-zinc-700">
              Pipeline stage breakdown
            </div>
            <ul className="space-y-1.5 text-[11px] text-zinc-600">
              {timingBreakdown.stages.map((s) => (
                <li key={s.stageName} className="flex justify-between gap-4">
                  <span>{s.stageName}</span>
                  <span className="font-mono tabular-nums">
                    {s.timeMs.toFixed(0)} ms
                    {s.percentOfTotal != null && ` (${s.percentOfTotal}%)`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {topAccounts.length > 0 && (
        <div className="col-span-full mt-2 border-t border-zinc-100 pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Top Suspicious Accounts
          </div>
          <ul className="mt-2 space-y-1 text-xs text-zinc-800">
            {topAccounts.map((acc) => (
              <li key={acc.account_id} className="flex justify-between">
                <span className="font-mono">{acc.account_id}</span>
                <span className="ml-2 text-amber-700">
                  {acc.suspicion_score.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

