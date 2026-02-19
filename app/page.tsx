"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useMemo, useState } from "react";
import type { AnalyzeApiResponse } from "@/types";
import { UploadForm } from "@/components/UploadForm";
import { RingTable } from "@/components/RingTable";
import { SummaryPanel } from "@/components/SummaryPanel";

// Lazy-load GraphView so summary + table appear immediately
const GraphView = dynamic(
  () => import("@/components/GraphView").then((m) => ({ default: m.GraphView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
        <svg
          className="mr-2 h-5 w-5 animate-spin text-zinc-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading graph…
      </div>
    ),
  },
);

export default function Home() {
  const [result, setResult] = useState<AnalyzeApiResponse | null>(null);
  const [error, setError] = useState<string>("");

  // Defer heavy JSON stringification so it doesn't block initial rendering
  const deferredResult = useDeferredValue(result);

  const downloadableJson = useMemo(() => {
    if (!deferredResult) return null;
    return JSON.stringify(deferredResult.analysis, null, 2);
  }, [deferredResult]);

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
