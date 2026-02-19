import type { GraphData } from "@/types";

/**
 * Detects layered shell account chains of the form a → b → c → d
 * where b and c are "shell" accounts (≤ 3 transactions) and all
 * four nodes are distinct.
 *
 * Optimised from O(V·D³) BFS-from-every-node to O(E + E_shell·D)
 * by pivoting on shell→shell edges and looking one hop each way.
 */
export function detectLayeredShellAccounts(
  graph: GraphData,
): Set<string> {
  const layeredAccounts = new Set<string>();
  const { adjacencyOut, transactionCounts } = graph;

  const isShell = (id: string) => (transactionCounts.get(id) ?? 0) <= 3;

  // ── 1. Build reverse adjacency map (O(E)) ──
  const adjacencyIn = new Map<string, string[]>();
  for (const [src, neighbors] of adjacencyOut) {
    for (const dst of neighbors) {
      let arr = adjacencyIn.get(dst);
      if (!arr) {
        arr = [];
        adjacencyIn.set(dst, arr);
      }
      arr.push(src);
    }
  }

  // ── 2. For every shell→shell edge b → c, find 4-node paths ──
  for (const [b, bNeighbors] of adjacencyOut) {
    if (!isShell(b)) continue;

    for (const c of bNeighbors) {
      if (c === b || !isShell(c)) continue;

      // a → b  (predecessors of b, excluding b and c)
      const preds = adjacencyIn.get(b);
      if (!preds) continue;

      // c → d  (successors of c, excluding b and c)
      const succs = adjacencyOut.get(c);
      if (!succs) continue;

      const validA: string[] = [];
      for (const a of preds) {
        if (a !== b && a !== c) validA.push(a);
      }
      if (validA.length === 0) continue;

      const validD: string[] = [];
      for (const d of succs) {
        if (d !== b && d !== c) validD.push(d);
      }
      if (validD.length === 0) continue;

      // Check a ≠ d constraint using set-size logic (avoids O(|A|·|D|) loop)
      const dSet = new Set(validD);
      const aSet = new Set(validA);

      const flaggedA: string[] = [];
      for (const a of validA) {
        // a participates if ∃ at least one d ≠ a
        if (dSet.size > 1 || !dSet.has(a)) {
          flaggedA.push(a);
        }
      }

      const flaggedD: string[] = [];
      for (const d of validD) {
        // d participates if ∃ at least one a ≠ d
        if (aSet.size > 1 || !aSet.has(d)) {
          flaggedD.push(d);
        }
      }

      if (flaggedA.length > 0 && flaggedD.length > 0) {
        layeredAccounts.add(b);
        layeredAccounts.add(c);
        for (const a of flaggedA) layeredAccounts.add(a);
        for (const d of flaggedD) layeredAccounts.add(d);
      }
    }
  }

  return layeredAccounts;
}

