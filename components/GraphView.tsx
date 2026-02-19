"use client";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error no types published for this package
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import type { AnalyzeApiResponse } from "@/types";
import { useEffect, useMemo, useState } from "react";

type GraphViewProps = {
  result: AnalyzeApiResponse;
};

/** Risk score → color mapping. Node color derived only from score range. */
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

export function GraphView({ result }: GraphViewProps) {
  const [isClient, setIsClient] = useState(false);
  const [activeNode, setActiveNode] = useState<{
    id: string;
    displayId: string;
    suspicion_score: number;
    riskLabel: string;
    patterns: string;
    ring_id: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const elements = useMemo(() => {
    const nodes = result.graphNodes.map((node) => {
      const score = node.suspicion_score;
      const color = getRiskColor(score);
      const isSuspicious = score > 0;
      const displayId = node.id.replace(/^ACC_/, "");
      const riskLabel =
        RISK_LEVELS.find((r) => score >= r.min && score < r.max)?.label ??
        RISK_LEVELS[0]!.label;

      return {
        data: {
          id: node.id,
          label: displayId,
          displayId,
          suspicion_score: score,
          riskLabel,
          patterns: node.detected_patterns.join(", "),
          ring_id: node.ring_id ?? "",
        },
        style: {
          "background-color": color,
          "border-width": 0,
          "border-opacity": 0,
          "label": displayId,
          "font-size": isSuspicious ? 10 : 8,
          "text-valign": "center",
          "text-halign": "center",
          "color": score >= 80 ? "#ffffff" : "#171717",
          width: isSuspicious ? 32 : 20,
          height: isSuspicious ? 32 : 20,
        },
      };
    });

    const edges = result.graphEdges.map((edge) => ({
      data: {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
      },
    }));

    return [...nodes, ...edges];
  }, [result]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          width: 20,
          height: 20,
          "border-width": 0,
          "border-opacity": 0,
        },
      },
      {
        selector: "edge",
        style: {
          "width": 1,
          "line-color": "#d4d4d8",
          "target-arrow-color": "#d4d4d8",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: "node:hover",
        style: {
          "overlay-opacity": 0.1,
          "overlay-color": "#0f172a",
        },
      },
    ],
    [],
  );

  return (
    <div className="relative h-[520px] w-full rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
      {isClient ? (
        <CytoscapeComponent
          elements={elements}
          layout={{ name: "cose", animate: false }}
          stylesheet={stylesheet}
          style={{ width: "100%", height: "100%" }}
          cy={(cyInstance: cytoscape.Core) => {
            cyInstance.off("mouseover");
            cyInstance.on("mouseover", "node", (evt) => {
              const data = evt.target.data();
              const pos = evt.target.renderedPosition();
              setActiveNode({
                id: data.id as string,
                displayId: (data.displayId as string) ?? data.id,
                suspicion_score: data.suspicion_score as number,
                riskLabel: (data.riskLabel as string) ?? "",
                patterns: (data.patterns as string) ?? "",
                ring_id: (data.ring_id as string) ?? "",
                x: pos.x,
                y: pos.y,
              });
            });

            cyInstance.off("mouseout");
            cyInstance.on("mouseout", "node", () => {
              setActiveNode(null);
            });
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
          Preparing graph…
        </div>
      )}

      {activeNode && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md bg-black/90 px-2 py-1.5 text-[11px] text-zinc-100 shadow-lg"
          style={{
            left: Math.min(activeNode.x + 20, 400),
            top: activeNode.y + 20,
          }}
        >
          <div className="space-y-0.5">
            <div>
              <span className="font-semibold">Account:</span>{" "}
              <span className="font-mono">{activeNode.displayId}</span>
            </div>
            <div>
              <span className="font-semibold">Score:</span>{" "}
              {activeNode.suspicion_score.toFixed(1)}
            </div>
            <div>
              <span className="font-semibold">Status:</span>{" "}
              {activeNode.riskLabel}
            </div>
            <div>
              <span className="font-semibold">Ring:</span>{" "}
              {activeNode.ring_id || "—"}
            </div>
            <div>
              <span className="font-semibold">Patterns:</span>{" "}
              {activeNode.patterns || "None"}
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

