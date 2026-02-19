import type { GraphData, FraudRing } from "@/types";
import type { SmurfingMetrics } from "./smurfingDetection";
import { extractFraudRingsFromMule } from "./sccDetection";

type RingPrototype = {
  pattern_type: "cycle" | "smurfing" | "layered_shell";
  member_accounts: string[];
  risk_score: number;
};

const PATTERN_PRIORITY: Record<RingPrototype["pattern_type"], number> = {
  cycle: 3,
  layered_shell: 2,
  smurfing: 1,
};

function buildSmurfingRings(
  graph: GraphData,
  smurfing: SmurfingMetrics,
): RingPrototype[] {
  const smurfAccounts = new Set<string>([
    ...smurfing.smurfingInCounts.keys(),
    ...smurfing.smurfingOutCounts.keys(),
  ]);
  if (smurfAccounts.size === 0) return [];

  const visited = new Set<string>();
  const rings: RingPrototype[] = [];

  const neighborsOf = (id: string): Set<string> => {
    const neigh = new Set<string>();
    const out = graph.adjacencyOut.get(id);
    const inn = graph.adjacencyIn.get(id);
    if (out) {
      for (const v of out) neigh.add(v);
    }
    if (inn) {
      for (const v of inn) neigh.add(v);
    }
    return neigh;
  };

  const sortedSeeds = [...smurfAccounts].sort();

  for (const start of sortedSeeds) {
    if (visited.has(start)) continue;
    const queue: string[] = [start];
    const component = new Set<string>();
    visited.add(start);

    while (queue.length) {
      const u = queue.shift()!;
      component.add(u);
      for (const v of neighborsOf(u)) {
        if (!smurfAccounts.has(v) || visited.has(v)) continue;
        visited.add(v);
        queue.push(v);
      }
    }

    if (component.size === 0) continue;

    // Risk based on max smurfing intensity in this component
    let maxIn = 0;
    let maxOut = 0;
    for (const acc of component) {
      maxIn = Math.max(maxIn, smurfing.smurfingInCounts.get(acc) ?? 0);
      maxOut = Math.max(maxOut, smurfing.smurfingOutCounts.get(acc) ?? 0);
    }
    const intensity = Math.max(maxIn, maxOut);
    if (intensity <= 0) continue;

    const base = 85;
    const bonus = Math.min(10, intensity / 2);
    const sizeBonus = Math.min(5, (component.size - 1) * 1.5);
    const risk = Math.min(100, base + bonus + sizeBonus);

    rings.push({
      pattern_type: "smurfing",
      member_accounts: [...component].sort(),
      risk_score: Number(risk.toFixed(1)),
    });
  }

  return rings;
}

function buildLayeredRings(
  graph: GraphData,
  layeredAccounts: Set<string>,
): RingPrototype[] {
  if (layeredAccounts.size === 0) return [];

  const visited = new Set<string>();
  const rings: RingPrototype[] = [];

  const neighborsOf = (id: string): Set<string> => {
    const neigh = new Set<string>();
    const out = graph.adjacencyOut.get(id);
    const inn = graph.adjacencyIn.get(id);
    if (out) {
      for (const v of out) if (layeredAccounts.has(v)) neigh.add(v);
    }
    if (inn) {
      for (const v of inn) if (layeredAccounts.has(v)) neigh.add(v);
    }
    return neigh;
  };

  const sortedSeeds = [...layeredAccounts].sort();

  for (const start of sortedSeeds) {
    if (visited.has(start)) continue;
    const queue: string[] = [start];
    const component = new Set<string>();
    visited.add(start);

    while (queue.length) {
      const u = queue.shift()!;
      component.add(u);
      for (const v of neighborsOf(u)) {
        if (visited.has(v)) continue;
        visited.add(v);
        queue.push(v);
      }
    }

    if (component.size < 2) continue;

    const size = component.size;
    const base = 90;
    const sizeBonus = Math.min(8, (size - 2) * 2);
    const risk = Math.min(100, base + sizeBonus);

    rings.push({
      pattern_type: "layered_shell",
      member_accounts: [...component].sort(),
      risk_score: Number(risk.toFixed(1)),
    });
  }

  return rings;
}

export function buildFraudRings(
  graph: GraphData,
  smurfing: SmurfingMetrics,
  layeredAccounts: Set<string>,
): { rings: FraudRing[]; ringMembersByAccount: Map<string, string> } {
  const { rings: cycleRings } = extractFraudRingsFromMule(graph);

  const prototypes: RingPrototype[] = [
    ...cycleRings.map((r) => ({
      pattern_type: "cycle" as const,
      member_accounts: [...r.member_accounts].sort(),
      risk_score: r.risk_score,
    })),
    ...buildSmurfingRings(graph, smurfing),
    ...buildLayeredRings(graph, layeredAccounts),
  ];

  if (prototypes.length === 0) {
    return { rings: [], ringMembersByAccount: new Map() };
  }

  // Deduplicate by (pattern_type, members) keeping highest risk
  const byKey = new Map<string, RingPrototype>();
  for (const r of prototypes) {
    const key = `${r.pattern_type}|${r.member_accounts.join(",")}`;
    const existing = byKey.get(key);
    if (!existing || r.risk_score > existing.risk_score) {
      byKey.set(key, r);
    }
  }

  const deduped = [...byKey.values()];

  // For accounts in multiple rings, assign them to the highest-risk ring
  const accountChoices = new Map<
    string,
    { protoIndex: number; risk: number; patternPriority: number }
  >();

  deduped.forEach((ring, idx) => {
    for (const acc of ring.member_accounts) {
      const current = accountChoices.get(acc);
      const candidate = {
        protoIndex: idx,
        risk: ring.risk_score,
        patternPriority: PATTERN_PRIORITY[ring.pattern_type],
      };
      if (!current) {
        accountChoices.set(acc, candidate);
      } else if (
        candidate.risk > current.risk ||
        (candidate.risk === current.risk &&
          candidate.patternPriority > current.patternPriority)
      ) {
        accountChoices.set(acc, candidate);
      }
    }
  });

  // Build final member sets per prototype based on chosen assignments
  const finalMembers: string[][] = deduped.map(() => []);
  for (const [acc, choice] of accountChoices) {
    finalMembers[choice.protoIndex]!.push(acc);
  }

  const finalProtos: RingPrototype[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const members = finalMembers[i]!.sort();
    if (members.length === 0) continue;
    finalProtos.push({
      pattern_type: deduped[i]!.pattern_type,
      member_accounts: members,
      risk_score: deduped[i]!.risk_score,
    });
  }

  // Deterministic ordering: risk_score desc, then pattern_type, then members
  finalProtos.sort((a, b) => {
    if (b.risk_score !== a.risk_score) {
      return b.risk_score - a.risk_score;
    }
    const pDiff = PATTERN_PRIORITY[b.pattern_type] - PATTERN_PRIORITY[a.pattern_type];
    if (pDiff !== 0) return pDiff;
    const aKey = a.member_accounts.join(",");
    const bKey = b.member_accounts.join(",");
    return aKey.localeCompare(bKey);
  });

  const rings: FraudRing[] = [];
  const ringMembersByAccount = new Map<string, string>();

  finalProtos.forEach((proto, idx) => {
    const ringId = `RING_${String(idx + 1).padStart(3, "0")}`;
    rings.push({
      ring_id: ringId,
      member_accounts: proto.member_accounts,
      pattern_type: proto.pattern_type,
      risk_score: proto.risk_score,
    });
    for (const acc of proto.member_accounts) {
      ringMembersByAccount.set(acc, ringId);
    }
  });

  return { rings, ringMembersByAccount };
}

