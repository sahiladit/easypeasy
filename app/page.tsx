"use client";

import { useMemo, useState } from "react";
import type {
  AnalyzeApiResponse,
  GraphData,
  Transaction,
} from "@/types";
import { UploadForm } from "@/components/UploadForm";
import { GraphView } from "@/components/GraphView";
import { RingTable } from "@/components/RingTable";
import { SummaryPanel } from "@/components/SummaryPanel";
import { buildGraph } from "@/lib/graphBuilder";

const WINDOW_HOURS = 72;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Recency weighting: the most recent 72 hours contribute 0.7 weight
 * to the displayed metric. The remaining weight (0.3) comes from
 * baseline/lifetime behavior.
 *
 * Displayed value at time t:
 *   metric = 0.7 * (tx count in last 72h / 72) + 0.3 * (cumulative tx / span hours)
 * i.e. weighted average of recent rate and overall rate.
 */
function buildTimeSeriesPoints(
  graph: GraphData | null,
  accountId: string | null
): { t: number; value: number }[] {
  if (!graph || !accountId) return [];

  const series = graph.timeSeries.get(accountId);
  if (!series) return [];

  const events = [...series.inbound, ...series.outbound].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  if (events.length === 0) return [];

  const firstTs = events[0]!.timestamp.getTime();
  const points: { t: number; value: number }[] = [];
  let start = 0;

  for (let i = 0; i < events.length; i += 1) {
    const t = events[i]!.timestamp.getTime();
    const windowStart = t - WINDOW_MS;

    while (start <= i && events[start]!.timestamp.getTime() < windowStart) {
      start += 1;
    }
    const windowCount = i - start + 1;
    const recentRate = windowCount / WINDOW_HOURS;

    const spanHours = Math.max(1, (t - firstTs) / (60 * 60 * 1000));
    const overallRate = (i + 1) / spanHours;

    const weighted = 0.7 * recentRate + 0.3 * overallRate;
    points.push({ t, value: weighted });
  }
  return points;
}

function TimeSeriesChart({
  points,
  title,
}: {
  points: { t: number; value: number }[];
  title: string;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
        No transaction data for this node
      </div>
    );
  }

  const minT = points[0]!.t;
  const maxT = points[points.length - 1]!.t;
  const maxVal = Math.max(...points.map((p) => p.value), 0.001);
  const w = 360;
  const h = 140;
  const pad = { L: 36, R: 12, T: 12, B: 24 };
  const innerW = w - pad.L - pad.R;
  const innerH = h - pad.T - pad.B;

  const pathD = points
    .map((p, i) => {
      const x =
        pad.L +
        (innerW * (p.t - minT)) / Math.max(1, maxT - minT);
      const y = pad.T + innerH * (1 - p.value / maxVal);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="mb-1 text-xs font-semibold text-zinc-800">{title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full max-w-full">
        <path
          d={pathD}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>Time</span>
        <span>
          Tx rate (72h weighted, 0.7 recent + 0.3 baseline) — tx/hour
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [result, setResult] = useState<AnalyzeApiResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);

  const graphData = useMemo<GraphData | null>(() => {
    if (!transactions?.length) return null;
    return buildGraph(transactions);
  }, [transactions]);

  const timeSeriesPoints = useMemo(
    () => buildTimeSeriesPoints(graphData, selectedNodeId),
    [graphData, selectedNodeId]
  );

  const downloadableJson = useMemo(() => {
    if (!result) return null;
    return JSON.stringify(result.analysis, null, 2);
  }, [result]);

  const handleDownloadJson = () => {
    if (!downloadableJson) return;
    const blob = new Blob([downloadableJson], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "analysis-result.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleNodeChange = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setExplanation(null);
  };

  const handleExplain = async () => {
    if (!result || !selectedNodeId || !graphData) return;

    setIsExplaining(true);
    setExplanation(null);

    try {
      const node = result.graphNodes.find((n) => n.id === selectedNodeId);
      const displayId = selectedNodeId.replace(/^ACC_/, "");
      const suspicious = result.analysis.suspicious_accounts.find(
        (a) => a.account_id === selectedNodeId
      );
      const flagged = !!suspicious || (node?.suspicion_score ?? 0) > 0;

      const inDegree = graphData.inDegree.get(selectedNodeId) ?? 0;
      const outDegree = graphData.outDegree.get(selectedNodeId) ?? 0;
      const totalTx = graphData.transactionCounts.get(selectedNodeId) ?? 0;

      const points = buildTimeSeriesPoints(graphData, selectedNodeId);
      const maxRate = points.length
        ? Math.max(...points.map((p) => p.value))
        : 0;
      const avgRate =
        points.length > 0
          ? points.reduce((s, p) => s + p.value, 0) / points.length
          : 0;

      const metrics = {
        node_id: selectedNodeId,
        display_id: displayId,
        suspicion_score: node?.suspicion_score ?? 0,
        flagged,
        detected_patterns: node?.detected_patterns ?? [],
        ring_id: node?.ring_id ?? null,
        in_degree: inDegree,
        out_degree: outDegree,
        total_transactions: totalTx,
        time_series: {
          points_count: points.length,
          max_weighted_rate_tx_per_hour: maxRate,
          avg_weighted_rate_tx_per_hour: avgRate,
          recency_weighting:
            "0.7 * (tx in last 72h / 72) + 0.3 * (cumulative tx / span hours)",
        },
        thresholds: {
          cycle_3: 45,
          cycle_4: 40,
          cycle_5: 35,
          smurfing_10_19: 25,
          smurfing_20_29: 35,
          smurfing_30_plus: 45,
          layered_shell: 40,
          high_velocity: 15,
          pattern_bonus_2_plus: 20,
          score_range: [0, 100],
        },
        decision: flagged ? "flagged" : "not_flagged",
      };

      const res = await fetch("/api/explain-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructions:
            "Explain this node's risk score using ONLY the provided metrics, thresholds, and decision. Be factual. Cover: key metrics, observed patterns, why patterns affected the score, why flagged or not. No speculation or marketing language.",
          metrics,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Explanation request failed");
      }

      const body = (await res.json()) as { explanation?: string };
      setExplanation(body.explanation ?? "No explanation returned.");
    } catch (e) {
      setExplanation(
        e instanceof Error ? e.message : "Failed to get explanation."
      );
    } finally {
      setIsExplaining(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            RIFT 2026 Financial Forensics Engine
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Upload a transaction CSV to detect money muling networks using
            graph-based analysis. The engine constructs a directed transaction
            graph, identifies suspicious patterns, scores accounts, and
            highlights fraud rings.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <UploadForm
              onAnalysisComplete={(data) => {
                setResult(data);
                setError("");
                setSelectedNodeId(data.graphNodes[0]?.id ?? null);
                setExplanation(null);
              }}
              onError={(message) => {
                setError(message);
                setResult(null);
                setTransactions(null);
                setSelectedNodeId(null);
                setExplanation(null);
              }}
              onTransactionsParsed={(txs) => setTransactions(txs)}
            />
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            {result && (
              <div className="space-y-3">
                <SummaryPanel analysis={result.analysis} />
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800"
                >
                  Download JSON
                </button>
                {downloadableJson && (
                  <div className="max-h-64 overflow-auto rounded-md border border-zinc-200 bg-zinc-950 p-3 text-[11px] text-zinc-100">
                    <pre className="whitespace-pre-wrap wrap-break-word">
                      <code>{downloadableJson}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {result ? (
              <>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="node-select"
                    className="shrink-0 text-xs font-medium text-zinc-700"
                  >
                    Account:
                  </label>
                  <select
                    id="node-select"
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800"
                    value={selectedNodeId ?? ""}
                    onChange={(e) =>
                      handleNodeChange(e.target.value || null)
                    }
                  >
                    <option value="">Select account…</option>
                    {result.graphNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id.replace(/^ACC_/, "")} — score{" "}
                        {n.suspicion_score.toFixed(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <TimeSeriesChart
                  points={timeSeriesPoints}
                  title="72-hour moving average (recency-weighted tx rate)"
                />

                <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3">
                  <button
                    type="button"
                    disabled={
                      !selectedNodeId || isExplaining || !graphData
                    }
                    onClick={handleExplain}
                    className="w-full rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  >
                    {isExplaining
                      ? "Explaining…"
                      : "Explain this node's risk score"}
                  </button>
                  {explanation && (
                    <div className="max-h-48 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-800">
                      <pre className="whitespace-pre-wrap font-sans">
                        {explanation}
                      </pre>
                    </div>
                  )}
                </div>

                <GraphView result={result} />
              </>
            ) : (
              <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                Graph visualization will appear here after analysis.
              </div>
            )}
          </div>
        </section>

        {result && (
          <section className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-800">
              Fraud Ring Summary
            </h2>
            <RingTable analysis={result.analysis} />
          </section>
        )}
      </main>
    </div>
  );
}
