import type { GraphData } from "@/types";

export type SmurfingMetrics = {
  smurfingInCounts: Map<string, number>;
  smurfingOutCounts: Map<string, number>;
};

const WINDOW_MS = 72 * 60 * 60 * 1000;

const SMURFING_THRESHOLD = 5;

function maxUniqueInWindow(
  entries: { counterpartyId: string; timestamp: Date }[],
): number {
  const n = entries.length;

  // ── O(1) pre-check: fewer entries than threshold → impossible to reach it ──
  if (n < SMURFING_THRESHOLD) {
    // Still need the exact unique count (may be stored in result map)
    const unique = new Set<string>();
    for (let i = 0; i < n; i++) unique.add(entries[i].counterpartyId);
    return unique.size;
  }

  // ── Fast scan for total unique counterparties ──
  // Stop early once we confirm the threshold is reachable.
  const allUnique = new Set<string>();
  for (let i = 0; i < n; i++) {
    allUnique.add(entries[i].counterpartyId);
    if (allUnique.size >= SMURFING_THRESHOLD) break;
  }
  // If total unique < threshold, no window can reach it — skip sliding window
  if (allUnique.size < SMURFING_THRESHOLD) return allUnique.size;

  // Need exact total for early-exit optimisation in the sliding window
  if (allUnique.size === SMURFING_THRESHOLD) {
    // We stopped early; finish counting so we know the true total
    for (let i = SMURFING_THRESHOLD; i < n; i++) {
      allUnique.add(entries[i].counterpartyId);
    }
  }
  const totalUnique = allUnique.size;

  // ── Pre-compute timestamps as numbers (avoids repeated Date.getTime()) ──
  const ts = new Float64Array(n);
  for (let i = 0; i < n; i++) ts[i] = entries[i].timestamp.getTime();

  // ── Sliding window ──
  let maxUnique = 0;
  let start = 0;
  const window = new Map<string, number>();

  for (let end = 0; end < n; end++) {
    const cpId = entries[end].counterpartyId;
    window.set(cpId, (window.get(cpId) ?? 0) + 1);

    const windowStart = ts[end] - WINDOW_MS;

    while (ts[start] < windowStart) {
      const startCp = entries[start].counterpartyId;
      const cnt = window.get(startCp)! - 1;
      if (cnt === 0) {
        window.delete(startCp);
      } else {
        window.set(startCp, cnt);
      }
      start++;
    }

    if (window.size > maxUnique) {
      maxUnique = window.size;
      // Early exit: can't exceed total unique counterparties
      if (maxUnique === totalUnique) return maxUnique;
    }
  }

  return maxUnique;
}

export function detectSmurfing(graph: GraphData): SmurfingMetrics {
  const smurfingInCounts = new Map<string, number>();
  const smurfingOutCounts = new Map<string, number>();

  for (const [accountId, series] of graph.timeSeries) {
    const inMax = maxUniqueInWindow(series.inbound);
    const outMax = maxUniqueInWindow(series.outbound);

    if (inMax >= SMURFING_THRESHOLD) {
      smurfingInCounts.set(accountId, inMax);
    }
    if (outMax >= SMURFING_THRESHOLD) {
      smurfingOutCounts.set(accountId, outMax);
    }
  }

  return { smurfingInCounts, smurfingOutCounts };
}

