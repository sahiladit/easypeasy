import type {
  GraphData,
  Transaction,
  AccountTimeSeries,
  GraphEdgeWithMeta,
} from "@/types";

export function buildGraph(transactions: Transaction[]): GraphData {
  const adjacencyOut = new Map<string, Set<string>>();
  const adjacencyIn = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const transactionCounts = new Map<string, number>();
  const timestamps = new Map<string, Date[]>();
  const timeSeries = new Map<string, AccountTimeSeries>();
  const edges: GraphEdgeWithMeta[] = [];

  // Track already-initialized accounts to skip redundant Map.has() calls
  const seen = new Set<string>();

  const ensureAccount = (accountId: string) => {
    if (seen.has(accountId)) return;
    seen.add(accountId);
    adjacencyOut.set(accountId, new Set());
    adjacencyIn.set(accountId, new Set());
    inDegree.set(accountId, 0);
    outDegree.set(accountId, 0);
    transactionCounts.set(accountId, 0);
    timestamps.set(accountId, []);
    timeSeries.set(accountId, { inbound: [], outbound: [] });
  };

  // Pre-sort transactions by timestamp so timeSeries and timestamps
  // are built in order → eliminates the post-build sort passes
  const sorted = transactions.length > 1
    ? [...transactions].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    )
    : transactions;

  for (const tx of sorted) {
    const { senderId, receiverId, timestamp, amount } = tx;

    ensureAccount(senderId);
    ensureAccount(receiverId);

    adjacencyOut.get(senderId)!.add(receiverId);
    adjacencyIn.get(receiverId)!.add(senderId);

    outDegree.set(senderId, outDegree.get(senderId)! + 1);
    inDegree.set(receiverId, inDegree.get(receiverId)! + 1);

    transactionCounts.set(senderId, transactionCounts.get(senderId)! + 1);
    transactionCounts.set(receiverId, transactionCounts.get(receiverId)! + 1);

    timestamps.get(senderId)!.push(timestamp);
    timestamps.get(receiverId)!.push(timestamp);

    timeSeries.get(receiverId)!.inbound.push({
      counterpartyId: senderId,
      timestamp,
    });
    timeSeries.get(senderId)!.outbound.push({
      counterpartyId: receiverId,
      timestamp,
    });

    edges.push({
      source: senderId,
      target: receiverId,
      amount,
      timestamp,
    });
  }

  // Timestamps and timeSeries are already sorted because we pre-sorted
  // the transactions. No post-build sort passes needed.

  return {
    adjacencyOut,
    adjacencyIn,
    inDegree,
    outDegree,
    transactionCounts,
    timestamps,
    timeSeries,
    edges,
  };
}
