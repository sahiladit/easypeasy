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

// Constants for new scoring system
const BURST_WINDOW_DAYS = 7;
const BURST_WINDOW_MS = BURST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;
const WEIGHT_CYCLE = 0.35;
const WEIGHT_FAN = 0.30;
const WEIGHT_SHELL = 0.20;
const WEIGHT_BURST = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — RAW FEATURE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute cycle raw score
 * If cycle length L ∈ [3,5]: cycle_raw = 6 - L
 * Else: cycle_raw = 0
 */
function computeCycleRaw(cycleLength: 0 | 3 | 4 | 5): number {
  if (cycleLength >= 3 && cycleLength <= 5) {
    return 6 - cycleLength;
  }
  return 0;
}

/**
 * Compute fan raw score
 * fan_raw = max(fan_in_count, fan_out_count)
 */
function computeFanRaw(
  smurfingInCount: number,
  smurfingOutCount: number,
): number {
  return Math.max(smurfingInCount, smurfingOutCount);
}

/**
 * Compute layered shell chain depth for an account
 * Returns the maximum chain depth D where D >= 3
 */
function computeLayeredShellChainDepth(
  accountId: string,
  graph: GraphData,
  layeredAccounts: Set<string>,
): number {
  if (!layeredAccounts.has(accountId)) {
    return 0;
  }

  const MAX_DEPTH = 3;
  const isShell = (id: string) =>
    (graph.transactionCounts.get(id) ?? 0) <= 3;

  let maxDepth = 0;
  const queue: { path: string[] }[] = [];
  queue.push({ path: [accountId] });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { path } = current;
    const last = path[path.length - 1]!;
    const depth = path.length - 1;

    if (depth >= MAX_DEPTH) {
      const intermediates = path.slice(1, -1);
      if (intermediates.length >= 2 && intermediates.every(isShell)) {
        const chainDepth = path.length;
        maxDepth = Math.max(maxDepth, chainDepth);
      }
      continue;
    }

    const neighbors = graph.adjacencyOut.get(last);
    if (!neighbors) continue;

    for (const next of neighbors) {
      if (path.includes(next)) continue;
      const nextPath = [...path, next];
      queue.push({ path: nextPath });
    }
  }

  return maxDepth;
}

/**
 * Compute shell raw score
 * If chain depth D >= 3: shell_raw = D - 2
 * Else: shell_raw = 0
 */
function computeShellRaw(chainDepth: number): number {
  if (chainDepth >= 3) {
    return chainDepth - 2;
  }
  return 0;
}

/**
 * Compute burst raw score
 * Divide account lifespan into 7-day windows
 * burst_ratio = max_window_tx / average_window_tx
 */
function computeBurstRaw(timestamps: Date[]): number {
  if (timestamps.length === 0) {
    return 0;
  }

  const sorted = [...timestamps].sort(
    (a, b) => a.getTime() - b.getTime(),
  );
  const minTs = sorted[0]!.getTime();
  const maxTs = sorted[sorted.length - 1]!.getTime();
  const lifespanMs = maxTs - minTs;

  if (lifespanMs === 0) {
    return 0;
  }

  const numWindows = Math.ceil(lifespanMs / BURST_WINDOW_MS) || 1;
  const windowTxCounts: number[] = new Array(numWindows).fill(0);

  for (const ts of sorted) {
    const windowIndex = Math.floor(
      (ts.getTime() - minTs) / BURST_WINDOW_MS,
    );
    const clampedIndex = Math.min(windowIndex, numWindows - 1);
    windowTxCounts[clampedIndex] += 1;
  }

  const maxWindowTx = Math.max(...windowTxCounts);
  const sumTx = windowTxCounts.reduce((a, b) => a + b, 0);
  const averageWindowTx = sumTx / numWindows;

  if (averageWindowTx === 0) {
    return 0;
  }

  return maxWindowTx / averageWindowTx;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — VENDOR CONTINUITY RATIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute vendor continuity ratio
 * Measures transaction consistency over time
 */
function computeVendorContinuityRatio(timestamps: Date[]): number {
  if (timestamps.length === 0) {
    return 0;
  }

  const sorted = [...timestamps].sort(
    (a, b) => a.getTime() - b.getTime(),
  );
  const minTs = sorted[0]!.getTime();
  const maxTs = sorted[sorted.length - 1]!.getTime();
  const lifespanDays = (maxTs - minTs) / (24 * 60 * 60 * 1000);

  const numWindows = Math.ceil((maxTs - minTs) / BURST_WINDOW_MS) || 1;
  if (numWindows < 3) {
    return 0;
  }

  const windowTxCounts: number[] = new Array(numWindows).fill(0);
  for (const ts of sorted) {
    const windowIndex = Math.floor((ts.getTime() - minTs) / BURST_WINDOW_MS);
    const clampedIndex = Math.min(windowIndex, numWindows - 1);
    windowTxCounts[clampedIndex] += 1;
  }

  const meanTx =
    windowTxCounts.reduce((a, b) => a + b, 0) / numWindows;
  if (meanTx === 0) {
    return 0;
  }

  // Compute standard deviation
  const variance =
    windowTxCounts.reduce(
      (sum, count) => sum + Math.pow(count - meanTx, 2),
      0,
    ) / numWindows;
  const stdTx = Math.sqrt(variance);

  const CV = stdTx / meanTx;
  const continuityBase = 1 - Math.min(1, CV);
  const lifespanFactor = Math.min(1, lifespanDays / 180);
  const vendorContinuityRatio = continuityBase * lifespanFactor;

  return Math.max(0, Math.min(1, vendorContinuityRatio));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — APPLY VENDOR PROTECTION TO FAN SCORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply vendor protection to fan raw score
 */
function applyVendorProtectionToFan(
  fanRaw: number,
  vendorContinuityRatio: number,
): number {
  return fanRaw * (1 - vendorContinuityRatio);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — NORMALIZE FEATURES RELATIVE TO DATASET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a value relative to dataset min/max
 */
function normalizeValue(
  value: number,
  minValue: number,
  maxValue: number,
): number {
  if (maxValue === minValue) {
    return 0;
  }
  return (value - minValue) / (maxValue - minValue + EPSILON);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5-8 — COMPUTE FINAL SCORES
// ─────────────────────────────────────────────────────────────────────────────

export function computeSuspicionScores(
  contexts: Map<string, AccountScoreContext>,
  graph: GraphData,
  layeredAccounts: Set<string>,
): SuspiciousAccount[] {
  // Collect all accounts with ringId (suspicious accounts)
  const suspiciousContexts = Array.from(contexts.values()).filter(
    (ctx) => ctx.ringId !== undefined,
  );

  if (suspiciousContexts.length === 0) {
    return [];
  }

  // STEP 1: Compute raw features for all accounts
  type RawFeatures = {
    cycleRaw: number;
    fanRaw: number;
    shellRaw: number;
    burstRaw: number;
    vendorContinuityRatio: number;
    lifespanDays: number;
  };

  const rawFeaturesMap = new Map<string, RawFeatures>();

  for (const ctx of suspiciousContexts) {
    const timestamps = graph.timestamps.get(ctx.accountId) ?? [];
    const chainDepth = computeLayeredShellChainDepth(
      ctx.accountId,
      graph,
      layeredAccounts,
    );

    const cycleRaw = computeCycleRaw(ctx.cycleLength);
    const fanRaw = computeFanRaw(
      ctx.smurfingInCount,
      ctx.smurfingOutCount,
    );
    const shellRaw = computeShellRaw(chainDepth);
    const burstRaw = computeBurstRaw(timestamps);
    const vendorContinuityRatio = computeVendorContinuityRatio(timestamps);

    let lifespanDays = 0;
    if (ctx.firstTimestamp && ctx.lastTimestamp) {
      lifespanDays =
        (ctx.lastTimestamp.getTime() - ctx.firstTimestamp.getTime()) /
        (24 * 60 * 60 * 1000);
    }

    rawFeaturesMap.set(ctx.accountId, {
      cycleRaw,
      fanRaw,
      shellRaw,
      burstRaw,
      vendorContinuityRatio,
      lifespanDays,
    });
  }

  // STEP 3: Apply vendor protection to fan scores
  const adjustedFanRawMap = new Map<string, number>();
  for (const [accountId, features] of rawFeaturesMap) {
    const adjustedFanRaw = applyVendorProtectionToFan(
      features.fanRaw,
      features.vendorContinuityRatio,
    );
    adjustedFanRawMap.set(accountId, adjustedFanRaw);
  }

  // STEP 4: Find min/max for normalization
  const cycleRaws = Array.from(rawFeaturesMap.values()).map((f) => f.cycleRaw);
  const fanRaws = Array.from(adjustedFanRawMap.values());
  const shellRaws = Array.from(rawFeaturesMap.values()).map((f) => f.shellRaw);
  const burstRaws = Array.from(rawFeaturesMap.values()).map((f) => f.burstRaw);

  const minCycleRaw = Math.min(...cycleRaws);
  const maxCycleRaw = Math.max(...cycleRaws);
  const minFanRaw = Math.min(...fanRaws);
  const maxFanRaw = Math.max(...fanRaws);
  const minShellRaw = Math.min(...shellRaws);
  const maxShellRaw = Math.max(...shellRaws);
  const minBurstRaw = Math.min(...burstRaws);
  const maxBurstRaw = Math.max(...burstRaws);

  // STEP 5-8: Compute final scores
  const suspicious: SuspiciousAccount[] = [];

  for (const ctx of suspiciousContexts) {
    const features = rawFeaturesMap.get(ctx.accountId)!;
    const adjustedFanRaw = adjustedFanRawMap.get(ctx.accountId)!;

    // Normalize features
    const cycleNorm = normalizeValue(
      features.cycleRaw,
      minCycleRaw,
      maxCycleRaw,
    );
    const fanNorm = normalizeValue(adjustedFanRaw, minFanRaw, maxFanRaw);
    const shellNorm = normalizeValue(
      features.shellRaw,
      minShellRaw,
      maxShellRaw,
    );
    const burstNorm = normalizeValue(
      features.burstRaw,
      minBurstRaw,
      maxBurstRaw,
    );

    // Weighted combination
    const riskScore01 =
      WEIGHT_CYCLE * cycleNorm +
      WEIGHT_FAN * fanNorm +
      WEIGHT_SHELL * shellNorm +
      WEIGHT_BURST * burstNorm;

    // Scale to 0-100
    let finalScore = riskScore01 * 100;
    finalScore = Math.min(100, Math.max(0, finalScore));

    // STEP 7: Optional vendor dampening
    if (
      features.vendorContinuityRatio > 0.6 &&
      features.lifespanDays > 90
    ) {
      finalScore = finalScore * 0.7;
      finalScore = Math.min(100, Math.max(0, finalScore));
    }

    // Round to 2 decimal places
    finalScore = Math.round(finalScore * 100) / 100;

    // Only include accounts with score > 0
    if (finalScore <= 0) continue;

    const detectedPatterns = Array.from(ctx.detectedPatterns.values()).sort();

    suspicious.push({
      account_id: ctx.accountId,
      suspicion_score: finalScore,
      detected_patterns: detectedPatterns,
      ring_id: ctx.ringId!,
    });
  }

  // Sort by score descending, then by account_id
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

