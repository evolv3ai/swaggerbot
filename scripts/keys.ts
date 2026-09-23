// Issues, lists and revokes API keys in the Index at DATABASE_PATH (default
// ./data/swaggerbot.db). A key's secret is printed once, when it is created;
// only its hash is stored.
// Usage: pnpm tsx scripts/keys.ts create <owner> [--quota N] | list | revoke <id>
// Built into .output/cli/keys.mjs by `pnpm build` (vite.cli.config.ts) for the production image.
import { openDb } from "../src/index-store/db";
import { createKeys, dailyQuotaOf, utcDay } from "../src/index-store/keys";
import { KEYS_USAGE, parseKeysArgs } from "../src/index-store/keys-cli";

for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Not there: rely on the environment.
  }
}

const parsed = parseKeysArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n${KEYS_USAGE}`);
  process.exit(parsed.exitCode);
}

const db = openDb();
const keys = createKeys(db);
let exitCode = 0;
try {
  const options = parsed.options;
  if (options.command === "create") {
    const { id, secret } = keys.createKey(options.owner, options.quota);
    console.log(`id:     ${id}`);
    console.log(`secret: ${secret}`);
    console.log(
      "The secret isn't stored and can't be shown again: give it to its owner now.",
    );
  } else if (options.command === "list") {
    const day = utcDay();
    const rows = keys.listKeys(day);
    if (rows.length === 0) console.log("No API keys.");
    else {
      const header = [
        "id",
        "owner",
        "quota",
        "created",
        "revoked",
        `used ${day}`,
      ];
      const table = [
        header,
        ...rows.map((k) => [
          k.id,
          k.owner,
          k.dailyQuota === null
            ? `${dailyQuotaOf(k)} (default)`
            : `${k.dailyQuota}`,
          k.createdAt,
          k.revokedAt ?? "-",
          `${k.used}`,
        ]),
      ];
      const widths = header.map((_, i) =>
        Math.max(...table.map((row) => row[i]?.length ?? 0)),
      );
      for (const row of table)
        console.log(
          row
            .map((cell, i) => cell.padEnd(widths[i] ?? 0))
            .join("  ")
            .trimEnd(),
        );
    }
  } else if (keys.revokeKey(options.id)) {
    console.log(`Revoked ${options.id}.`);
  } else {
    console.error(`No live key ${options.id} (unknown, or already revoked).`);
    exitCode = 1;
  }
} finally {
  db.$client.close();
}
process.exit(exitCode);
