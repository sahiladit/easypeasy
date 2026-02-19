import type { GraphData } from "@/types";

const MAX_DEPTH = 3;

export function detectLayeredShellAccounts(
  graph: GraphData,
): Set<string> {
  const layeredAccounts = new Set<string>();
  const { adjacencyOut, transactionCounts } = graph;

  const isShell = (accountId: string) =>
    (transactionCounts.get(accountId) ?? 0) <= 3;

  for (const start of adjacencyOut.keys()) {
    const queue: { path: string[] }[] = [];
    queue.push({ path: [start] });

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const { path } = current;
      const last = path[path.length - 1]!;
      const depth = path.length - 1;

      if (depth >= MAX_DEPTH) {
        const intermediates = path.slice(1, -1);
        if (intermediates.length >= 2 && intermediates.every(isShell)) {
          for (const node of path) {
            layeredAccounts.add(node);
          }
        }
        // Do not expand further at this depth.
        continue;
      }

      const neighbors = adjacencyOut.get(last);
      if (!neighbors) continue;

      for (const next of neighbors) {
        if (path.includes(next)) continue;
        const nextPath = [...path, next];
        queue.push({ path: nextPath });
      }
    }
  }

  return layeredAccounts;
}

