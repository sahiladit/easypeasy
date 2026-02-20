"use client";

import { useMemo } from "react";
import { compute72hMovingAverageWithRecency } from "@/lib/transactionTimeSeries";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 280;
const PAD = { left: 48, right: 24, top: 24, bottom: 36 };

type TransactionGraphProps = {
  nodeId: string;
  nodeLabel: string;
  /** Sorted or unsorted transaction timestamps (ms) for this node only. */
  timestampsMs: number[];
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TransactionGraph({
  nodeId,
  nodeLabel,
  timestampsMs,
}: TransactionGraphProps) {
  const points = useMemo(
    () => compute72hMovingAverageWithRecency(timestampsMs),
    [timestampsMs],
  );

  const { pathD, xScale, yScale, xTicks, yTicks } = useMemo(() => {
    if (points.length === 0) {
      return {
        pathD: "",
        xScale: (t: number) => 0,
        yScale: (v: number) => 0,
        xTicks: [] as number[],
        yTicks: [] as number[],
      };
    }
    const xMin = Math.min(...points.map((p) => p.t));
    const xMax = Math.max(...points.map((p) => p.t));
    const yMax = Math.max(1, Math.max(...points.map((p) => p.value)));
    const w = CHART_WIDTH - PAD.left - PAD.right;
    const h = CHART_HEIGHT - PAD.top - PAD.bottom;
    const xScale = (t: number) =>
      PAD.left + (w * (t - xMin)) / (xMax - xMin || 1);
    const yScale = (v: number) =>
      PAD.top + h - (h * v) / (yMax || 1);
    const pathD = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.t)} ${yScale(p.value)}`)
      .join(" ");
    const xTicks: number[] = [];
    const step = (xMax - xMin) / 5;
    for (let i = 0; i <= 5; i++) xTicks.push(xMin + step * i);
    const yTicks: number[] = [];
    for (let i = 0; i <= 4; i++)
      yTicks.push((yMax * i) / 4);
    return { pathD, xScale, yScale, xTicks, yTicks };
  }, [points]);

  if (timestampsMs.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-zinc-800">
          Transaction Activity – Node {nodeLabel}
        </h3>
        <div className="flex h-[280px] items-center justify-center text-sm text-zinc-500">
          No transaction data for this node.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800">
        Transaction Activity – Node {nodeLabel}
      </h3>
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="min-h-[280px] max-h-[320px]"
        preserveAspectRatio="xMidYMid meet"
      >
        <g aria-hidden="true">
          {/* Y-axis label */}
          <text
            x={PAD.left - 36}
            y={CHART_HEIGHT / 2}
            textAnchor="middle"
            transform={`rotate(-90, ${PAD.left - 36}, ${CHART_HEIGHT / 2})`}
            className="fill-zinc-500 text-[10px] font-medium"
          >
            72h Moving Avg Transactions
          </text>
          {/* X-axis label */}
          <text
            x={CHART_WIDTH / 2}
            y={CHART_HEIGHT - 8}
            textAnchor="middle"
            className="fill-zinc-500 text-[10px] font-medium"
          >
            Time
          </text>
          {/* Y ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={CHART_WIDTH - PAD.right}
                y1={yScale(v)}
                y2={yScale(v)}
                stroke="rgba(0,0,0,0.06)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={yScale(v) + 3}
                textAnchor="end"
                className="fill-zinc-500 text-[9px]"
              >
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {/* X ticks */}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={xScale(t)}
              y={CHART_HEIGHT - 16}
              textAnchor="middle"
              className="fill-zinc-500 text-[9px]"
            >
              {formatTime(t)}
            </text>
          ))}
          {/* Line */}
          <path
            d={pathD}
            fill="none"
            stroke="rgb(59, 130, 246)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
