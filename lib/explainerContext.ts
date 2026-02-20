import type { AnalysisResult, NodeExplainerContext } from "@/types";
import type { AccountScoreContext } from "./scoring";

/**
 * Builds per-node explainer context for the LLM.
 * Uses only pipeline data and documented thresholds; no inference.
 */
export function buildNodeExplainerContexts(
  accountContexts: Map<string, AccountScoreContext>,
  analysis: AnalysisResult,
): Record<string, NodeExplainerContext> {
  const out: Record<string, NodeExplainerContext> = {};

  for (const [accountId, ctx] of accountContexts) {
    const suspicious = analysis.suspicious_accounts.find(
      (a) => a.account_id === accountId,
    );
    const flagged = !!suspicious;
    const suspicionScore = suspicious?.suspicion_score ?? 0;
    const detectedPatterns = suspicious?.detected_patterns ?? [];
    const ringId = suspicious?.ring_id ?? ctx.ringId ?? "";

    const observations: string[] = [];
    if (ctx.cycleLength === 3) observations.push("Account is in a 3-cycle fraud ring.");
    if (ctx.cycleLength === 4) observations.push("Account is in a 4-cycle fraud ring.");
    if (ctx.cycleLength === 5) observations.push("Account is in a 5-cycle fraud ring.");
    if (ctx.smurfingInCount >= 10) observations.push(`Smurfing-in: ${ctx.smurfingInCount} unique senders in a 72h window (threshold ≥10).`);
    if (ctx.smurfingOutCount >= 10) observations.push(`Smurfing-out: ${ctx.smurfingOutCount} unique receivers in a 72h window (threshold ≥10).`);
    if (ctx.hasLayeredShell) observations.push("Account is part of a layered shell structure.");
    if (ctx.highVelocity) observations.push("High velocity: more than 8 transactions in a 72h window.");
    if (ctx.inDegree > 50 && ctx.outDegree <= 5) observations.push("Degree-based mitigation applied: high in-degree and low out-degree.");
    if (ctx.firstTimestamp && ctx.lastTimestamp) {
      const spanMs = ctx.lastTimestamp.getTime() - ctx.firstTimestamp.getTime();
      const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
      if (spanMs > sixMonthsMs) observations.push("Long timespan mitigation applied: activity span > 6 months.");
    }
    if (detectedPatterns.length >= 2) observations.push("Multiple patterns detected; bonus applied.");
    if (!flagged && ctx.ringId) observations.push("Account is in a ring but score was clamped to 0 or below threshold.");
    if (!flagged && !ctx.ringId) observations.push("Account is not in any detected fraud ring.");

    const reason = flagged
      ? `Score ${suspicionScore} (threshold > 0); patterns: ${detectedPatterns.join(", ") || "none"}.`
      : "Score ≤ 0 or not in a ring; not flagged.";

    out[accountId] = {
      nodeId: accountId,
      metrics: {
        inDegree: ctx.inDegree,
        outDegree: ctx.outDegree,
        totalTransactions: ctx.totalTransactions,
        cycleLength: ctx.cycleLength,
        smurfingInCount: ctx.smurfingInCount,
        smurfingOutCount: ctx.smurfingOutCount,
        hasLayeredShell: ctx.hasLayeredShell,
        highVelocity: ctx.highVelocity,
        detectedPatterns: Array.from(ctx.detectedPatterns.values()).sort(),
        suspicionScore,
        ringId,
      },
      thresholds: {
        smurfingInOut: {
          minToFlag: 10,
          tiers: "≥10: +25; ≥20: +35; ≥30: +45 (max of in/out used).",
        },
        highVelocity: { maxTxIn72h: 8 },
        layeredShell: { contributes: 40 },
        cycleScores: "cycle_length_3: +45; cycle_length_4: +40; cycle_length_5: +35.",
        multiPatternBonus: "2+ patterns: +20.",
        degreeMitigation: "inDegree > 50 and outDegree ≤ 5: −40.",
        longSpanMitigation: "Activity span > 6 months: −20.",
      },
      decision: { flagged, reason },
      observations,
    };
  }

  return out;
}
