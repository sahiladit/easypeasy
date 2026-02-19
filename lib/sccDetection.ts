import type { GraphData, FraudRing } from "@/types";

type SccResult = {
  components: string[][];
};

export function tarjanScc(graph: GraphData): SccResult {
  const { adjacencyOut } = graph;
  const indexMap = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let index = 0;

  const strongConnect = (v: string) => {
    indexMap.set(v, index);
    lowLink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    const neighbors = adjacencyOut.get(v);
    if (neighbors) {
      for (const w of neighbors) {
        if (!indexMap.has(w)) {
          strongConnect(w);
          lowLink.set(
            v,
            Math.min(lowLink.get(v) ?? 0, lowLink.get(w) ?? 0),
          );
        } else if (onStack.has(w)) {
          lowLink.set(
            v,
            Math.min(lowLink.get(v) ?? 0, indexMap.get(w) ?? 0),
          );
        }
      }
    }

    if ((lowLink.get(v) ?? 0) === (indexMap.get(v) ?? 0)) {
      const component: string[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  };

  for (const node of adjacencyOut.keys()) {
    if (!indexMap.has(node)) {
      strongConnect(node);
    }
  }

  return { components };
}

export function extractFraudRingsFromScc(
  sccResult: SccResult,
): { rings: FraudRing[]; ringMembersByAccount: Map<string, string> } {
  const candidates = sccResult.components
    .map((comp) => Array.from(new Set(comp)))
    .filter((comp) => comp.length >= 3 && comp.length <= 5);

  candidates.sort((a, b) => {
    const aMin = a.slice().sort()[0] ?? "";
    const bMin = b.slice().sort()[0] ?? "";
    return aMin.localeCompare(bMin);
  });

  const rings: FraudRing[] = [];
  const ringMembersByAccount = new Map<string, string>();

  candidates.forEach((members, idx) => {
    const memberAccounts = members.slice().sort();
    const ringId = `RING_${String(idx + 1).padStart(3, "0")}`;
    const cycleLength = members.length;
    const base =
      cycleLength === 3 ? 95.0 : cycleLength === 4 ? 90.0 : 85.0;

    const ring: FraudRing = {
      ring_id: ringId,
      member_accounts: memberAccounts,
      pattern_type: "cycle",
      risk_score: base,
    };
    rings.push(ring);
    for (const acc of memberAccounts) {
      if (!ringMembersByAccount.has(acc)) {
        ringMembersByAccount.set(acc, ringId);
      }
    }
  });

  return { rings, ringMembersByAccount };
}

