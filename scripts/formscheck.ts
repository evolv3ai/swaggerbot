/**
 * Check the Spec forms and the navigation on a deployment:
 * `pnpm tsx scripts/formscheck.ts <baseUrl> [--names GitHub,Stripe,Cloudflare] [--json]`
 * (env `LOADCHECK_KEY`, when set, is each Lookup's bearer). For each name it
 * downloads both forms, GETs the outline, 5 operations and the Vendor's
 * APIs, and prints the numbers with PASS/FAIL (outline p90 < 500 ms,
 * operation p90 < 2 s, downloads within 60 s), or the whole report as JSON;
 * exits 1 when a check fails, 2 on bad arguments. See `--help`.
 */
import {
  FORMSCHECK_USAGE,
  formscheckLines,
  parseFormscheckArgs,
  runFormscheck,
} from "~/benchmark/formscheck";

const parsed = parseFormscheckArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${FORMSCHECK_USAGE}`);
  process.exit(parsed.exitCode);
}
if (parsed.help) {
  console.log(FORMSCHECK_USAGE);
  process.exit(0);
}
const options = parsed.options;

const report = await runFormscheck(options);
console.log(
  options.json
    ? JSON.stringify(report, null, 2)
    : formscheckLines(report).join("\n"),
);
process.exitCode = report.pass ? 0 : 1;
