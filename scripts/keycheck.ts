/**
 * Check API keys on a deployment:
 * `KEYCHECK_KEY=sb_… pnpm tsx scripts/keycheck.ts <baseUrl> [--name "Val Town"] [--json]`
 * (env `UNKEY_ROOT_KEY`, when set, reads the key's credits through Unkey's
 * admin API). A keyless Index Lookup is 200; the same with the key is 200
 * and spends no credit; a Discovery (`fresh`) with the key is 200 and
 * spends one; a made-up `sb_` key is 401. Prints each Lookup with
 * PASS/FAIL, or the whole report as JSON; exits 1 when a check fails, 2 on
 * bad arguments. See `--help`.
 */
import { Unkey } from "@unkey/api";
import {
  KEYCHECK_USAGE,
  keycheckLines,
  parseKeycheckArgs,
  runKeycheck,
} from "~/benchmark/keycheck";

const parsed = parseKeycheckArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${KEYCHECK_USAGE}`);
  process.exit(parsed.exitCode);
}
if (parsed.help) {
  console.log(KEYCHECK_USAGE);
  process.exit(0);
}
const options = parsed.options;

const unkey = options.rootKey
  ? new Unkey({ rootKey: options.rootKey, retryConfig: { strategy: "none" } })
  : undefined;
const report = await runKeycheck(options, {
  readCredits: unkey
    ? async () => {
        const { data } = await unkey.keys.whoami({ key: options.key });
        return data.credits?.remaining ?? null;
      }
    : undefined,
});
console.log(
  options.json
    ? JSON.stringify(report, null, 2)
    : keycheckLines(report).join("\n"),
);
process.exitCode = report.pass ? 0 : 1;
