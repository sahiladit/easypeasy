"use client";

import { useMemo, useState, useCallback } from "react";
import type { AnalyzeApiResponse, GraphNodeInfo } from "@/types";
import { UploadForm } from "@/components/UploadForm";
import { GraphView } from "@/components/GraphView";
import { RingTable } from "@/components/RingTable";
import { SummaryPanel } from "@/components/SummaryPanel";

// ─── helpers ────────────────────────────────────────────────────────────────

function severityLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "SEVERE", color: "text-red-600" };
  if (score >= 35) return { label: "SUSPICIOUS", color: "text-amber-600" };
  return { label: "NORMAL", color: "text-emerald-600" };
}

function buildPrompt(node: GraphNodeInfo): string {
  const { label } = severityLabel(node.suspicion_score);
  const patterns =
    node.detected_patterns.length > 0
      ? node.detected_patterns.join(", ")
      : "none";

  return `You are a financial forensics analyst reviewing an account flagged by an automated fraud detection engine called RIFT 2026.

Account ID: ${node.id}
Suspicion Score: ${node.suspicion_score.toFixed(1)} / 100  →  ${label}
Ring ID: ${node.ring_id || "not assigned to any fraud ring"}
Detected Patterns: ${patterns}

Write a concise 3–5 sentence plain-English explanation for a compliance officer. Cover:
1. Why this account received this score (reference the specific patterns above).
2. What the detected patterns mean in the context of money muling / layered fraud.
3. The recommended next step (e.g. escalate, monitor, clear).

Be direct and professional. Do not repeat the raw numbers verbatim — interpret them.`;
}

// ─── main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [result, setResult] = useState<AnalyzeApiResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [explanation, setExplanation] = useState<string>("");
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string>("");

  const downloadableJson = useMemo(() => {
    if (!result) return null;
    return JSON.stringify(result.analysis, null, 2);
  }, [result]);

  // Sort nodes: highest score first, then alphabetically
  const sortedNodes = useMemo(() => {
    if (!result) return [];
    return [...result.graphNodes].sort(
      (a, b) =>
        b.suspicion_score - a.suspicion_score ||
        a.id.localeCompare(b.id),
    );
  }, [result]);

  const selectedNode = useMemo(
    () => result?.graphNodes.find((n) => n.id === selectedNodeId) ?? null,
    [result, selectedNodeId],
  );

  const handleDownloadJson = () => {
    if (!downloadableJson) return;
    const blob = new Blob([downloadableJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "analysis-result.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExplain = useCallback(async () => {
    if (!selectedNode) return;
    setIsExplaining(true);
    setExplanation("");
    setExplainError("");

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: buildPrompt(selectedNode) }],
        }),
      });

      if (!response.ok) throw new Error("LLM request failed.");

      const data = await response.json() as {
        content: { type: string; text?: string }[];
      };
      const text = data.content
        .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
        .join("")
        .trim();

      setExplanation(text);
    } catch {
      setExplainError("Failed to generate explanation. Please try again.");
    } finally {
      setIsExplaining(false);
    }
  }, [selectedNode]);

  const handleNodeChange = (id: string) => {
    setSelectedNodeId(id);
    setExplanation("");
    setExplainError("");
  };

  const sv = selectedNode ? severityLabel(selectedNode.suspicion_score) : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">

        {/* ── header ── */}
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

        {/* ── upload + graph ── */}
        <section className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <UploadForm
              onAnalysisComplete={(data) => {
                setResult(data);
                setError("");
                setSelectedNodeId("");
                setExplanation("");
              }}
              onError={(message) => {
                setError(message);
                setResult(null);
              }}
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
                    <pre className="whitespace-pre-wrap break-words">
                      <code>{downloadableJson}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {result ? (
              <GraphView result={result} />
            ) : (
              <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                Graph visualization will appear here after analysis.
              </div>
            )}
          </div>
        </section>

        {/* ── node inspector ── */}
        {result && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-800">
              Account Risk Inspector
            </h2>

            {/* dropdown */}
            <div className="flex items-center gap-3">
              <label
                htmlFor="node-select"
                className="shrink-0 text-xs font-medium text-zinc-600"
              >
                Select account:
              </label>
              <select
                id="node-select"
                value={selectedNodeId}
                onChange={(e) => handleNodeChange(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
              >
                <option value="">— choose a node —</option>
                {sortedNodes.map((n) => {
                  const { label } = severityLabel(n.suspicion_score);
                  return (
                    <option key={n.id} value={n.id}>
                      {n.id} · {n.suspicion_score.toFixed(1)} · {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* selected node info card */}
            {selectedNode && sv && (
              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                {/* node meta */}
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-zinc-900">
                      {selectedNode.id}
                    </p>
                    {selectedNode.ring_id && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Ring:{" "}
                        <span className="font-medium text-zinc-700">
                          {selectedNode.ring_id}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${sv.color}`}>
                      {sv.label}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Score:{" "}
                      <span className="font-semibold text-zinc-700">
                        {selectedNode.suspicion_score.toFixed(1)}
                      </span>
                      {" "}/ 100
                    </p>
                  </div>
                </div>

                {/* detected patterns */}
                <div className="mb-4">
                  <p className="mb-1.5 text-xs font-medium text-zinc-600">
                    Detected patterns
                  </p>
                  {selectedNode.detected_patterns.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.detected_patterns.map((p) => (
                        <span
                          key={p}
                          className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-700"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400">None detected</p>
                  )}
                </div>

                {/* explain button */}
                <button
                  type="button"
                  onClick={handleExplain}
                  disabled={isExplaining}
                  className="w-full rounded-md bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  {isExplaining ? "Generating explanation…" : "Explain with AI"}
                </button>

                {/* explanation output */}
                {explainError && (
                  <p className="mt-2 text-xs text-red-600">{explainError}</p>
                )}
                {explanation && (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                      AI Forensics Summary
                    </p>
                    <p className="text-xs leading-relaxed text-zinc-800 whitespace-pre-wrap">
                      {explanation}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── fraud ring table ── */}
        {result && (
          <section className="mt-2">
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
