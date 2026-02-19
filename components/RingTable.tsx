"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/types";

type RingTableProps = {
  analysis: AnalysisResult;
};

const PAGE_SIZE = 20;

export function RingTable({ analysis }: RingTableProps) {
  const [page, setPage] = useState(0);
  const rings = analysis.fraud_rings;

  if (rings.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
        No fraud rings detected in this dataset.
      </div>
    );
  }

  const totalPages = Math.ceil(rings.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const visibleRings = rings.slice(start, start + PAGE_SIZE);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Ring ID
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Pattern Type
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Member Count
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Risk Score
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Member Accounts
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {visibleRings.map((ring) => (
              <tr key={ring.ring_id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-800">
                  {ring.ring_id}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-zinc-800">
                  {ring.pattern_type}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-zinc-800">
                  {ring.member_accounts.length}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-zinc-800">
                  {ring.risk_score.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-700">
                  {ring.member_accounts.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-600">
          <span>
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, rings.length)} of{" "}
            {rings.length} rings
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-zinc-300 bg-white px-2 py-1 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-zinc-300 bg-white px-2 py-1 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
