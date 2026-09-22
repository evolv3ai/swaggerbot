/**
 * Run the Benchmark: `pnpm bench [--only-reviewed] [--json] [--search brave|tavily]`.
 * Prints a table (or the report as JSON) and exits 1 when the
 * False Resolution rate is at or above the 2% release gate. `--search` sets
 * `SEARCH_PROVIDER` for this run, so portal finding can be compared.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BenchmarkEntries } from "~/benchmark/entry";
import { type BenchmarkLookup, runBenchmark } from "~/benchmark/run";
import type { BenchmarkReport } from "~/benchmark/score";
import { SEARCH_PROVIDERS } from "~/sources/web-search";

const FALSE_RESOLUTION_GATE = 0.02;

const { values } = parseArgs({
  options: {
    "only-reviewed": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    search: { type: "string" },
  },
});

const provider = values.search;
if (
  provider !== undefined &&
  !(SEARCH_PROVIDERS as readonly string[]).includes(provider)
) {
  console.error(
    `--search must be one of: ${SEARCH_PROVIDERS.join(", ")} (got "${provider}")`,
  );
  process.exit(2);
}
// Set before the Lookup is built, so its WebSearch picks this provider.
if (provider) process.env.SEARCH_PROVIDER = provider;

// ---------------------------------------------------------------------------
// WTR-32 plugs in here: replace this stub with the real Lookup from
// `createAppLookup()` in `src/lookup/app.ts`. Until then every name is Unknown.
const lookup: BenchmarkLookup = async (name) => ({ outcome: "Unknown", name });
// ---------------------------------------------------------------------------

const path = new URL("../benchmark/entries.json", import.meta.url);
const entries = BenchmarkEntries.parse(
  JSON.parse(await readFile(path, "utf8")),
);

const report = await runBenchmark({
  lookup,
  entries,
  onlyReviewed: values["only-reviewed"],
});

console.log(values.json ? JSON.stringify(report, null, 2) : table(report));
process.exitCode = report.falseResolutionRate >= FALSE_RESOLUTION_GATE ? 1 : 0;

function table(r: BenchmarkReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const gate = r.falseResolutionRate >= FALSE_RESOLUTION_GATE ? "FAIL" : "ok";
  const lines = [
    `Benchmark: ${r.entries} entries${values["only-reviewed"] ? " (reviewed only)" : ""}${provider ? `, search: ${provider}` : ""}`,
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
