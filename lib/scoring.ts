import type {
  AnalysisResult,
  DetectionPattern,
  GraphData,
  SuspiciousAccount,
} from "@/types";
import type { SmurfingMetrics } from "./smurfingDetection";

export type AccountScoreContext = {
  accountId: string;
  cycleLength: 0 | 3 | 4 | 5;
  smurfingInCount: number;
  smurfingOutCount: number;
  hasLayeredShell: boolean;
  highVelocity: boolean;
  inDegree: number;
  outDegree: number;
  totalTransactions: number;
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;
  detectedPatterns: Set<DetectionPattern>;
  ringId?: string;
};

const WINDOW_MS = 72 * 60 * 60 * 1000;

export function buildAccountContexts(
  graph: GraphData,
  ringCycleLengths: Map<string, 3 | 4 | 5>,
  ringMembersByAccount: Map<string, string>,
  smurfingMetrics: SmurfingMetrics,
  layeredAccounts: Set<string>,
): Map<string, AccountScoreContext> {
  const contexts = new Map<string, AccountScoreContext>();

  const allAccounts = new Set<string>();
  for (const key of graph.adjacencyOut.keys()) allAccounts.add(key);
  for (const key of graph.adjacencyIn.keys()) allAccounts.add(key);

  for (const accountId of allAccounts) {
    const timestamps = graph.timestamps.get(accountId) ?? [];
    const firstTimestamp = timestamps[0] ?? null;
    const lastTimestamp = timestamps[timestamps.length - 1] ?? null;
    const inDegree = graph.inDegree.get(accountId) ?? 0;
    const outDegree = graph.outDegree.get(accountId) ?? 0;
    const totalTransactions = graph.transactionCounts.get(accountId) ?? 0;

    const ctx: AccountScoreContext = {
      accountId,
      cycleLength: ringCycleLengths.get(accountId) ?? 0,
      smurfingInCount: smurfingMetrics.smurfingInCounts.get(accountId) ?? 0,
      smurfingOutCount: smurfingMetrics.smurfingOutCounts.get(accountId) ?? 0,
      hasLayeredShell: layeredAccounts.has(accountId),
      highVelocity: false,
      inDegree,
      outDegree,
      totalTransactions,
      firstTimestamp,
      lastTimestamp,
      detectedPatterns: new Set<DetectionPattern>(),
      ringId: ringMembersByAccount.get(accountId),
    };

    contexts.set(accountId, ctx);
  }

  for (const ctx of contexts.values()) {
    // Only accounts that belong to at least one fraud ring are considered suspicious
    if (!ctx.ringId) continue;
    const { accountId } = ctx;
    const timestamps = graph.timestamps.get(accountId) ?? [];
    let maxTxInWindow = 0;
    let start = 0;

    for (let end = 0; end < timestamps.length; end += 1) {
      const endTime = timestamps[end]!.getTime();
      const windowStartTime = endTime - WINDOW_MS;
      while (start <= end && timestamps[start]!.getTime() < windowStartTime) {
        start += 1;
      }
      const count = end - start + 1;
      if (count > maxTxInWindow) {
        maxTxInWindow = count;
      }
    }

    if (maxTxInWindow > 8) {
      ctx.highVelocity = true;
      ctx.detectedPatterns.add("high_velocity");
    }

    const cycle = ctx.cycleLength;
    if (cycle === 3) ctx.detectedPatterns.add("cycle_length_3");
    if (cycle === 4) ctx.detectedPatterns.add("cycle_length_4");
    if (cycle === 5) ctx.detectedPatterns.add("cycle_length_5");

    if (ctx.smurfingInCount >= 10) ctx.detectedPatterns.add("smurfing_in");
    if (ctx.smurfingOutCount >= 10) ctx.detectedPatterns.add("smurfing_out");

    if (ctx.hasLayeredShell) ctx.detectedPatterns.add("layered_shell");
  }

  return contexts;
}

function scoreSmurfing(count: number): number {
  if (count < 10) return 0;
  if (count >= 30) return 45;
  if (count >= 20) return 35;
  return 25;
}

export function computeSuspicionScores(
  accountContexts: Map<string, AccountContext>,
  graph: Map<string, Set<string>>,
  layeredAccounts: Set<string>
) : SuspiciousAccount[] {
  const suspicious: SuspiciousAccount[] = [];

  for (const ctx of context.values()) {
    let score = 0;

    if (ctx.cycleLength === 3) score += 45;
    if (ctx.cycleLength === 4) score += 40;
    if (ctx.cycleLength === 5) score += 35;

    const smurfInScore = scoreSmurfing(ctx.smurfingInCount);
    const smurfOutScore = scoreSmurfing(ctx.smurfingOutCount);
    score += Math.max(smurfInScore, smurfOutScore);

    if (ctx.hasLayeredShell) score += 40;

    if (ctx.highVelocity) score += 15;

    const patternCount = ctx.detectedPatterns.size;
    if (patternCount >= 2) {
      score += 20;
    }

    if (ctx.inDegree > 50 && (ctx.outDegree <= 5)) {
      score -= 40;  
    }

    if (ctx.firstTimestamp && ctx.lastTimestamp) {
      const spanMs =
        ctx.lastTimestamp.getTime() - ctx.firstTimestamp.getTime();
      const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
      if (spanMs > sixMonthsMs) {
        score -= 20;
      }
    }

    const clamped = Math.min(100, Math.max(0, score));
    if (clamped <= 0) continue;

    const detectedPatterns = Array.from(ctx.detectedPatterns.values()).sort();

    suspicious.push({
      account_id: ctx.accountId,
      suspicion_score: Math.round(clamped * 10) / 10,
      detected_patterns: detectedPatterns,
      ring_id: ctx.ringId!,
    });
  }

  suspicious.sort((a, b) => {
    if (b.suspicion_score !== a.suspicion_score) {
      return b.suspicion_score - a.suspicion_score;
    }
    return a.account_id.localeCompare(b.account_id);
  });

  return suspicious;
}

export function buildAnalysisResultSummary(
  suspiciousAccounts: SuspiciousAccount[],
  fraudRingsCount: number,
  totalAccountsAnalyzed: number,
  processingTimeSeconds: number,
): AnalysisResult {
  return {
    suspicious_accounts: suspiciousAccounts,
    fraud_rings: [],
    summary: {
      total_accounts_analyzed: totalAccountsAnalyzed,
      suspicious_accounts_flagged: suspiciousAccounts.length,
      fraud_rings_detected: fraudRingsCount,
      processing_time_seconds:
        Math.round(processingTimeSeconds * 10) / 10,
    },
  };
}

