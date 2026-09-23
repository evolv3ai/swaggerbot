/** How long a set of answers took, in milliseconds. */
export type Latency = {
  count: number;
  p50: number;
  p90: number;
  max: number;
};

/**
 * The `p`th percentile (0 < p ≤ 100) of `values` by the nearest-rank method:
 * the smallest value with at least `p`% of the values at or below it. `0` for
 * no values.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

/** The p50, p90 and max of `values`; all `0` for none. */
export function latencyOf(values: readonly number[]): Latency {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: percentile(values, 100),
  };
}
