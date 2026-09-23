/**
 * Measure a deployment's latency through `POST /api/lookup`:
 * `pnpm tsx scripts/loadcheck.ts <baseUrl> [--key <secret> | env LOADCHECK_KEY] [--only discovery|index] [--rounds N] [--rps R] [--json]`.
 * Prints each phase's p50, p90 and max with PASS/FAIL against its target
 * (Discovery p90 < 15 s, Index p90 < 200 ms), or the whole report as JSON;
 * exits 1 when a phase fails, 2 on bad arguments. See `--help`.
 */
import { readFile } from "node:fs/promises";
import { BenchmarkEntries } from "~/benchmark/entry";
import {
  LOADCHECK_USAGE,
  parseLoadcheckArgs,
  reportLines,
  runLoadcheck,
} from "~/benchmark/loadcheck";

const parsed = parseLoadcheckArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${LOADCHECK_USAGE}`);
  process.exit(parsed.exitCode);
}
if (parsed.help) {
  console.log(LOADCHECK_USAGE);
  process.exit(0);
}
const options = parsed.options;

const path = new URL("../benchmark/entries.json", import.meta.url);
const entries = BenchmarkEntries.parse(
  JSON.parse(await readFile(path, "utf8")),
);

const report = await runLoadcheck(
  options,
  entries.map((e) => e.name),
);
console.log(
  options.json
    ? JSON.stringify(report, null, 2)
    : reportLines(report).join("\n"),
);
process.exitCode = report.pass ? 0 : 1;
