"use client";

import type { AnalyzeApiResponse } from "@/types";
import { useEffect, useRef, useState, useCallback } from "react";

type GraphViewProps = {
  result: AnalyzeApiResponse;
};

const RISK_LEVELS = [
  { min: 0,  max: 20,  label: "Normal / Very Low", color: "#86efac" },
  { min: 20, max: 40,  label: "Low",                color: "#eab308" },
  { min: 40, max: 60,  label: "Moderate",           color: "#f97316" },
  { min: 60, max: 80,  label: "High",               color: "#ef4444" },
  { min: 80, max: 101, label: "Severe",              color: "#1e1b4b" },
] as const;

function getRiskColor(score: number) {
  return RISK_LEVELS.find((r) => score >= r.min && score < r.max)?.color ?? "#86efac";
}

function getLabelColor(score: number) {
  return score >= 40 ? "#ffffff" : "#111827";
}

interface NodeState {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  labelColor: string;
  score: number;
  patterns: string;
  ring_id: string;
  riskLabel: string;
}

interface EdgeState {
  source: string;
  target: string;
}

export function GraphView({ result }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const nodesRef = useRef<NodeState[]>([]);
  const edgesRef = useRef<EdgeState[]>([]);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const pinnedNodeRef = useRef<string | null>(null);
  const dragNodeRef = useRef<NodeState | null>(null);
  const simulationDoneRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tooltip, setTooltip] = useState<{
    node: NodeState;
    px: number;
    py: number;
  } | null>(null);

  // ── Build nodes & edges once per result ──────────────────────────────────
  useEffect(() => {
    const n = result.graphNodes.length;
    if (n === 0) return;

    const cols = Math.ceil(Math.sqrt(n * 1.6));
    const spacing = 180;

    nodesRef.current = result.graphNodes.map((node, i) => {
      const score = node.suspicion_score ?? 0;
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        id: node.id,
        label: node.id.replace(/^ACC_/, ""),
        x: (col - cols / 2) * spacing + (Math.random() - 0.5) * 60,
        y: (row - Math.ceil(n / cols) / 2) * spacing + (Math.random() - 0.5) * 60,
        vx: 0,
        vy: 0,
        radius: score >= 60 ? 36 : score >= 40 ? 30 : 24,
        color: getRiskColor(score),
        labelColor: getLabelColor(score),
        score,
        patterns: node.detected_patterns.join(", ") || "None",
        ring_id: node.ring_id ?? "",
        riskLabel: RISK_LEVELS.find((r) => score >= r.min && score < r.max)?.label ?? "Normal / Very Low",
      };
    });

    edgesRef.current = result.graphEdges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    simulationDoneRef.current = false;
    cameraRef.current = { x: 0, y: 0, scale: 1 };
  }, [result]);

  // ── Force simulation step ─────────────────────────────────────────────────
  const runSimulationStep = useCallback((alpha: number) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = (a.radius + b.radius) * 4.0;
        if (dist < minDist) {
          const force = ((minDist - dist) / dist) * alpha * 2.0;
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
    }

    // Edge attraction
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b || a === b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = (a.radius + b.radius) * 5.0;
      const force = ((dist - ideal) / dist) * alpha * 0.25;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }

    // Gravity + damping + integrate
    for (const n of nodes) {
      if (pinnedNodeRef.current === n.id) continue;
      n.vx += -n.x * alpha * 0.012;
      n.vy += -n.y * alpha * 0.012;
      n.vx *= 0.72;
      n.vy *= 0.72;
      n.x += n.vx;
      n.y += n.vy;
    }
  }, []);

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const { x: camX, y: camY, scale } = cameraRef.current;

    ctx.clearRect(0, 0, W, H);

    // Subtle grid background
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.lineWidth = 1;
    const gridSize = 40 * scale;
    const offX = ((camX % gridSize) + gridSize) % gridSize;
    const offY = ((camY % gridSize) + gridSize) % gridSize;
    for (let gx = offX; gx < W; gx += gridSize) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = offY; gy < H; gy += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(W / 2 + camX, H / 2 + camY);
    ctx.scale(scale, scale);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // ── Edges + Arrows ────────────────────────────────────────────────────
    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt || src === tgt) continue;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      // Start at edge of source circle
      const startX = src.x + nx * src.radius;
      const startY = src.y + ny * src.radius;

      // Arrowhead dimensions
      const arrowLen = 14;
      const arrowW  = 6;

      // End of line = before arrowhead base
      const lineEndX = tgt.x - nx * (tgt.radius + arrowLen);
      const lineEndY = tgt.y - ny * (tgt.radius + arrowLen);

      // Arrow tip = surface of target circle
      const tipX = tgt.x - nx * tgt.radius;
      const tipY = tgt.y - ny * tgt.radius;

      // Arrow base corners (perpendicular to direction)
      const bx1 = lineEndX - ny * arrowW;
      const by1 = lineEndY + nx * arrowW;
      const bx2 = lineEndX + ny * arrowW;
      const by2 = lineEndY - nx * arrowW;

      // Draw line
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.stroke();

      // Draw filled arrowhead
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(bx1, by1);
      ctx.lineTo(bx2, by2);
      ctx.closePath();
      ctx.fillStyle = "#64748b";
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Nodes ─────────────────────────────────────────────────────────────
    for (const node of nodes) {
      // Drop shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.22)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;

      // Circle fill
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.restore();

      // Border ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label INSIDE node
      const fontSize = Math.max(7, Math.min(11, node.radius * 0.48));
      ctx.font = `700 ${fontSize}px ui-monospace, 'Cascadia Code', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = node.labelColor;

      // Truncate label if too long
      const maxW = node.radius * 1.75;
      const fullLabel = node.label;
      let displayLabel = fullLabel;
      if (ctx.measureText(fullLabel).width > maxW) {
        // Trim to fit
        let lo = 0, hi = fullLabel.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (ctx.measureText(fullLabel.slice(0, mid) + "…").width <= maxW) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        displayLabel = fullLabel.slice(0, lo) + (lo < fullLabel.length ? "…" : "");
      }
      ctx.fillText(displayLabel, node.x, node.y);
    }

    ctx.restore();
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let alpha = 1.0;
    const COOL = 0.975;
    const MIN_ALPHA = 0.005;

    function loop() {
      if (!simulationDoneRef.current) {
        runSimulationStep(alpha);
        alpha = Math.max(MIN_ALPHA, alpha * COOL);
        if (alpha <= MIN_ALPHA) simulationDoneRef.current = true;
      }
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    }

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw, runSimulationStep]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
    });
    ro.observe(container);
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => ro.disconnect();
  }, []);

  // ── Pointer utilities ─────────────────────────────────────────────────────
  function worldPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const { x: camX, y: camY, scale } = cameraRef.current;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const wx = (px - canvas.width  / 2 - camX) / scale;
    const wy = (py - canvas.height / 2 - camY) / scale;
    return { wx, wy, px, py };
  }

  function hitNode(wx: number, wy: number) {
    for (const n of [...nodesRef.current].reverse()) {
      const dx = n.x - wx;
      const dy = n.y - wy;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 6) return n;
    }
    return null;
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { wx, wy } = worldPos(e);
    const node = hitNode(wx, wy);
    if (node) {
      dragNodeRef.current  = node;
      pinnedNodeRef.current = node.id;
      simulationDoneRef.current = false; // restart sim so neighbours react
    } else {
      isDraggingRef.current = true;
      dragStartRef.current  = {
        x: e.clientX, y: e.clientY,
        camX: cameraRef.current.x,
        camY: cameraRef.current.y,
      };
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { wx, wy, px, py } = worldPos(e);

    if (dragNodeRef.current) {
      dragNodeRef.current.x  = wx;
      dragNodeRef.current.y  = wy;
      dragNodeRef.current.vx = 0;
      dragNodeRef.current.vy = 0;
      return;
    }

    if (isDraggingRef.current) {
      cameraRef.current.x = dragStartRef.current.camX + (e.clientX - dragStartRef.current.x);
      cameraRef.current.y = dragStartRef.current.camY + (e.clientY - dragStartRef.current.y);
      return;
    }

    const node = hitNode(wx, wy);
    if (node) {
      setTooltip({ node, px, py });
      canvasRef.current!.style.cursor = "pointer";
    } else {
      setTooltip(null);
      canvasRef.current!.style.cursor = "grab";
    }
  }

  function onMouseUp() {
    dragNodeRef.current   = null;
    isDraggingRef.current = false;
    pinnedNodeRef.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    cameraRef.current.scale = Math.min(5, Math.max(0.05, cameraRef.current.scale * factor));
  }

  return (
    <div className="relative h-[600px] w-full rounded-lg border border-zinc-200 bg-slate-50 shadow-sm overflow-hidden">
      <div ref={containerRef} className="h-full w-full">
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          style={{ display: "block", cursor: "grab" }}
        />
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg bg-black/90 px-3 py-2.5 text-[11px] text-zinc-100 shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(tooltip.px + 18, (containerRef.current?.clientWidth ?? 600) - 220),
            top:  Math.min(tooltip.py + 18, (containerRef.current?.clientHeight ?? 400) - 130),
            maxWidth: 210,
          }}
        >
          <div className="space-y-1">
            <div className="border-b border-white/15 pb-1 font-semibold text-white">
              {tooltip.node.label}
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Score</span>
              <span className="font-mono font-bold">{tooltip.node.score.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Risk</span>
              <span>{tooltip.node.riskLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Ring</span>
              <span className="font-mono">{tooltip.node.ring_id || "—"}</span>
            </div>
            <div>
              <span className="text-zinc-400">Patterns</span>
              <div className="mt-0.5 text-zinc-200">{tooltip.node.patterns}</div>
            </div>
          </div>
        </div>
      )}

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-zinc-200 bg-white/90 px-2 py-1.5 text-[10px] text-zinc-500 shadow-sm">
        Scroll to zoom · Drag canvas to pan · Drag node to reposition
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-zinc-200 bg-white/95 px-2.5 py-2 text-[10px] text-zinc-700 shadow-sm">
        <div className="mb-1.5 font-semibold text-zinc-900">Risk Legend</div>
        <div className="space-y-1">
          {RISK_LEVELS.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: r.color }}
              />
              <span className="flex-1">{r.label}</span>
              <span className="font-mono text-[9px] text-zinc-400">
                {r.min}–{r.max === 101 ? 100 : r.max}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}