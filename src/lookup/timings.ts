/**
 * The steps of a Lookup that are timed, by the names its comments and
 * diagnostics use. They don't overlap: a Spec fetched and judged inside the
 * known-path probe, the crawl or GitHub code search counts to that step, and
 * "Spec fetch" is the APIs.guru origin URLs and mirror.
 */
export type LookupStep =
  | "Index"
  | "APIs.guru"
  | "umbrella check"
  | "Judge whichApi"
  | "Developer Portal search"
  | "Judge isVendorName"
  | "Vendor API crawl"
  | "Spec fetch"
  | "known paths"
  | "Developer Portal crawl"
  | "GitHub code search";

/** Runs `fn` as `step`, adding its time to the step's, even when it throws. */
export type Timed = <T>(
  step: LookupStep,
  fn: () => T | Promise<T>,
) => Promise<T>;

/** A timer for one Lookup, and what it has measured so far. */
export function stepTimer(): {
  timed: Timed;
  /** Each step's total time in milliseconds, rounded. */
  timings: () => Record<string, number>;
} {
  const totals = new Map<LookupStep, number>();
  const timed: Timed = async (step, fn) => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      totals.set(step, (totals.get(step) ?? 0) + performance.now() - start);
    }
  };
  const timings = () =>
    Object.fromEntries([...totals].map(([step, ms]) => [step, Math.round(ms)]));
  return { timed, timings };
}
