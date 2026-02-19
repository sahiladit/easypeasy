import type { GraphData, Transaction, AccountTimeSeries } from "@/types";

export function buildGraph(transactions: Transaction[]): GraphData {
  const adjacencyOut = new Map<string, Set<string>>();
  const adjacencyIn = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const transactionCounts = new Map<string, number>();
  const timestamps = new Map<string, Date[]>();
  const timeSeries = new Map<string, AccountTimeSeries>();

  const ensureAccount = (accountId: string) => {
    if (!adjacencyOut.has(accountId)) adjacencyOut.set(accountId, new Set());
    if (!adjacencyIn.has(accountId)) adjacencyIn.set(accountId, new Set());
    if (!inDegree.has(accountId)) inDegree.set(accountId, 0);
    if (!outDegree.has(accountId)) outDegree.set(accountId, 0);
    if (!transactionCounts.has(accountId)) transactionCounts.set(accountId, 0);
    if (!timestamps.has(accountId)) timestamps.set(accountId, []);
    if (!timeSeries.has(accountId)) {
      timeSeries.set(accountId, { inbound: [], outbound: [] });
    }
  };

  for (const tx of transactions) {
    const { senderId, receiverId, timestamp } = tx;

    ensureAccount(senderId);
    ensureAccount(receiverId);

    adjacencyOut.get(senderId)!.add(receiverId);
    adjacencyIn.get(receiverId)!.add(senderId);

    outDegree.set(senderId, (outDegree.get(senderId) ?? 0) + 1);
    inDegree.set(receiverId, (inDegree.get(receiverId) ?? 0) + 1);

    transactionCounts.set(senderId, (transactionCounts.get(senderId) ?? 0) + 1);
    transactionCounts.set(
      receiverId,
      (transactionCounts.get(receiverId) ?? 0) + 1,
    );

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
  }

  for (const [, series] of timeSeries) {
    series.inbound.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    series.outbound.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  for (const [, ts] of timestamps) {
    ts.sort((a, b) => a.getTime() - b.getTime());
  }

  return {
    adjacencyOut,
    adjacencyIn,
    inDegree,
    outDegree,
    transactionCounts,
    timestamps,
    timeSeries,
  };
}

