/**
 * Bayesian scoring — Stage 1: Feature extraction (F1–F7).
 * All features are continuous raw values with no hard gates.
 */

import type { GraphData, FraudRing, Transaction } from "@/types";

const WINDOW_72H_SEC = 72 * 3600;
const EPS = 1e-9;

export type CycleInfo = {
  cycleNodes: Set<string>;
  accountCycles: Map<string, { length: number; direct: number }[]>;
};

export function getCycleInfo(fraudRings: FraudRing[]): CycleInfo {
  const cycleNodes = new Set<string>();
  const accountCycles = new Map<string, { length: number; direct: number }[]>();

  for (const ring of fraudRings) {
    if (ring.pattern_type !== "cycle") continue;
    const L = ring.member_accounts.length;
    if (L < 3 || L > 5) continue;
    const direct = (6 - L) / 3;
    for (const acc of ring.member_accounts) {
      cycleNodes.add(acc);
      const list = accountCycles.get(acc) ?? [];
      list.push({ length: L, direct });
      accountCycles.set(acc, list);
    }
  }
  return { cycleNodes, accountCycles };
}

/** BFS to compute min hops from account to any cycle node */
function minHopsToCycle(
  graph: GraphData,
  accountId: string,
  cycleNodes: Set<string>
): number {
  if (cycleNodes.has(accountId)) return 0;

  const visited = new Set<string>();
  const queue: { id: string; hops: number }[] = [{ id: accountId, hops: 0 }];
  visited.add(accountId);

  const neighbors = (id: string) => {
    const out = graph.adjacencyOut.get(id);
    const inn = graph.adjacencyIn.get(id);
    const s = new Set<string>();
    if (out) for (const v of out) s.add(v);
    if (inn) for (const v of inn) s.add(v);
    return s;
  };

  while (queue.length > 0) {
    const { id, hops } = queue.shift()!;
    for (const v of neighbors(id)) {
      if (cycleNodes.has(v)) return hops + 1;
      if (!visited.has(v)) {
        visited.add(v);
        queue.push({ id: v, hops: hops + 1 });
      }
    }
  }
  return 999;
}

/** F1 — Cycle participation depth */
export function f1Cycle(
  graph: GraphData,
  accountId: string,
  cycleInfo: CycleInfo
): number {
  const cycles = cycleInfo.accountCycles.get(accountId) ?? [];
  let c = 0;
  for (const { direct } of cycles) {
    c += direct;
  }
  const hops = minHopsToCycle(graph, accountId, cycleInfo.cycleNodes);
  c += 0.25 / (1 + hops);
  return Math.max(c, EPS);
}

/** F2 — Structural fan anomaly */
export function f2Fan(
  inDeg: number,
  outDeg: number
): number {
  const k = inDeg + outDeg;
  if (k === 0) return 0;
  const imbalance = Math.abs(inDeg - outDeg) / (k + 1);
  const fanIntensity = Math.max(inDeg, outDeg) / Math.sqrt(k + 1);
  return fanIntensity * (1 + 0.3 * imbalance);
}

/** F3 — Temporal burst score */
export function f3Burst(
  timestamps: Date[],
  allSpans: number[]
): number {
  if (timestamps.length === 0) return 0;

  const T = timestamps.map((d) => d.getTime() / 1000).sort((a, b) => a - b);
  const totalTxns = T.length;
  const W = WINDOW_72H_SEC;

  let peakWindow = 0;
  let start = 0;
  for (let end = 0; end < T.length; end += 1) {
    const windowEnd = T[end]!;
    const windowStart = windowEnd - W;
    while (start <= end && T[start]! < windowStart) start += 1;
    const count = end - start + 1;
    if (count > peakWindow) peakWindow = count;
  }

  const burstRatio = peakWindow / totalTxns;
  const activeSpan = Math.max(1, (T[T.length - 1]! - T[0]!) / 1000);
  const expectedSpan = allSpans.length > 0
    ? allSpans.reduce((a, b) => a + b, 0) / allSpans.length
    : activeSpan;
  const compression = Math.min(expectedSpan / (activeSpan + 1), 3);

  return burstRatio * (1 + 0.4 * compression);
}

/** F4 — Shell thinness */
export function f4Shell(
  inDeg: number,
  outDeg: number,
  totalTxns: number
): number {
  const k = inDeg + outDeg;
  if (k === 0) return 0;
  const balance = (2 * Math.min(inDeg, outDeg)) / (k + EPS);
  const thinness = 1 / (1 + Math.log(1 + totalTxns));
  return balance * thinness;
}

/** Build dataset-wide amount decile bins (20 bins) */
function buildAmountBins(transactions: Transaction[]): { lo: number; hi: number }[] {
  const amounts = transactions.map((t) => t.amount).filter((a) => a > 0);
  if (amounts.length === 0) return [];

  const sorted = [...amounts].sort((a, b) => a - b);
  const n = Math.min(20, sorted.length);
  const bins: { lo: number; hi: number }[] = [];

  for (let i = 0; i < n; i += 1) {
    const idxLo = Math.floor((i * sorted.length) / n);
    const idxHi = Math.floor(((i + 1) * sorted.length) / n) - 1;
    bins.push({
      lo: sorted[idxLo] ?? 0,
      hi: sorted[Math.min(idxHi, sorted.length - 1)] ?? 0,
    });
  }
  return bins;
}

/** F5 — Amount structuring score */
export function f5Amount(
  accountAmounts: number[],
  bins: { lo: number; hi: number }[],
  maxEntropy: number
): number {
  if (accountAmounts.length === 0 || bins.length === 0 || maxEntropy <= 0)
    return 0;

  const hist = new Array(bins.length).fill(0);
  for (const a of accountAmounts) {
    for (let i = 0; i < bins.length; i += 1) {
      const { lo, hi } = bins[i]!;
      if (a >= lo && a <= hi) {
        hist[i] += 1;
        break;
      }
    }
  }

  const total = hist.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;

  let entropy = 0;
  for (const p of hist) {
    if (p <= 0) continue;
    const prob = p / total;
    entropy -= prob * Math.log(prob + EPS);
  }

  return 1 - entropy / maxEntropy;
}

/** F6 — Velocity spike */
export function f6Velocity(
  timestamps: Date[],
  totalTxns: number
): number {
  if (timestamps.length < 2) return 0;

  const byHour = new Map<number, number>();
  for (const d of timestamps) {
    const h = Math.floor(d.getTime() / (60 * 60 * 1000));
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }

  const counts = [...byHour.values()];
  if (counts.length === 0) return 0;

  counts.sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  const max = Math.max(...counts);

  const spikeRatio = max / (median + 0.5);
  return Math.log(1 + spikeRatio);
}

/** Approximate betweenness (Brandes) — sampled for large graphs */
function betweennessCentrality(
  graph: GraphData,
  sampleSize: number = 100
): Map<string, number> {
  const nodes = [...new Set([...graph.adjacencyOut.keys(), ...graph.adjacencyIn.keys()])];
  const betweenness = new Map<string, number>();
  for (const n of nodes) betweenness.set(n, 0);

  const neighbors = (id: string) => {
    const s = new Set<string>();
    const out = graph.adjacencyOut.get(id);
    const inn = graph.adjacencyIn.get(id);
    if (out) for (const v of out) s.add(v);
    if (inn) for (const v of inn) s.add(v);
    return s;
  };

  const sources = nodes.length <= sampleSize
    ? nodes
    : [...nodes].sort(() => Math.random() - 0.5).slice(0, sampleSize);

  for (const s of sources) {
    const S: string[] = [];
    const P = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const d = new Map<string, number>();

    for (const n of nodes) {
      P.set(n, []);
      sigma.set(n, 0);
      d.set(n, -1);
    }
    sigma.set(s, 1);
    d.set(s, 0);

    const Q: string[] = [s];
    while (Q.length > 0) {
      const v = Q.shift()!;
      S.push(v);
      for (const w of neighbors(v)) {
        if (d.get(w)! === -1) {
          Q.push(w);
          d.set(w, d.get(v)! + 1);
        }
        if (d.get(w) === d.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          P.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const n of nodes) delta.set(n, 0);

    while (S.length > 0) {
      const w = S.pop()!;
      for (const v of P.get(w)!) {
        const c = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + c);
      }
      if (w !== s) {
        betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
      }
    }
  }

  const scale = sources.length < nodes.length ? nodes.length / sources.length : 1;
  for (const n of nodes) {
    betweenness.set(n, (betweenness.get(n) ?? 0) * scale);
  }
  return betweenness;
}

/** F7 — Network centrality anomaly */
export function f7Centrality(
  accountId: string,
  betweenness: Map<string, number>,
  degree: Map<string, number>
): number {
  const b = betweenness.get(accountId) ?? 0;
  const deg = degree.get(accountId) ?? 0;
  const totalDeg = [...degree.values()].reduce((s, d) => s + d, 0);
  if (totalDeg <= 0) return 0;
  const expectedB = deg / totalDeg;
  return b / (expectedB + EPS);
}

/** FP dampener: regularity and volume rank */
export function fpDampener(
  amounts: number[],
  timestamps: Date[],
  totalTxns: number,
  allTxCounts: number[]
): number {
  if (amounts.length < 2 || timestamps.length < 2) return 0;

  const meanAmt = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const stdAmt = Math.sqrt(
    amounts.reduce((s, a) => s + (a - meanAmt) ** 2, 0) / amounts.length
  );
  const CoV_amt = meanAmt > 0 ? stdAmt / meanAmt : 0;

  const gaps: number[] = [];
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(
      (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / 1000
    );
  }
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length || 1;
  const stdGap = Math.sqrt(
    gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length
  );
  const CoV_gap = meanGap > 0 ? stdGap / meanGap : 0;

  const regularity = Math.exp(-CoV_amt) * Math.exp(-CoV_gap);

  const sortedCounts = [...allTxCounts].sort((a, b) => a - b);
  const rank = sortedCounts.findIndex((c) => c >= totalTxns);
  const volRank = rank >= 0 ? rank / Math.max(1, sortedCounts.length) : 1;

  return regularity * volRank;
}

export function computeAllFeatures(
  graph: GraphData,
  transactions: Transaction[],
  cycleInfo: CycleInfo
): {
  accountFeatures: Map<
    string,
    { c: number; g: number; t: number; sh: number; e: number; v: number; n: number; fp: number }
  >;
  datasetStats: { mean: number[]; std: number[]; bins: { lo: number; hi: number }[] };
} {
  const amountsByAccount = new Map<string, number[]>();
  const timestampsByAccount = new Map<string, Date[]>();

  for (const tx of transactions) {
    for (const id of [tx.senderId, tx.receiverId]) {
      if (!amountsByAccount.has(id)) {
        amountsByAccount.set(id, []);
        timestampsByAccount.set(id, []);
      }
      amountsByAccount.get(id)!.push(tx.amount);
      timestampsByAccount.get(id)!.push(tx.timestamp);
    }
  }

  const allSpans: number[] = [];
  for (const [, ts] of timestampsByAccount) {
    if (ts.length >= 2) {
      const sorted = [...ts].sort((a, b) => a.getTime() - b.getTime());
      allSpans.push(
        (sorted[sorted.length - 1]!.getTime() - sorted[0]!.getTime()) / 1000
      );
    }
  }

  const bins = buildAmountBins(transactions);
  const maxEntropy = bins.length > 0 ? Math.log(bins.length) : 1;

  const betweenness = betweennessCentrality(graph);
  const degree = new Map<string, number>();
  const allAccounts = new Set<string>();
  for (const k of graph.adjacencyOut.keys()) allAccounts.add(k);
  for (const k of graph.adjacencyIn.keys()) allAccounts.add(k);
  for (const a of allAccounts) {
    degree.set(
      a,
      (graph.inDegree.get(a) ?? 0) + (graph.outDegree.get(a) ?? 0)
    );
  }

  const allTxCounts = [...allAccounts].map(
    (a) => graph.transactionCounts.get(a) ?? 0
  );

  const accountFeatures = new Map<
    string,
    { c: number; g: number; t: number; sh: number; e: number; v: number; n: number; fp: number }
  >();

  const rawFeatures: Record<string, number[]> = {
    c: [],
    g: [],
    t: [],
    sh: [],
    e: [],
    v: [],
    n: [],
  };

  for (const acc of allAccounts) {
    const inDeg = graph.inDegree.get(acc) ?? 0;
    const outDeg = graph.outDegree.get(acc) ?? 0;
    const totalTxns = graph.transactionCounts.get(acc) ?? 0;
    const timestamps = graph.timestamps.get(acc) ?? [];
    const amounts = amountsByAccount.get(acc) ?? [];

  const c = f1Cycle(graph, acc, cycleInfo);
    const g = f2Fan(inDeg, outDeg);
    const t = f3Burst(timestamps, allSpans);
    const sh = f4Shell(inDeg, outDeg, totalTxns);
    const e = f5Amount(amounts, bins, maxEntropy);
    const v = f6Velocity(timestamps, totalTxns);
    const n = f7Centrality(acc, betweenness, degree);
    const fp = fpDampener(
      amounts,
      timestamps,
      totalTxns,
      allTxCounts
    );

    accountFeatures.set(acc, { c, g, t, sh, e, v, n, fp });

    rawFeatures.c.push(c);
    rawFeatures.g.push(g);
    rawFeatures.t.push(t);
    rawFeatures.sh.push(sh);
    rawFeatures.e.push(e);
    rawFeatures.v.push(v);
    rawFeatures.n.push(n);
  }

  const featureKeys = ["c", "g", "t", "sh", "e", "v", "n"] as const;
  const mean: number[] = [];
  const std: number[] = [];

  for (const k of featureKeys) {
    const vals = rawFeatures[k];
    const m = vals.reduce((a, b) => a + b, 0) / vals.length || 0;
    const s =
      Math.sqrt(
        vals.reduce((sum, v) => sum + (v - m) ** 2, 0) / vals.length
      ) || EPS;
    mean.push(m);
    std.push(s);
  }

  return {
    accountFeatures,
    datasetStats: { mean, std, bins },
  };
}
