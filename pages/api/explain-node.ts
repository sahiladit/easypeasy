import type { NextApiRequest, NextApiResponse } from "next";

type MetricsPayload = {
  node_id: string;
  display_id: string;
  suspicion_score: number;
  flagged: boolean;
  detected_patterns: string[];
  ring_id: string | null;
  in_degree: number;
  out_degree: number;
  total_transactions: number;
  time_series: {
    points_count: number;
    max_weighted_rate_tx_per_hour: number;
    avg_weighted_rate_tx_per_hour: number;
    recency_weighting: string;
  };
  thresholds: Record<string, number | number[]>;
  decision: "flagged" | "not_flagged";
};

/**
 * Builds a factual, data-grounded explanation from the provided metrics.
 * Uses ONLY the provided data — no inference or hallucination.
 * Can be extended to call an LLM (e.g. OpenAI) when API key is configured.
 */
function buildExplanationFromMetrics(
  metrics: MetricsPayload,
  instructions: string
): string {
  const {
    display_id,
    suspicion_score,
    flagged,
    detected_patterns,
    ring_id,
    in_degree,
    out_degree,
    total_transactions,
    time_series,
    thresholds,
    decision,
  } = metrics;

  const lines: string[] = [];

  lines.push(`## Key Metrics for ${display_id}`);
  lines.push("");
  lines.push(`- Suspicion score: ${suspicion_score.toFixed(1)} (range 0–100)`);
  lines.push(`- Decision: ${decision}`);
  lines.push(`- In-degree: ${in_degree} (incoming connections)`);
  lines.push(`- Out-degree: ${out_degree} (outgoing connections)`);
  lines.push(`- Total transactions: ${total_transactions}`);
  if (ring_id) {
    lines.push(`- Fraud ring: ${ring_id}`);
  }
  lines.push("");

  lines.push("## Time-Series Summary");
  lines.push("");
  lines.push(
    `- Transaction timeline points: ${time_series.points_count}`
  );
  lines.push(
    `- Max weighted rate: ${time_series.max_weighted_rate_tx_per_hour.toFixed(
      3
    )} tx/hour`
  );
  lines.push(
    `- Avg weighted rate: ${time_series.avg_weighted_rate_tx_per_hour.toFixed(
      3
    )} tx/hour`
  );
  lines.push(
    `- Recency weighting: ${time_series.recency_weighting}`
  );
  lines.push("");

  lines.push("## Observed Patterns");
  lines.push("");
  if (detected_patterns.length > 0) {
    lines.push(
      `Detected patterns: ${detected_patterns.join(", ")}`
    );
    lines.push("");
    if (detected_patterns.includes("cycle_length_3"))
      lines.push("- Cycle of length 3 contributes up to 45 points.");
    if (detected_patterns.includes("cycle_length_4"))
      lines.push("- Cycle of length 4 contributes up to 40 points.");
    if (detected_patterns.includes("cycle_length_5"))
      lines.push("- Cycle of length 5 contributes up to 35 points.");
    if (detected_patterns.includes("smurfing_in"))
      lines.push("- Smurfing inbound (≥10 unique in 72h) adds 25–45 points.");
    if (detected_patterns.includes("smurfing_out"))
      lines.push("- Smurfing outbound (≥10 unique in 72h) adds 25–45 points.");
    if (detected_patterns.includes("layered_shell"))
      lines.push("- Layered shell structure adds 40 points.");
    if (detected_patterns.includes("high_velocity"))
      lines.push("- High velocity (>8 tx in 72h window) adds 15 points.");
    if (detected_patterns.length >= 2)
      lines.push("- Multiple patterns add a 20-point bonus.");
  } else {
    lines.push("No fraud-ring patterns detected for this account.");
  }
  lines.push("");

  lines.push("## Why This Node Was " + (flagged ? "Flagged" : "Not Flagged"));
  lines.push("");
  if (flagged) {
    lines.push(
      `The account received a suspicion score of ${suspicion_score.toFixed(
        1
      )}, above the effective threshold for flagging. `
    );
    lines.push(
      "Contributing factors include the patterns and metrics listed above. "
    );
    if (suspicion_score >= 80) {
      lines.push("The score falls in the severe range (80–100).");
    } else if (suspicion_score >= 60) {
      lines.push("The score falls in the high range (60–80).");
    } else if (suspicion_score >= 40) {
      lines.push("The score falls in the moderate range (40–60).");
    } else {
      lines.push("The score falls in the low range (20–40).");
    }
  } else {
    lines.push(
      "The account was not flagged. The suspicion score is 0 or the account is not part of any detected fraud ring."
    );
  }

  return lines.join("\n");
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ explanation?: string; error?: string }>
): void {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const { metrics, instructions } = (req.body ?? {}) as {
      metrics?: MetricsPayload;
      instructions?: string;
    };

    if (!metrics || typeof metrics !== "object") {
      res.status(400).json({ error: "Missing metrics in request body." });
      return;
    }

    const explanation = buildExplanationFromMetrics(
      metrics,
      instructions ?? ""
    );

    res.status(200).json({ explanation });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to generate explanation.";
    res.status(500).json({ error: message });
  }
}
