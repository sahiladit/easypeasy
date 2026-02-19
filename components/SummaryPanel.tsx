"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/types";

type SummaryPanelProps = {
  analysis: AnalysisResult;
};

export function SummaryPanel({ analysis }: SummaryPanelProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const topAccounts = [...analysis.suspicious_accounts].slice(0, 5);
  const breakdown = analysis.summary.processing_time_breakdown ?? [];

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
        className="relative cursor-help space-y-1"
        onMouseEnter={() => setShowBreakdown(true)}
        onMouseLeave={() => setShowBreakdown(false)}
        title="Hover for step breakdown"
      >
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Processing Time (s)
        </div>
        <div className="text-2xl font-semibold text-zinc-900">
          {analysis.summary.processing_time_seconds.toFixed(1)}
        </div>
        {showBreakdown && breakdown.length > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[260px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-[11px] shadow-lg">
            <div className="mb-1.5 font-semibold text-zinc-800">
              Step breakdown
            </div>
            <div className="space-y-1">
              {breakdown.map((s) => (
                <div key={s.step} className="flex justify-between gap-4">
                  <span className="text-zinc-700">{s.step}</span>
                  <span className="shrink-0 font-mono text-zinc-900">
                    {s.time_ms.toFixed(1)} ms {s.pct > 0 && `(${s.pct}%)`}
                  </span>
                </div>
              ))}
            </div>
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

