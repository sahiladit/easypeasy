/**
 * Transaction time-series for the node activity chart.
 *
 * Builds a 72-hour moving window over the timeline and applies recency weighting:
 * - The most recent 72 hours of the timeline get weight 0.7 in the displayed metric.
 * - Older windows get the remaining weight (0.3 total) so that recent activity
 *   is emphasized without hiding older patterns.
 */

const WINDOW_MS = 72 * 60 * 60 * 1000;
const RECENCY_WEIGHT_RECENT = 0.7;
const RECENCY_WEIGHT_OLDER = 0.3;

export type TimeSeriesPoint = {
  /** Window end time (ms). */
  t: number;
  /** 72h moving average transaction count for the window ending at t. */
  rawCount: number;
  /** Recency weight applied: 0.7 if window is in the last 72h, else 0.3. */
  weight: number;
  /** Displayed metric: rawCount * weight (72h moving avg with recency weighting). */
  value: number;
};

/**
 * Compute 72-hour moving average of transaction count with recency weighting.
 * @param timestampsMs Sorted array of transaction timestamps (ms) for the selected node.
 * @param bucketStepMs Step between window end times (e.g. 1 hour).
 */
export function compute72hMovingAverageWithRecency(
  timestampsMs: number[],
  bucketStepMs: number = 60 * 60 * 1000,
): TimeSeriesPoint[] {
  if (timestampsMs.length === 0) return [];

  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const tMin = sorted[0]!;
  const tMax = sorted[sorted.length - 1]!;
  const cutoffRecent = tMax - WINDOW_MS; // Windows ending after this are "recent"

  const points: TimeSeriesPoint[] = [];
  let windowEnd = tMin + WINDOW_MS;
  if (windowEnd > tMax) windowEnd = tMax;

  while (windowEnd <= tMax + bucketStepMs) {
    const windowStart = windowEnd - WINDOW_MS;
    let count = 0;
    for (const t of sorted) {
      if (t >= windowStart && t <= windowEnd) count += 1;
      if (t > windowEnd) break;
    }
    const isRecent = windowEnd >= cutoffRecent;
    const weight = isRecent ? RECENCY_WEIGHT_RECENT : RECENCY_WEIGHT_OLDER;
    points.push({
      t: windowEnd,
      rawCount: count,
      weight,
      value: count * weight,
    });
    windowEnd += bucketStepMs;
  }

  return points;
}
