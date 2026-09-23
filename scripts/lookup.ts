// Live Lookup for one or more names, printing the outcome, Current Spec,
// Alternates, Sources, Candidates and diagnostics. The operator's check for a
// PR's "live check" (needs the keys in .env and .env.local). Runs on a fresh,
// temporary Index, or with --index on the Index at <path>, created if missing
// and never deleted, so a second run is answered from it. LOOKUP_FULL=1 also
// prints the whole Outcome.
// Usage: pnpm tsx scripts/lookup.ts [--index <path>] "GitHub REST API" ["Slack Web API" ...]
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppLookup } from "../src/lookup/app";

for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Not there: rely on the environment.
  }
}

const args = process.argv.slice(2);
let indexPath: string | undefined;
const at = args.indexOf("--index");
if (at !== -1) [, indexPath] = args.splice(at, 2);
const names = args;
if (names.length === 0 || (at !== -1 && !indexPath)) {
  console.error(
    'usage: pnpm tsx scripts/lookup.ts [--index <path>] "API name" ...',
  );
  process.exit(2);
}

const lookup = createAppLookup({
  ...process.env,
  DATABASE_PATH:
    indexPath ??
    join(await mkdtemp(join(tmpdir(), "swaggerbot-lookup-")), "index.db"),
});

for (const name of names) {
  const r = await lookup({ name });
  let line = `=== ${name}: ${r.outcome}`;
  if (r.outcome === "Resolved") {
    const alts = r.alternateSpecs.map((s) => s.apiVersion ?? "-");
    line += `  api=${r.api.id}  current=${r.currentSpec.apiVersion ?? "-"}  alts=[${alts.join(", ")}]`;
    console.log(line);
    console.log(`    sources: ${r.sources.map((s) => s.url).join(" | ")}`);
  } else if (r.outcome === "Ambiguous") {
    console.log(line);
    const cands = r.candidates.map(
      (c) => `${c.apiId} ${c.probability.toFixed(2)}`,
    );
    console.log(`    candidates: ${cands.join(" | ")}`);
  } else if (r.outcome === "Unconfirmed") {
    console.log(`${line}  api=${r.api.id}`);
    console.log(`    sources: ${r.sources.map((s) => s.url).join(" | ")}`);
    console.log(`    reasons: ${r.reasons.join(" || ")}`);
  } else if (r.outcome === "NoSpec") {
    console.log(`${line}  api=${r.api.id}`);
  } else {
    console.log(line);
  }
  if (r.diagnostics?.length)
    console.log(`    diagnostics: ${r.diagnostics.join(" || ")}`);
  if (process.env.LOOKUP_FULL) console.log(JSON.stringify(r, null, 1));
}
