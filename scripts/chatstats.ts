// Prints Ask this Spec's turns from the Index at DATABASE_PATH (default
// ./data/swaggerbot.db): turns, distinct people, tokens by kind, refusals,
// errors and an estimated cost from the price table in
// src/index-store/chatstats-cli.ts.
// Usage: pnpm tsx scripts/chatstats.ts [--since YYYY-MM-DD] [--json]
// Built into .output/cli/chatstats.mjs by `pnpm build` (vite.cli.config.ts) for the production image.
import { createChatStore } from "../src/index-store/chat";
import {
  CHATSTATS_USAGE,
  chatReportOf,
  formatChatReport,
  parseChatstatsArgs,
} from "../src/index-store/chatstats-cli";
import { openDb } from "../src/index-store/db";

for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Not there: rely on the environment.
  }
}

const parsed = parseChatstatsArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n${CHATSTATS_USAGE}`);
  process.exit(parsed.exitCode);
}

const { since, json } = parsed.options;
const db = openDb();
try {
  const report = chatReportOf(createChatStore(db).stats({ since }), since);
  console.log(
    json ? JSON.stringify(report, null, 2) : formatChatReport(report),
  );
} finally {
  db.$client.close();
}
