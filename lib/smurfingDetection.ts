import type { GraphData } from "@/types";

export type SmurfingMetrics = {
  smurfingInCounts: Map<string, number>;
  smurfingOutCounts: Map<string, number>;
};

const WINDOW_MS = 72 * 60 * 60 * 1000;

function maxUniqueInWindow(
  entries: { counterpartyId: string; timestamp: Date }[],
): number {
  let maxUnique = 0;
  let start = 0;

  const currentSenders = new Map<string, number>();

  for (let end = 0; end < entries.length; end += 1) {
    const entry = entries[end];
    currentSenders.set(entry.counterpartyId, (currentSenders.get(entry.counterpartyId) ?? 0) + 1);

    const windowStartTime = entry.timestamp.getTime() - WINDOW_MS;

    while (start <= end && entries[start].timestamp.getTime() < windowStartTime) {
      const startEntry = entries[start];
      const count = (currentSenders.get(startEntry.counterpartyId) ?? 0) - 1;
      if (count <= 0) {
        currentSenders.delete(startEntry.counterpartyId);
      } else {
        currentSenders.set(startEntry.counterpartyId, count);
      }
      start += 1;
    }

    if (currentSenders.size > maxUnique) {
      maxUnique = currentSenders.size;
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

    if (inMax >= 10) {
      smurfingInCounts.set(accountId, inMax);
    }
    if (outMax >= 10) {
      smurfingOutCounts.set(accountId, outMax);
    }
  }

  return { smurfingInCounts, smurfingOutCounts };
}

