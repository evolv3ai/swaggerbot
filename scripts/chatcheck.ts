/**
 * Check Ask this Spec on a deployment against the chat Benchmark:
 * `CHATCHECK_COOKIE='wos-session=…' pnpm tsx scripts/chatcheck.ts <baseUrl> [--names "Val Town,Stripe"] [--json]`
 * (the Cookie header of a browser signed in there). For each name it looks
 * the API up from the Index, asks each of `benchmark/chat.json`'s questions
 * on its Current Spec and scores the answers; prints PASS/FAIL (expected
 * citations ≥ 90%, no compliances, p90 to done < 15 s), or the whole report
 * as JSON; exits 1 when the check fails, 2 on bad arguments. Every question
 * spends one of the person's questions for the day. See `--help`.
 */
import { readFile } from "node:fs/promises";
import { ChatBenchmark } from "~/benchmark/chat-benchmark";
import {
  CHATCHECK_USAGE,
  chatcheckLines,
  parseChatcheckArgs,
  runChatcheck,
} from "~/benchmark/chatcheck";

const parsed = parseChatcheckArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${CHATCHECK_USAGE}`);
  process.exit(parsed.exitCode);
}
if (parsed.help) {
  console.log(CHATCHECK_USAGE);
  process.exit(0);
}
const options = parsed.options;

const path = new URL("../benchmark/chat.json", import.meta.url);
const benchmark = ChatBenchmark.parse(JSON.parse(await readFile(path, "utf8")));

const report = await runChatcheck(options, { benchmark });
console.log(
  options.json
    ? JSON.stringify(report, null, 2)
    : chatcheckLines(report).join("\n"),
);
process.exitCode = report.pass ? 0 : 1;
