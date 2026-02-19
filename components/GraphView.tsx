"use client";

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { AnalyzeApiResponse } from "@/types";
import { useEffect, useMemo, useRef, useState } from "react";

type GraphViewProps = {
  result: AnalyzeApiResponse;
};

const RISK_LEVELS = [
  { min: 0, max: 20, label: "Normal / Very Low", color: "#86efac" },
  { min: 20, max: 40, label: "Low", color: "#eab308" },
  { min: 40, max: 60, label: "Moderate", color: "#f97316" },
  { min: 60, max: 80, label: "High", color: "#ef4444" },
  { min: 80, max: 101, label: "Severe", color: "#000000" },
] as const;

function getRiskColor(score: number): string {
  const level = RISK_LEVELS.find((r) => score >= r.min && score < r.max);
  return level?.color ?? RISK_LEVELS[0]!.color;
}

/** Label text color: dark on light nodes, white on dark (severe) nodes */
function getLabelColor(score: number): string {
  return score >= 80 ? "#ffffff" : "#171717";
}

export function GraphView({ result }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<any>(null);

  const [hoveredNode, setHoveredNode] = useState<{
    id: string;
    displayId: string;
    suspicion_score: number;
    riskLabel: string;
    patterns: string;
    ring_id: string;
    x: number;
    y: number;
  } | null>(null);

  const nodeIndex = useMemo(() => {
    const idx = new Map<string, (typeof result.graphNodes)[0]>();
    for (const n of result.graphNodes) {
      idx.set(n.id, n);
    }
    return idx;
  }, [result.graphNodes]);

  useEffect(() => {
    if (!containerRef.current) return;

    let killed = false;

    async function init() {
      // ✅ Browser-only import
      const { default: Sigma } = await import("sigma");

      if (killed || !containerRef.current) return;

      const graph = new Graph();

      const n = result.graphNodes.length;
      const r = Math.max(100, Math.sqrt(n) * 20);

      // --- Add nodes with random initial positions (NOT a circle) ---
      for (let i = 0; i < n; i += 1) {
        const node = result.graphNodes[i]!;
        const score = node.suspicion_score;
        const color = getRiskColor(score);
        const isSuspicious = score >= 40;
        const displayId = node.id.replace(/^ACC_/, "");
        const riskLabel =
          RISK_LEVELS.find((r) => score >= r.min && score < r.max)?.label ??
          RISK_LEVELS[0]!.label;

        const angle = Math.random() * 2 * Math.PI;
        const dist = Math.random() * r;
        const x = dist * Math.cos(angle);
        const y = dist * Math.sin(angle);

        graph.addNode(node.id, {
          x,
          y,
          size: isSuspicious ? 14 : 8,
          color,
          label: displayId,
          labelColor: getLabelColor(score),
          suspicion_score: score,
          displayId,
          riskLabel,
          patterns: node.detected_patterns.join(", "),
          ring_id: node.ring_id ?? "",
        });
      }

      // --- Add edges ---
      const edgeKeys = new Set<string>();
      for (const e of result.graphEdges) {
        const key = `${e.source}-${e.target}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          graph.addEdge(e.source, e.target, {});
        }
      }

      // --- Run ForceAtlas2 layout ---
      forceAtlas2.assign(graph, {
        iterations: Math.min(200, Math.max(50, n)),
        settings: {
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: n > 500,
        },
      });

      // --- Create Sigma renderer ---
      const sigma = new Sigma(graph, containerRef.current, {
        allowInvalidContainer: true,
        renderLabels: true,
        renderEdgeLabels: false,
        minCameraRatio: 0.01,
        maxCameraRatio: 100,
        defaultNodeColor: "#999",
        defaultEdgeColor: "#d4d4d8",
        defaultNodeType: "circle",
        defaultEdgeType: "line",
        labelSize: 12,
        labelWeight: "normal",
        labelColor: { attribute: "labelColor", color: "#171717" },
        labelDensity: 0.5,
        labelRenderedSizeThreshold: 4,
      });

      // --- Hover tooltip ---
      sigma.on("enterNode", ({ node }) => {
        const attr = graph.getNodeAttributes(node);
        const pos = sigma.graphToViewport({
          x: attr.x as number,
          y: attr.y as number,
        });
        setHoveredNode({
          id: node,
          displayId: (attr.displayId as string) ?? node,
          suspicion_score: (attr.suspicion_score as number) ?? 0,
          riskLabel: (attr.riskLabel as string) ?? "",
          patterns: (attr.patterns as string) ?? "",
          ring_id: (attr.ring_id as string) ?? "",
          x: pos.x,
          y: pos.y,
        });
      });

      sigma.on("leaveNode", () => {
        setHoveredNode(null);
      });

      sigmaRef.current = sigma;
    }

    init();

    return () => {
      killed = true;
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [result, nodeIndex]);

  return (
    <div className="relative h-[520px] w-full rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ minHeight: 300 }}
      />

      {hoveredNode && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md bg-black/90 px-2 py-1.5 text-[11px] text-zinc-100 shadow-lg"
          style={{
            left: Math.min(hoveredNode.x + 20, 400),
            top: hoveredNode.y + 20,
          }}
        >
          <div className="space-y-0.5">
            <div>
              <span className="font-semibold">Account:</span>{" "}
              <span className="font-mono">{hoveredNode.displayId}</span>
            </div>
            <div>
              <span className="font-semibold">Score:</span>{" "}
              {hoveredNode.suspicion_score.toFixed(1)}
            </div>
            <div>
              <span className="font-semibold">Status:</span>{" "}
              {hoveredNode.riskLabel}
            </div>
            <div>
              <span className="font-semibold">Ring:</span>{" "}
              {hoveredNode.ring_id || "—"}
            </div>
            <div>
              <span className="font-semibold">Patterns:</span>{" "}
              {hoveredNode.patterns || "None"}
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[10px] text-zinc-700 shadow-sm">
        <div className="mb-1.5 font-semibold text-zinc-900">Risk legend</div>
        <div className="space-y-1">
          {RISK_LEVELS.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-zinc-300"
                style={{ backgroundColor: r.color }}
              />
              <span className="min-w-0 flex-1">{r.label}</span>
              <span className="shrink-0 font-mono text-[9px]">
                {r.min}–{r.max === 101 ? 100 : r.max}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
