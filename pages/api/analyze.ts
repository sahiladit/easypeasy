import type { NextApiRequest, NextApiResponse } from "next";
import Papa from "papaparse";
import {
  type AnalyzeApiResponse,
  type AnalysisResult,
  type GraphEdgeInfo,
  type GraphNodeInfo,
  type PipelineStageTiming,
  type RawCsvRow,
  type TimingBreakdown,
  type Transaction,
} from "@/types";
import { buildGraph } from "@/lib/graphBuilder";
import { detectSmurfing } from "@/lib/smurfingDetection";
import { detectLayeredShellAccounts } from "@/lib/layeredDetection";
import { buildFraudRings } from "@/lib/ringBuilder";
import { extractFraudRingsFromMule } from "@/lib/sccDetection";
import {
  buildAccountContexts,
  computeSuspicionScores,
  type AccountScoreContext,
} from "@/lib/scoring";
import { buildJsonResult } from "@/lib/jsonBuilder";
import { buildNodeExplainerContexts } from "@/lib/explainerContext";

function elapsedMs(start: bigint, end: bigint): number {
  return Number((end - start) / BigInt(1_000_000));
}

const EXPECTED_HEADER =
  "transaction_id,sender_id,receiver_id,amount,timestamp";

function parseTimestampStrict(value: string): Date | null {
  const trimmed = value.trim();

  // Format 1: YYYY-MM-DD HH:MM:SS (e.g., 2024-01-21 03:01:00)
  // Format 1: YYYY-MM-DD H:MM:SS or HH:MM:SS
const match1 = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);

// Format 2: YYYY-MM-DD H:MM or HH:MM
const match2 = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/.exec(trimmed);

// Format 3: DD-MM-YYYY H:MM:SS or HH:MM:SS
const match3 = /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);

// Format 4: DD-MM-YYYY H:MM or HH:MM
const match4 = /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match1) {
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match1;
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

  if (match2) {
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match2;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute)
    ) {
      return null;
    }
    const ms = Date.UTC(year, month - 1, day, hour, minute, 0);
    return new Date(ms);
  }

  if (match3) {
    const [, dayStr, monthStr, yearStr, hourStr, minuteStr, secondStr] = match3;
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

  if (match4) {
    const [, dayStr, monthStr, yearStr, hourStr, minuteStr] = match4;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute)
    ) {
      return null;
    }
    const ms = Date.UTC(year, month - 1, day, hour, minute, 0);
    return new Date(ms);
  }

  return null;
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

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

    if (
      row.transaction_id == null ||
      row.sender_id == null ||
      row.receiver_id == null ||
      row.amount == null ||
      row.timestamp == null
    ) {
      throw new Error(
        `CSV row ${rowNumber} contains missing values. Expected columns: transaction_id, sender_id, receiver_id, amount, timestamp`,
      );
    }

    const transactionId = String(row.transaction_id).trim();
    const senderId = String(row.sender_id).trim();
    const receiverId = String(row.receiver_id).trim();
    const amountRaw = String(row.amount).trim();
    const timestampRaw = String(row.timestamp).trim();

    if (!transactionId || !senderId || !receiverId || !amountRaw || !timestampRaw) {
      throw new Error(`CSV row ${rowNumber} contains empty values.`);
    }

    const amount = Number.parseFloat(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        `CSV row ${rowNumber}: Invalid transaction amount "${amountRaw}". Amount must be a positive number.`,
      );
    }

    const timestamp = parseTimestampStrict(timestampRaw);
    if (!timestamp) {
      throw new Error(
        `CSV row ${rowNumber}: Invalid timestamp format "${timestampRaw}". Supported formats: "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DD HH:MM", "DD-MM-YYYY HH:MM:SS", "DD-MM-YYYY HH:MM".`,
      );
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

  const pipelineStart = process.hrtime.bigint();
  const stageTimings: { name: string; ms: number }[] = [];

  try {
    const { csv } = (req.body ?? {}) as { csv?: string };

    if (!csv || typeof csv !== "string") {
      res.status(400).json({ error: "Missing CSV content in request body." });
      return;
    }

    let t0 = process.hrtime.bigint();
    const transactions = validateAndParseCsv(csv);
    stageTimings.push({ name: "Data loading / preprocessing", ms: elapsedMs(t0, process.hrtime.bigint()) });

    t0 = process.hrtime.bigint();
    const graph = buildGraph(transactions);
    stageTimings.push({ name: "Graph build", ms: elapsedMs(t0, process.hrtime.bigint()) });

    t0 = process.hrtime.bigint();
    const { rings: cycleRings } = extractFraudRingsFromMule(graph);
    stageTimings.push({ name: "Cycle detection", ms: elapsedMs(t0, process.hrtime.bigint()) });

    t0 = process.hrtime.bigint();
    const smurfingMetrics = detectSmurfing(graph);
    stageTimings.push({ name: "Fan-in / Fan-out algorithm", ms: elapsedMs(t0, process.hrtime.bigint()) });

    t0 = process.hrtime.bigint();
    const layeredAccounts = detectLayeredShellAccounts(graph);
    stageTimings.push({ name: "Shell layer algorithm", ms: elapsedMs(t0, process.hrtime.bigint()) });

    t0 = process.hrtime.bigint();
    const { rings: fraudRings, ringMembersByAccount } = buildFraudRings(
      graph,
      smurfingMetrics,
      layeredAccounts,
      { preComputedCycleRings: cycleRings },
    );
    stageTimings.push({ name: "Ring aggregation", ms: elapsedMs(t0, process.hrtime.bigint()) });

    t0 = process.hrtime.bigint();
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
    const scoringMs = elapsedMs(t0, finishedAt);
    stageTimings.push({ name: "Scoring / aggregation", ms: scoringMs });

    const totalMs = elapsedMs(pipelineStart, finishedAt);
    const processingTimeSeconds = totalMs / 1000;

    const timingBreakdown: TimingBreakdown = {
      totalMs,
      stages: stageTimings.map((s) => ({
        stageName: s.name,
        timeMs: s.ms,
        percentOfTotal: totalMs > 0 ? Math.round((s.ms / totalMs) * 1000) / 10 : 0,
      })),
    };

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

    const nodeTimestamps: Record<string, number[]> = {};
    for (const [accountId, dates] of graph.timestamps) {
      nodeTimestamps[accountId] = dates.map((d) => d.getTime());
    }

    const nodeExplainerContext = buildNodeExplainerContexts(
      accountContexts,
      analysis,
    );

    const responseBody: AnalyzeApiResponse = {
      analysis,
      graphNodes: nodes,
      graphEdges: edges,
      nodeTimestamps,
      timingBreakdown,
      nodeExplainerContext,
    };

    res.status(200).json(responseBody);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown analysis error.";
    res.status(400).json({ error: message });
  }
}
