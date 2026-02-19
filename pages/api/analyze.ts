import type { NextApiRequest, NextApiResponse } from "next";
import Papa from "papaparse";
import {
  type AnalyzeApiResponse,
  type AnalysisResult,
  type GraphEdgeInfo,
  type GraphNodeInfo,
  type RawCsvRow,
  type Transaction,
} from "@/types";
import { buildGraph } from "@/lib/graphBuilder";
import { detectSmurfing } from "@/lib/smurfingDetection";
import { detectLayeredShellAccounts } from "@/lib/layeredDetection";
import { buildFraudRings } from "@/lib/ringBuilder";
import {
  buildAccountContexts,
  computeSuspicionScores,
  type AccountScoreContext,
} from "@/lib/scoring";
import { buildJsonResult } from "@/lib/jsonBuilder";

const EXPECTED_HEADER =
  "transaction_id,sender_id,receiver_id,amount,timestamp";

function parseTimestampStrict(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second)
  ) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(ms);
}

function validateAndParseCsv(csv: string): Transaction[] {
  const lines = csv.split(/\r?\n/);
  const firstNonEmptyLine = lines.find((line) => line.trim().length > 0) ?? "";
  if (firstNonEmptyLine.trim() !== EXPECTED_HEADER) {
    throw new Error("Invalid CSV header structure.");
  }

  const parsed = Papa.parse<RawCsvRow>(csv, {
    header: true,
    skipEmptyLines: "greedy",
  });

  if (parsed.errors.length > 0) {
    throw new Error("Failed to parse CSV content.");
  }

  const fields = parsed.meta.fields ?? [];
  if (
    fields.length !== 5 ||
    fields[0] !== "transaction_id" ||
    fields[1] !== "sender_id" ||
    fields[2] !== "receiver_id" ||
    fields[3] !== "amount" ||
    fields[4] !== "timestamp"
  ) {
    throw new Error("CSV columns do not match required schema.");
  }

  const transactions: Transaction[] = [];

  for (const row of parsed.data) {
    if (
      row.transaction_id == null ||
      row.sender_id == null ||
      row.receiver_id == null ||
      row.amount == null ||
      row.timestamp == null
    ) {
      throw new Error("CSV row contains missing values.");
    }

    const transactionId = String(row.transaction_id).trim();
    const senderId = String(row.sender_id).trim();
    const receiverId = String(row.receiver_id).trim();
    const amountRaw = String(row.amount).trim();
    const timestampRaw = String(row.timestamp).trim();

    if (!transactionId || !senderId || !receiverId || !amountRaw || !timestampRaw) {
      throw new Error("CSV row contains empty values.");
    }

    const amount = Number.parseFloat(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid transaction amount.");
    }

    const timestamp = parseTimestampStrict(timestampRaw);
    if (!timestamp) {
      throw new Error("Invalid timestamp format.");
    }

    transactions.push({
      transactionId,
      senderId,
      receiverId,
      amount,
      timestamp,
    });
  }

  return transactions;
}

function buildGraphElements(
  analysis: AnalysisResult,
  transactions: Transaction[],
  accountContexts: Map<string, AccountScoreContext>,
): { nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] } {
  const nodes: GraphNodeInfo[] = [];

  for (const [accountId, ctx] of accountContexts) {
    const suspiciousEntry = analysis.suspicious_accounts.find(
      (acc) => acc.account_id === accountId,
    );
    const suspicionScore = suspiciousEntry?.suspicion_score ?? 0;
    const detectedPatterns = suspiciousEntry
      ? suspiciousEntry.detected_patterns
      : Array.from(ctx.detectedPatterns.values()).sort();

    nodes.push({
      id: accountId,
      suspicion_score: suspicionScore,
      detected_patterns: detectedPatterns,
      ring_id: suspiciousEntry?.ring_id ?? "",
    });
  }

  const edgeSet = new Set<string>();
  const edges: GraphEdgeInfo[] = [];
  for (const tx of transactions) {
    const key = `${tx.senderId}->${tx.receiverId}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({
      source: tx.senderId,
      target: tx.receiverId,
    });
  }

  return { nodes, edges };
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeApiResponse | { error: string }>,
): void {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const startedAt = process.hrtime.bigint();

  try {
    const { csv } = (req.body ?? {}) as { csv?: string };

    if (!csv || typeof csv !== "string") {
      res.status(400).json({ error: "Missing CSV content in request body." });
      return;
    }

    const transactions = validateAndParseCsv(csv);

    const graph = buildGraph(transactions);
    const smurfingMetrics = detectSmurfing(graph);
    const layeredAccounts = detectLayeredShellAccounts(graph);

    const { rings: fraudRings, ringMembersByAccount } = buildFraudRings(
      graph,
      smurfingMetrics,
      layeredAccounts,
    );

    const ringCycleLengths = new Map<string, 3 | 4 | 5>();
    for (const ring of fraudRings) {
      if (ring.pattern_type !== "cycle") continue;
      const length = ring.member_accounts.length as 3 | 4 | 5;
      for (const acc of ring.member_accounts) {
        const current = ringCycleLengths.get(acc);
        if (!current || length < current) {
          ringCycleLengths.set(acc, length);
        }
      }
    }

    const accountContexts = buildAccountContexts(
      graph,
      ringCycleLengths,
      ringMembersByAccount,
      smurfingMetrics,
      layeredAccounts,
    );

    const suspiciousAccounts = computeSuspicionScores(accountContexts);
    const totalAccountsAnalyzed = accountContexts.size;

    const finishedAt = process.hrtime.bigint();
    const elapsedNs = Number(finishedAt - startedAt);
    const processingTimeSeconds = elapsedNs / 1_000_000_000;

    const analysis: AnalysisResult = buildJsonResult(
      suspiciousAccounts,
      fraudRings,
      totalAccountsAnalyzed,
      processingTimeSeconds,
    );

    const { nodes, edges } = buildGraphElements(
      analysis,
      transactions,
      accountContexts,
    );

    const responseBody: AnalyzeApiResponse = {
      analysis,
      graphNodes: nodes,
      graphEdges: edges,
    };

    res.status(200).json(responseBody);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown analysis error.";
    res.status(400).json({ error: message });
  }
}

