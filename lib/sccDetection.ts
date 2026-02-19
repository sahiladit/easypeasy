import type { GraphData, FraudRing } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface DetectionParams {
  minLen: number;
  maxLen: number;
  degreeCap: number;
  epsUp: number;
  epsDown: number;
  cumMin: number;
  cumMax: number;
  maxCycleHours: number;
}

export const DEFAULT_PARAMS: DetectionParams = {
  minLen: 3,
  maxLen: 5,
  degreeCap: 100,
  epsUp: 0.05,
  epsDown: 0.18,
  cumMin: 0.65,
  cumMax: 1.05,
  maxCycleHours: 48.0,
};

// Same edge shape our GraphData edges carry (source, target, amount, timestamp)
interface TxEdge {
  source: string;
  target: string;
  amount: number;
  timestamp: number; // Unix epoch seconds
}

interface DetectedCycle {
  edges: TxEdge[];
  length: number;
  cumulativeDecay: number;
  totalHours: number;
  canonicalKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH WRAPPER
// Wraps GraphData.adjacencyOut and GraphData.edges — zero re-parsing of topology
// ─────────────────────────────────────────────────────────────────────────────

// Shared empty sentinel — avoids allocating new Set() on every neighbors() miss
const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_ARR: readonly TxEdge[] = [];

// Binary search: find index of first element with timestamp > target
function lowerBoundAfter(arr: TxEdge[], afterTs: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]!.timestamp <= afterTs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

class MuleGraph {
  adjacencyOut: Map<string, Set<string>>;
  edgeMap: Map<string, TxEdge[]>; // "source|target" → sorted TxEdge[]
  outDeg: Map<string, number> = new Map();
  inDeg: Map<string, number> = new Map();
  degree: Map<string, number> = new Map();
  allNodes: Set<string>;
  private cache: Map<string, TxEdge | null> = new Map();
  private closingCache: Map<string, boolean> = new Map();

  constructor(graph: GraphData) {
    this.adjacencyOut = graph.adjacencyOut;
    this.allNodes = new Set(graph.adjacencyOut.keys());
    this.edgeMap = new Map();

    // Build enriched edge map from graph.edges (with Date timestamps)
    for (const e of graph.edges) {
      const key = `${e.source}|${e.target}`;
      if (!this.edgeMap.has(key)) this.edgeMap.set(key, []);
      this.edgeMap.get(key)!.push({
        source: e.source,
        target: e.target,
        amount: e.amount,
        timestamp: e.timestamp.getTime() / 1000,
      });
      this.allNodes.add(e.source);
      this.allNodes.add(e.target);
    }

    // Sort parallel edges by timestamp ascending
    for (const txList of this.edgeMap.values()) {
      txList.sort((a, b) => a.timestamp - b.timestamp);
    }

    // Degree from adjacencyOut
    for (const [u, neighbors] of this.adjacencyOut) {
      this.outDeg.set(u, neighbors.size);
      for (const v of neighbors) {
        this.inDeg.set(v, (this.inDeg.get(v) ?? 0) + 1);
        this.allNodes.add(v);
      }
    }

    for (const node of this.allNodes) {
      this.degree.set(
        node,
        (this.outDeg.get(node) ?? 0) + (this.inDeg.get(node) ?? 0),
      );
    }
  }

  neighbors(node: string): ReadonlySet<string> {
    return this.adjacencyOut.get(node) ?? EMPTY_SET;
  }

  edges(source: string, target: string): readonly TxEdge[] {
    return this.edgeMap.get(`${source}|${target}`) ?? EMPTY_ARR;
  }

  isEligible(node: string, p: DetectionParams): boolean {
    return (
      (this.degree.get(node) ?? 0) <= p.degreeCap &&
      (this.outDeg.get(node) ?? 0) > 0 &&
      (this.inDeg.get(node) ?? 0) > 0
    );
  }

  eligibleNodes(p: DetectionParams): string[] {
    return [...this.allNodes].filter((n) => this.isEligible(n, p));
  }

  // Feasibility-optimized parallel edge selection (Code 2, Section 5)
  bestEdge(
    source: string,
    target: string,
    afterTs: number,
    lastAmount: number,
    firstAmount: number,
    p: DetectionParams,
  ): TxEdge | null {
    const key = `${source}|${target}|${afterTs}|${lastAmount}|${firstAmount}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const amountLo = lastAmount * (1 - p.epsDown);
    const amountHi = lastAmount * (1 + p.epsUp);
    const centre = (firstAmount * (p.cumMin + p.cumMax)) / 2;

    const txList = this.edges(source, target);
    // Binary search: skip all edges with timestamp <= afterTs
    const startIdx = lowerBoundAfter(txList as TxEdge[], afterTs);

    let best: TxEdge | null = null;
    let bestDist = Infinity;

    for (let i = startIdx; i < txList.length; i++) {
      const tx = txList[i]!;
      if (tx.amount < amountLo || tx.amount > amountHi) continue;
      const ratio = tx.amount / firstAmount;
      if (ratio < p.cumMin || ratio > p.cumMax) continue;
      const dist = Math.abs(tx.amount - centre);
      if (dist < bestDist) {
        bestDist = dist;
        best = tx;
      }
    }

    this.cache.set(key, best);
    return best;
  }

  // Used for lookahead pruning at penultimate DFS depth
  // Returns true if at least one viable closing edge exists (cached)
  hasClosingEdge(
    source: string,
    target: string,
    afterTs: number,
    lastAmount: number,
    p: DetectionParams,
  ): boolean {
    const key = `${source}|${target}|${afterTs}|${lastAmount}`;
    const cached = this.closingCache.get(key);
    if (cached !== undefined) return cached;

    const amountLo = lastAmount * (1 - p.epsDown);
    const amountHi = lastAmount * (1 + p.epsUp);
    const txList = this.edges(source, target);
    const startIdx = lowerBoundAfter(txList as TxEdge[], afterTs);

    let found = false;
    for (let i = startIdx; i < txList.length; i++) {
      const tx = txList[i]!;
      if (tx.amount >= amountLo && tx.amount <= amountHi) {
        found = true;
        break;
      }
    }

    this.closingCache.set(key, found);
    return found;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function canonicalize(edges: TxEdge[]): string {
  if (!edges.length) return "[]";

  let anchorIdx = 0;
  for (let i = 1; i < edges.length; i += 1) {
    const a = edges[anchorIdx]!;
    const b = edges[i]!;
    if (
      b.timestamp < a.timestamp ||
      (b.timestamp === a.timestamp &&
        (b.source < a.source ||
          (b.source === a.source && b.target < a.target)))
    ) {
      anchorIdx = i;
    }
  }

  const rotated = [...edges.slice(anchorIdx), ...edges.slice(0, anchorIdx)];
  return JSON.stringify(
    rotated.map((e) => [e.source, e.target, e.timestamp]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — TRIANGLE FAST-PATH (3-cycles)
// ─────────────────────────────────────────────────────────────────────────────

function detectTriangles(
  g: MuleGraph,
  p: DetectionParams,
  eligible: Set<string>,
): Map<string, DetectedCycle> {
  const found = new Map<string, DetectedCycle>();

  for (const U of eligible) {
    for (const V of g.neighbors(U)) {
      if (!eligible.has(V) || V === U) continue;
      for (const txUV of g.edges(U, V)) {
        const fa = txUV.amount;
        const ft = txUV.timestamp;

        for (const W of g.neighbors(V)) {
          if (!eligible.has(W) || W === U || W === V) continue;

          const txVW = g.bestEdge(V, W, ft, fa, fa, p);
          if (!txVW) continue;

          const txWU = g.bestEdge(W, U, txVW.timestamp, txVW.amount, fa, p);
          if (!txWU) continue;

          const decay = txWU.amount / fa;
          const hours = (txWU.timestamp - ft) / 3600;
          if (
            decay < p.cumMin ||
            decay > p.cumMax ||
            hours > p.maxCycleHours
          ) {
            continue;
          }

          const edges = [txUV, txVW, txWU];
          const key = canonicalize(edges);
          if (!found.has(key)) {
            found.set(key, {
              edges,
              length: 3,
              cumulativeDecay: decay,
              totalHours: hours,
              canonicalKey: key,
            });
          }
        }
      }
    }
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 — BOUNDED TEMPORAL DFS (4–5 cycles)
// ─────────────────────────────────────────────────────────────────────────────

type Frame = {
  curr: string;
  root: string;
  pathEdges: TxEdge[];
  visited: Set<string>;
  lastTs: number;
  lastAmt: number;
  firstAmt: number;
  firstTsU: number;
};

function detectLongerCycles(
  g: MuleGraph,
  p: DetectionParams,
  eligible: Set<string>,
): Map<string, DetectedCycle> {
  const found = new Map<string, DetectedCycle>();

  for (const U of eligible) {
    const stack: Frame[] = [];

    for (const V of g.neighbors(U)) {
      if (!eligible.has(V) || V === U) continue;
      for (const txUV of g.edges(U, V)) {
        stack.push({
          curr: V,
          root: U,
          pathEdges: [txUV],
          visited: new Set([U, V]),
          lastTs: txUV.timestamp,
          lastAmt: txUV.amount,
          firstAmt: txUV.amount,
          firstTsU: txUV.timestamp,
        });
      }
    }

    while (stack.length) {
      const {
        curr,
        root,
        pathEdges,
        visited,
        lastTs,
        lastAmt,
        firstAmt,
        firstTsU,
      } = stack.pop()!;
      const depth = pathEdges.length;

      // Closure check for lengths 4 and 5
      if (depth >= p.minLen - 1 && depth <= p.maxLen - 1) {
        const closing = g.bestEdge(curr, root, lastTs, lastAmt, firstAmt, p);
        if (closing) {
          const len = depth + 1;
          const decay = closing.amount / firstAmt;
          const hours = (closing.timestamp - firstTsU) / 3600;
          if (
            len >= 4 &&
            decay >= p.cumMin &&
            decay <= p.cumMax &&
            hours <= p.maxCycleHours
          ) {
            const edges = [...pathEdges, closing];
            const key = canonicalize(edges);
            if (!found.has(key)) {
              found.set(key, {
                edges,
                length: len,
                cumulativeDecay: decay,
                totalHours: hours,
                canonicalKey: key,
              });
            }
          }
        }
      }

      if (depth >= p.maxLen - 1) continue;

      const atPenultimate = depth === p.maxLen - 2;

      for (const nxt of g.neighbors(curr)) {
        if (nxt === root || visited.has(nxt) || !eligible.has(nxt)) continue;
        if (
          atPenultimate &&
          !g.hasClosingEdge(nxt, root, lastTs, lastAmt, p)
        ) {
          continue;
        }

        const txNext = g.bestEdge(curr, nxt, lastTs, lastAmt, firstAmt, p);
        if (!txNext) continue;

        stack.push({
          curr: nxt,
          root,
          pathEdges: [...pathEdges, txNext],
          visited: new Set([...visited, nxt]),
          lastTs: txNext.timestamp,
          lastAmt: txNext.amount,
          firstAmt,
          firstTsU,
        });
      }
    }
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSUMPTION SUPPRESSION
//
// Optimised from O(C · 2^n) exponential subset generation to O(C² · n)
// by iterating directly over (B, A) cycle pairs and checking three O(n)
// conditions: node-subset, order-subsequence, timestamp-monotonicity.
// ─────────────────────────────────────────────────────────────────────────────
function suppressSubsumed(
  all: Map<string, DetectedCycle>,
): Map<string, DetectedCycle> {
  const list = [...all.values()];

  // Sort descending by length so larger cycles (B) come first
  list.sort((a, b) => b.length - a.length);

  const suppressed = new Set<string>();

  for (let bi = 0; bi < list.length; bi++) {
    const B = list[bi]!;
    if (B.length <= 3) break; // sorted desc — no more large cycles

    const nodesB = B.edges.map((e) => e.source);
    const setB = new Set(nodesB);
    // Position of each node in B's ordered sequence (for subsequence check)
    const posInB = new Map(nodesB.map((n, i) => [n, i]));
    // Timestamp of each node's outgoing edge in B
    const timesB = new Map(nodesB.map((n, i) => [n, B.edges[i]!.timestamp]));

    for (let ai = bi + 1; ai < list.length; ai++) {
      const A = list[ai]!;
      if (suppressed.has(A.canonicalKey) || A.length >= B.length) continue;

      const seqA = A.edges.map((e) => e.source);

      // 1) Node-subset: every node in A must appear in B — O(|A|)
      let isSubset = true;
      for (const n of seqA) {
        if (!setB.has(n)) { isSubset = false; break; }
      }
      if (!isSubset) continue;

      // 2) Order-subsequence: A's nodes must appear in the same relative
      //    order within B — O(|A|) via position map
      let isSubseq = true;
      let lastPos = -1;
      for (const n of seqA) {
        const pos = posInB.get(n)!;
        if (pos <= lastPos) { isSubseq = false; break; }
        lastPos = pos;
      }
      if (!isSubseq) continue;

      // 3) Timestamp-monotonicity: the timestamps of A's nodes within B
      //    must be non-decreasing — O(|A|)
      let isSorted = true;
      let prevTs = -Infinity;
      for (const n of seqA) {
        const ts = timesB.get(n) ?? 0;
        if (ts < prevTs) { isSorted = false; break; }
        prevTs = ts;
      }
      if (!isSorted) continue;

      suppressed.add(A.canonicalKey);
    }
  }

  return new Map([...all].filter(([k]) => !suppressed.has(k)));
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — identical return shape to previous extractFraudRingsFromScc
// ─────────────────────────────────────────────────────────────────────────────

export function extractFraudRingsFromMule(
  graph: GraphData,
  params: Partial<DetectionParams> = {},
): { rings: FraudRing[]; ringMembersByAccount: Map<string, string> } {
  const p = { ...DEFAULT_PARAMS, ...params };
  const g = new MuleGraph(graph);
  const eligible = new Set(g.eligibleNodes(p));

  const all = new Map([
    ...detectTriangles(g, p, eligible),
    ...detectLongerCycles(g, p, eligible),
  ]);

  const final = suppressSubsumed(all);
  const sorted = [...final.values()].sort(
    (a, b) => a.cumulativeDecay - b.cumulativeDecay,
  );

  const rings: FraudRing[] = [];
  const ringMembersByAccount = new Map<string, string>();

  sorted.forEach((cycle, idx) => {
    const memberAccounts = [...new Set(cycle.edges.map((e) => e.source))].sort();
    const ringId = `RING_${String(idx + 1).padStart(3, "0")}`;

    // Base scores by cycle length, plus decay-based bonus
    const base =
      cycle.length === 3 ? 95.0 : cycle.length === 4 ? 90.0 : 85.0;
    const decayBonus = Number(((1 - cycle.cumulativeDecay) * 20).toFixed(1));
    const riskScore = Math.min(100, base + decayBonus);

    rings.push({
      ring_id: ringId,
      member_accounts: memberAccounts,
      pattern_type: "cycle",
      risk_score: riskScore,
    });
    for (const acc of memberAccounts) {
      if (!ringMembersByAccount.has(acc)) {
        ringMembersByAccount.set(acc, ringId);
      }
    }
  });

  return { rings, ringMembersByAccount };
}

export type { DetectionParams };

