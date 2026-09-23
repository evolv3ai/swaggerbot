import type { Outcome } from "~/domain/outcome";
import type { BenchmarkEntry } from "./entry";
import { type BenchmarkAnswer, type BenchmarkReport, score } from "./score";

export type BenchmarkLookup = (name: string) => Promise<Outcome>;

export type RunBenchmarkOptions = {
  lookup: BenchmarkLookup;
  entries: readonly BenchmarkEntry[];
  /** Only score entries with `reviewed: true`. */
  onlyReviewed?: boolean;
  /** How many Lookups run at once. */
  concurrency?: number;
};

/**
 * Run `lookup` on every entry, `concurrency` at a time, then `score`.
 * A Lookup that throws counts as an Unknown answer and is listed as an error.
 * Each answer is timed.
 */
export async function runBenchmark({
  lookup,
  entries,
  onlyReviewed = false,
  concurrency = 4,
}: RunBenchmarkOptions): Promise<BenchmarkReport> {
  const selected = onlyReviewed ? entries.filter((e) => e.reviewed) : entries;
  const answers: BenchmarkAnswer[] = new Array(selected.length);
  let next = 0;

  async function worker() {
    while (next < selected.length) {
      const i = next++;
      const { name } = selected[i] as BenchmarkEntry;
      const start = performance.now();
      const ms = () => Math.round(performance.now() - start);
      try {
        const outcome = await lookup(name);
        answers[i] = { name, outcome, ms: ms() };
      } catch (err) {
        answers[i] = {
          name,
          outcome: { outcome: "Unknown", name },
          error: err instanceof Error ? err.message : String(err),
          ms: ms(),
        };
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, selected.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return score(selected, answers);
}
