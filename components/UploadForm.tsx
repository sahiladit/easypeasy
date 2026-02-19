"use client";

import { useState } from "react";
import type { AnalyzeApiResponse } from "@/types";

type UploadFormProps = {
  onAnalysisComplete: (result: AnalyzeApiResponse) => void;
  onError: (message: string) => void;
};

type ProgressStage = "idle" | "uploading" | "analyzing" | "loading";

const STAGE_LABELS: Record<ProgressStage, string> = {
  idle: "Run Analysis",
  uploading: "Uploading CSV…",
  analyzing: "Running analysis…",
  loading: "Loading results…",
};

export function UploadForm({ onAnalysisComplete, onError }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ProgressStage>("idle");

  const isSubmitting = stage !== "idle";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      onError("Please select a CSV file.");
      return;
    }

    onError("");

    try {
      setStage("uploading");
      const text = await file.text();

      setStage("analyzing");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ csv: text }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message =
          errorBody?.error ?? "Analysis failed. Please check your CSV.";
        onError(message);
        return;
      }

      setStage("loading");
      const data = (await response.json()) as AnalyzeApiResponse;
      onAnalysisComplete(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected upload error.";
      onError(message);
    } finally {
      setStage("idle");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div>
        <label
          htmlFor="csv"
          className="block text-sm font-medium text-zinc-800"
        >
          Transaction CSV
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Required columns (exact, in order):{" "}
          <code>
            transaction_id,sender_id,receiver_id,amount,timestamp
          </code>
          . Timestamp format: YYYY-MM-DD HH:MM:SS.
        </p>
      </div>
      <input
        id="csv"
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          setFile(selected);
        }}
        className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700"
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isSubmitting && (
          <svg
            className="mr-2 h-4 w-4 animate-spin"
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
        )}
        {STAGE_LABELS[stage]}
      </button>
    </form>
  );
}
