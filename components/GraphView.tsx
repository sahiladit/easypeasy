"use client";

import CytoscapeComponent from "react-cytoscapejs";
import type { AnalyzeApiResponse } from "@/types";
import { useEffect, useMemo, useState } from "react";

type GraphViewProps = {
  result: AnalyzeApiResponse;
};

const RING_COLORS = [
  "#1d4ed8",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#db2777",
  "#0f766e",
  "#b91c1c",
  "#4b5563",
];

export function GraphView({ result }: GraphViewProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const elements = useMemo(() => {
    const ringColorMap = new Map<string, string>();
    let ringIndex = 0;
    for (const ring of result.analysis.fraud_rings) {
      if (!ringColorMap.has(ring.ring_id)) {
        const color =
          RING_COLORS[ringIndex % RING_COLORS.length] ?? "#1d4ed8";
        ringColorMap.set(ring.ring_id, color);
        ringIndex += 1;
      }
    }

    const nodes = result.graphNodes.map((node) => {
      const baseColor = "#3b82f6";
      const ringColor = node.ring_id
        ? ringColorMap.get(node.ring_id) ?? baseColor
        : baseColor;
      const isSuspicious = node.suspicion_score > 0;

      return {
        data: {
          id: node.id,
          label: node.id,
          suspicion_score: node.suspicion_score,
          patterns: node.detected_patterns.join(", "),
          ring_id: node.ring_id ?? "",
        },
        style: {
          "background-color": ringColor,
          "border-width": isSuspicious ? 4 : 1,
          "border-color": isSuspicious ? "#dc2626" : "#1e293b",
          "label": node.id,
          "font-size": 8,
          "text-valign": "center",
          "text-halign": "center",
          "color": "#f9fafb",
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
          "width": 24,
          "height": 24,
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
    <div className="h-[480px] w-full rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
      {isClient ? (
        <CytoscapeComponent
          elements={elements}
          layout={{ name: "cose", animate: false }}
          stylesheet={stylesheet}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
          Preparing graph…
        </div>
      )}
    </div>
  );
}

