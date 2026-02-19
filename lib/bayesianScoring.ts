/**
 * Bayesian log-odds scoring — Stages 2–5.
 * Evidence accumulation via log-odds, sigmoid normalization, FP dampener,
 * final score in (5, 95).
 */

import type { DetectionPattern, SuspiciousAccount } from "@/types";
import {
  type CycleInfo,
  computeAllFeatures,
  getCycleInfo,
} from "./bayesianFeatures";
import type { FraudRing, GraphData, Transaction } from "@/types";

const P0 = 0.05;
const GAMMA = 1.5;
const EPS = 1e-9;

const WEIGHTS: Record<string, number> = {
  c: 0.28,
  g: 0.18,
  t: 0.16,
  sh: 0.12,
  e: 0.1,
  v: 0.09,
  n: 0.07,
};

const FEATURE_KEYS = ["c", "g", "t", "sh", "e", "v", "n"] as const;

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function logit(p: number): number {
  const pp = Math.max(EPS, Math.min(1 - EPS, p));
  return Math.log(pp / (1 - pp));
}

export function computeBayesianScores(
  graph: GraphData,
  transactions: Transaction[],
  fraudRings: FraudRing[],
  ringMembersByAccount: Map<string, string>,
  layeredAccounts?: Set<string>
): SuspiciousAccount[] {
  const cycleInfo = getCycleInfo(fraudRings);
  const { accountFeatures, datasetStats } = computeAllFeatures(
    graph,
    transactions,
    cycleInfo
  );

  const { mean, std } = datasetStats;
  const kParams: number[] = [];
  for (let i = 0; i < FEATURE_KEYS.length; i += 1) {
    const mu = mean[i] ?? 0;
    const sigma = std[i] ?? EPS;
    const CV = sigma / (mu + EPS);
    kParams.push(1 / (1 + CV));
  }

  const L0 = Math.log(P0 / (1 - P0));
  const results: { accountId: string; score: number }[] = [];

  for (const [accountId, features] of accountFeatures) {
    let L = L0;

    for (let i = 0; i < FEATURE_KEYS.length; i += 1) {
      const key = FEATURE_KEYS[i]!;
      const raw = features[key as keyof typeof features] as number;
      const mu = mean[i] ?? 0;
      const sigma = std[i] ?? EPS;
      const z = (raw - mu) / (sigma + EPS);
      const k = kParams[i] ?? 1;
      const x = sigmoid(k * z);
      const xClamped = Math.max(0.01, Math.min(0.99, x));
      const w = WEIGHTS[key] ?? 0;
      L += w * logit(xClamped);
    }

    const fpSignal = features.fp;
    const fpPenalty = -GAMMA * fpSignal;
    const L_damped = L + fpPenalty;

    const P = sigmoid(L_damped);
    const score = 5 + 90 * P;
    const clamped = Math.max(5.01, Math.min(94.99, score));

    results.push({ accountId, score: clamped });
  }

  const ringId = (acc: string) => ringMembersByAccount.get(acc) ?? "";
  const SUSPICIOUS_THRESHOLD = 50;

  const sorted = results
    .filter((r) => r.score >= SUSPICIOUS_THRESHOLD || ringId(r.accountId))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.accountId.localeCompare(b.accountId);
    });

  const suspicious: SuspiciousAccount[] = sorted.map((r) => {
    const patterns = inferPatterns(
      graph,
      r.accountId,
      r.score,
      cycleInfo,
      ringMembersByAccount,
      layeredAccounts
    );
    return {
      account_id: r.accountId,
      suspicion_score: Math.round(r.score * 10) / 10,
      detected_patterns: patterns,
      ring_id: ringId(r.accountId),
    };
  });

  return suspicious;
}

/** Returns score for every account (for graph node coloring). */
export function computeAllBayesianScores(
  graph: GraphData,
  transactions: Transaction[],
  fraudRings: FraudRing[],
  ringMembersByAccount: Map<string, string>,
  layeredAccounts?: Set<string>
): Map<string, { score: number; patterns: DetectionPattern[] }> {
  const cycleInfo = getCycleInfo(fraudRings);
  const { accountFeatures, datasetStats } = computeAllFeatures(
    graph,
    transactions,
    cycleInfo
  );

  const { mean, std } = datasetStats;
  const kParams: number[] = [];
  for (let i = 0; i < FEATURE_KEYS.length; i += 1) {
    const mu = mean[i] ?? 0;
    const sigma = std[i] ?? EPS;
    const CV = sigma / (mu + EPS);
    kParams.push(1 / (1 + CV));
  }

  const L0 = Math.log(P0 / (1 - P0));
  const out = new Map<string, { score: number; patterns: DetectionPattern[] }>();

  for (const [accountId, features] of accountFeatures) {
    let L = L0;

    for (let i = 0; i < FEATURE_KEYS.length; i += 1) {
      const key = FEATURE_KEYS[i]!;
      const raw = features[key as keyof typeof features] as number;
      const mu = mean[i] ?? 0;
      const sigma = std[i] ?? EPS;
      const z = (raw - mu) / (sigma + EPS);
      const k = kParams[i] ?? 1;
      const x = sigmoid(k * z);
      const xClamped = Math.max(0.01, Math.min(0.99, x));
      const w = WEIGHTS[key] ?? 0;
      L += w * logit(xClamped);
    }

    const fpPenalty = -GAMMA * features.fp;
    const L_damped = L + fpPenalty;
    const P = sigmoid(L_damped);
    const score = 5 + 90 * P;
    const clamped = Math.max(5.01, Math.min(94.99, score));

    const patterns = inferPatterns(
      graph,
      accountId,
      clamped,
      cycleInfo,
      ringMembersByAccount,
      layeredAccounts
    );

    out.set(accountId, { score: Math.round(clamped * 10) / 10, patterns });
  }

  return out;
}

function inferPatterns(
  graph: GraphData,
  accountId: string,
  score: number,
  cycleInfo: CycleInfo,
  ringMembersByAccount: Map<string, string>,
  layeredAccounts?: Set<string>
): DetectionPattern[] {
  const patterns: DetectionPattern[] = [];
  const cycles = cycleInfo.accountCycles.get(accountId) ?? [];

  for (const { length } of cycles) {
    if (length === 3) patterns.push("cycle_length_3");
    else if (length === 4) patterns.push("cycle_length_4");
    else if (length === 5) patterns.push("cycle_length_5");
  }

  if (cycleInfo.cycleNodes.has(accountId) && patterns.length > 0) {
    // Already have cycle
  }

  const inDeg = graph.inDegree.get(accountId) ?? 0;
  const outDeg = graph.outDegree.get(accountId) ?? 0;
  const timestamps = graph.timestamps.get(accountId) ?? [];

  if (timestamps.length >= 2) {
    const WINDOW_MS = 72 * 60 * 60 * 1000;
    let maxInWindow = 0;
    let start = 0;
    const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());

    for (let end = 0; end < sorted.length; end += 1) {
      const endT = sorted[end]!.getTime();
      const startT = endT - WINDOW_MS;
      while (start <= end && sorted[start]!.getTime() < startT) start += 1;
      const count = end - start + 1;
      if (count > maxInWindow) maxInWindow = count;
    }
    if (maxInWindow > 8) patterns.push("high_velocity");
  }

  if (inDeg >= 10 || outDeg >= 10) {
    if (inDeg >= outDeg) patterns.push("smurfing_in");
    if (outDeg >= inDeg) patterns.push("smurfing_out");
  }

  if (layeredAccounts?.has(accountId)) patterns.push("layered_shell");

  return [...new Set(patterns)].sort();
}
