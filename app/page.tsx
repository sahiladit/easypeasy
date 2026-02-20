"use client";

import { useMemo, useState, useEffect } from "react";
import type { AnalyzeApiResponse } from "@/types";
import { UploadForm } from "@/components/UploadForm";
import { GraphView } from "@/components/GraphView";
import { RingTable } from "@/components/RingTable";
import { SummaryPanel } from "@/components/SummaryPanel";
import { TransactionGraph } from "@/components/TransactionGraph";

export default function Home() {
  const [result, setResult] = useState<AnalyzeApiResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [currentExplanation, setCurrentExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  useEffect(() => {
    if (!result) {
      setCurrentNode(null);
      setCurrentExplanation(null);
      return;
    }
    const firstId = result.graphNodes[0]?.id ?? null;
    setCurrentNode(firstId);
    setCurrentExplanation(null);
  }, [result]);

  const nodeTimestamps = result?.nodeTimestamps ?? {};
  const nodeExplainerContext = result?.nodeExplainerContext ?? {};
  const timestampsForCurrent = currentNode ? (nodeTimestamps[currentNode] ?? []) : [];

  const downloadableJson = useMemo(() => {
    if (!result) return null;
    return JSON.stringify(result.analysis, null, 2);
  }, [result]);

  const handleNodeChange = (nodeId: string) => {
    setCurrentNode(nodeId);
    setCurrentExplanation(null);
  };

  const handleExplain = async () => {
    if (!currentNode) return;
    const context = nodeExplainerContext[currentNode];
    if (!context) return;
    setExplainLoading(true);
    setCurrentExplanation(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = (await res.json()) as { explanation?: string; error?: string };
      if (data.error) {
        setCurrentExplanation(`Error: ${data.error}`);
      } else {
        setCurrentExplanation(data.explanation ?? "");
      }
    } catch (e) {
      setCurrentExplanation(`Error: ${e instanceof Error ? e.message : "Request failed"}`);
    } finally {
      setExplainLoading(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Easypeasy Financial Forensics Engine
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
                <SummaryPanel
                  analysis={result.analysis}
                  timingBreakdown={result.timingBreakdown ?? null}
                />
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
              <GraphView result={result} />
            ) : (
              <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                Graph visualization will appear here after analysis.
              </div>
            )}
          </div>
        </section>

        {result && result.graphNodes.length > 0 && (
          <section className="flex flex-col gap-2">
            <label htmlFor="node-select" className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Select node
            </label>
            <select
              id="node-select"
              value={currentNode ?? ""}
              onChange={(e) => handleNodeChange(e.target.value)}
              className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {result.graphNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id.replace(/^ACC_/, "")} (score: {n.suspicion_score.toFixed(1)})
                </option>
              ))}
            </select>
          </section>
        )}

        {result && currentNode && (
          <section className="mt-4 space-y-4">
            <TransactionGraph
              nodeId={currentNode}
              nodeLabel={currentNode.replace(/^ACC_/, "")}
              timestampsMs={timestampsForCurrent}
            />
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleExplain}
                disabled={explainLoading}
                className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {explainLoading ? "Generating…" : "Explain this node's score"}
              </button>
              {currentExplanation !== null && currentExplanation !== "" && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Explanation
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-zinc-800">
                    {currentExplanation}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

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

