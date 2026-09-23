/**
 * Run the Benchmark:
 * `pnpm bench [--only-reviewed] [--json] [--search brave|tavily] [--index <path> | --keep-index] [--concurrency <n>]`.
 * Prints a table with a latency line (or the report as JSON, with each
 * entry's Outcome traced under `answers`, its step `timings` included) and
 * exits 1 when the
 * False Resolution rate is at or above the 2% release gate. `--search` sets
 * `SEARCH_PROVIDER` for this run, so portal finding can be compared.
 *
 * Each run uses a fresh, empty Index in a temporary directory, deleted when
 * the run ends, so the Benchmark measures Discovery rather than Index replay.
 * `--index <path>` uses that Index instead and never deletes it;
 * `--keep-index` keeps the temporary one and prints its path.
 * `--concurrency <n>` runs n Lookups at once (default 4); 1 measures latency
 * without Lookups sharing the fetcher's per-host spacing.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BenchIndex,
  indexLabel,
  latencyLine,
  parseBenchArgs,
  withIndex,
} from "~/benchmark/cli";
import { BenchmarkEntries } from "~/benchmark/entry";
import { type BenchmarkLookup, runBenchmark } from "~/benchmark/run";
import type { BenchmarkReport } from "~/benchmark/score";
import { createAppLookup } from "~/lookup/app";

const FALSE_RESOLUTION_GATE = 0.02;

const parsed = parseBenchArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(parsed.exitCode);
}
const options = parsed.options;
const provider = options.search;
// Set before the Lookup is built, so its WebSearch picks this provider.
if (provider) process.env.SEARCH_PROVIDER = provider;

const tempDir = options.index
  ? undefined
  : await mkdtemp(join(tmpdir(), "swaggerbot-bench-"));
const index: BenchIndex = tempDir
  ? { path: join(tempDir, "index.db"), fresh: true, kept: options.keepIndex }
  : { path: options.index as string, fresh: false, kept: true };

try {
  // Set before the Lookup is built: `openDb` reads it at call time.
  process.env.DATABASE_PATH = index.path;
  // Each answer's `diagnostics` then keep what its Spec step checked and
  // found, so an intermittent failure can be read from the JSON report, and
  // each answer carries its step `timings`.
  process.env.LOOKUP_TRACE = "1";
  const appLookup = createAppLookup();
  const lookup: BenchmarkLookup = (name) => appLookup({ name });

  const path = new URL("../benchmark/entries.json", import.meta.url);
  const entries = BenchmarkEntries.parse(
    JSON.parse(await readFile(path, "utf8")),
  );

  const report = withIndex(
    await runBenchmark({
      lookup,
      entries,
      onlyReviewed: options.onlyReviewed,
      concurrency: options.concurrency,
    }),
    index,
  );

  console.log(options.json ? JSON.stringify(report, null, 2) : table(report));
  process.exitCode =
    report.falseResolutionRate >= FALSE_RESOLUTION_GATE ? 1 : 0;
} finally {
  // Deleting the directory takes the `-wal` and `-shm` files with it.
  if (tempDir && !options.keepIndex) {
    await rm(tempDir, { recursive: true, force: true });
  }
  if (tempDir && options.keepIndex) {
    console.error(`Index kept at ${index.path}`);
  }
}

function table(r: BenchmarkReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const gate = r.falseResolutionRate >= FALSE_RESOLUTION_GATE ? "FAIL" : "ok";
  const lines = [
    `Benchmark: ${r.entries} entries${options.onlyReviewed ? " (reviewed only)" : ""}${provider ? `, search: ${provider}` : ""}`,
    indexLabel(index),
    latencyLine(r),
    "",
    `False Resolution rate  ${pct(r.falseResolutionRate).padStart(6)}  (${r.falseResolutions}/${r.resolved} Resolved, gate < ${pct(FALSE_RESOLUTION_GATE)}: ${gate})`,
    `Long-tail coverage     ${pct(r.longtailCoverage).padStart(6)}`,
    `Outcome accuracy       ${pct(r.outcomeAccuracy).padStart(6)}`,
    "",
    "group       entries  correct  resolved  false",
  ];
  for (const [group, c] of Object.entries(r.groups)) {
    lines.push(
      `${group.padEnd(10)}  ${String(c.entries).padStart(7)}  ${String(c.correctOutcome).padStart(7)}  ${String(c.resolved).padStart(8)}  ${String(c.falseResolutions).padStart(5)}`,
    );
  }
  if (r.failures.length > 0) {
    lines.push("", "Failures:");
    for (const f of r.failures) {
      lines.push(`  ${f.name}: ${f.why}`);
    }
  }
  if (r.errors.length > 0) {
    lines.push("", "Errors:");
    for (const e of r.errors) lines.push(`  ${e.name}: ${e.message}`);
  }
  return lines.join("\n");
}
