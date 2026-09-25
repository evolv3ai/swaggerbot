/**
 * Check the Web UI for WCAG AA and keyboard use:
 * `pnpm tsx scripts/uicheck.ts <baseUrl> [--routes /,/docs] [--json] [--out uicheck-out]`.
 * For each route, at 390 and 1280 wide, light and dark, in headless
 * Chromium: axe-core (WCAG 2.2 AA tags), a Tab walk through the page (every
 * interactive element reached, no trap, a visible focus indicator) and the
 * console (no CSP violation). Saves a screenshot of each run under `--out`.
 * Prints each run with PASS/FAIL, or the whole report as JSON; exits 1 when
 * a check fails, 2 on bad arguments. See `--help`.
 */
import {
  parseUicheckArgs,
  runUicheck,
  UICHECK_USAGE,
  uicheckLines,
} from "~/benchmark/uicheck";

const parsed = parseUicheckArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${UICHECK_USAGE}`);
  process.exit(parsed.exitCode);
}
if (parsed.help) {
  console.log(UICHECK_USAGE);
  process.exit(0);
}
const options = parsed.options;

const report = await runUicheck(options);
console.log(
  options.json
    ? JSON.stringify(report, null, 2)
    : uicheckLines(report).join("\n"),
);
process.exitCode = report.pass ? 0 : 1;
