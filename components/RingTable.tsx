import type { AnalysisResult } from "@/types";

type RingTableProps = {
  analysis: AnalysisResult;
};

export function RingTable({ analysis }: RingTableProps) {
  if (analysis.fraud_rings.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
        No fraud rings detected in this dataset.
      </div>
    );
  }

  return (
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
          {analysis.fraud_rings.map((ring) => (
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
  );
}

