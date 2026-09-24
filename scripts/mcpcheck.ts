/**
 * Check the MCP server on a deployment:
 * `pnpm tsx scripts/mcpcheck.ts <baseUrl> [--names Stripe,GitHub REST API,Cloudflare] [--json]`
 * (env `LOADCHECK_KEY`, when set, is the bearer). Connects to `<baseUrl>/mcp`
 * with the MCP SDK's HTTP client, lists the tools, and for each name calls
 * `lookup_api`, `get_spec_outline` (unfiltered, then with a query from its
 * first page), `get_operation` on 3 operations and `get_schema` on one
 * reference they left. Prints each call's time and result size with
 * PASS/FAIL (every result < 30 kB, every call ≤ 2 s), or the whole report
 * as JSON; exits 1 when a check fails, 2 on bad arguments. See `--help`.
 */
import {
  MCPCHECK_USAGE,
  mcpcheckLines,
  parseMcpcheckArgs,
  runMcpcheck,
} from "~/benchmark/mcpcheck";

const parsed = parseMcpcheckArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${MCPCHECK_USAGE}`);
  process.exit(parsed.exitCode);
}
if (parsed.help) {
  console.log(MCPCHECK_USAGE);
  process.exit(0);
}
const options = parsed.options;

const report = await runMcpcheck(options);
console.log(
  options.json
    ? JSON.stringify(report, null, 2)
    : mcpcheckLines(report).join("\n"),
);
process.exitCode = report.pass ? 0 : 1;
