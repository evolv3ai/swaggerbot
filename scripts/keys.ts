// Issues, lists and revokes API keys in the configured key store: Unkey when
// UNKEY_ROOT_KEY and UNKEY_API_ID are set, else the Index at DATABASE_PATH
// (default ./data/swaggerbot.db). A key's secret is printed once, when it is
// created; neither store keeps it. `migrate` moves the Index's live keys into
// Unkey with their secrets unchanged (UNKEY_MIGRATION_ID, D8).
// Usage: pnpm tsx scripts/keys.ts create <owner> [--quota N] | list | revoke <id> | migrate
// Built into .output/cli/keys.mjs by `pnpm build` (vite.cli.config.ts) for the production image.
import { openDb } from "../src/index-store/db";
import { unkeyConfigOf } from "../src/index-store/key-store";
import { createKeys, dailyQuotaOf, utcDay } from "../src/index-store/keys";
import { KEYS_USAGE, parseKeysArgs } from "../src/index-store/keys-cli";
import {
  createUnkeyClient,
  createUnkeyKeys,
  migrateLocalKeys,
  operatorExternalId,
} from "../src/index-store/unkey-keys";

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

/** Prints rows as columns under `header`. */
function printTable(header: string[], rows: string[][]): void {
  const table = [header, ...rows];
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

function printSecret({ id, secret }: { id: string; secret: string }): void {
  console.log(`id:     ${id}`);
  console.log(`secret: ${secret}`);
  console.log(
    "The secret isn't stored and can't be shown again: give it to its owner now.",
  );
}

const options = parsed.options;
const unkey = unkeyConfigOf(process.env);
let exitCode = 0;

if (options.command === "migrate") {
  const migrationId = process.env.UNKEY_MIGRATION_ID?.trim();
  if (!unkey || !migrationId) {
    console.error(
      "migrate needs UNKEY_ROOT_KEY, UNKEY_API_ID and UNKEY_MIGRATION_ID.",
    );
    process.exit(2);
  }
  const db = openDb();
  try {
    const live = createKeys(db).liveKeysToMigrate();
    const { migrated, failed } = await migrateLocalKeys(
      createUnkeyClient(unkey.rootKey),
      { apiId: unkey.apiId, migrationId },
      live,
    );
    console.log(
      `Moved ${migrated.length} of ${live.length} live key${live.length === 1 ? "" : "s"} into Unkey.`,
    );
    if (failed.length > 0) {
      console.error(`Couldn't move: ${failed.join(", ")}`);
      exitCode = 1;
    }
  } finally {
    db.$client.close();
  }
} else if (unkey) {
  console.error(`keys: unkey (${unkey.apiId})`);
  const keys = createUnkeyKeys({
    client: createUnkeyClient(unkey.rootKey),
    apiId: unkey.apiId,
  });
  if (options.command === "create") {
    printSecret(
      await keys.create(operatorExternalId(options.owner), options.quota),
    );
  } else if (options.command === "list") {
    const rows = await keys.listKeys();
    if (rows.length === 0) console.log("No API keys.");
    else
      printTable(
        ["id", "owner", "start", "created", "credits left", "daily"],
        rows.map((k) => [
          k.id,
          k.owner ?? "-",
          k.start,
          k.createdAt,
          k.remaining === undefined ? "unlimited" : `${k.remaining}`,
          k.limit === undefined ? "-" : `${k.limit}`,
        ]),
      );
  } else if (await keys.revoke(options.id)) {
    console.log(`Revoked ${options.id}.`);
  } else {
    console.error(`No live key ${options.id}.`);
    exitCode = 1;
  }
} else {
  console.error("keys: local");
  const db = openDb();
  const keys = createKeys(db);
  try {
    if (options.command === "create") {
      printSecret(keys.createKey(options.owner, options.quota));
    } else if (options.command === "list") {
      const day = utcDay();
      const rows = keys.listKeys(day);
      if (rows.length === 0) console.log("No API keys.");
      else
        printTable(
          ["id", "owner", "quota", "created", "revoked", `used ${day}`],
          rows.map((k) => [
            k.id,
            k.owner,
            k.dailyQuota === null
              ? `${dailyQuotaOf(k)} (default)`
              : `${k.dailyQuota}`,
            k.createdAt,
            k.revokedAt ?? "-",
            `${k.used}`,
          ]),
        );
    } else if (keys.revokeKey(options.id)) {
      console.log(`Revoked ${options.id}.`);
    } else {
      console.error(`No live key ${options.id} (unknown, or already revoked).`);
      exitCode = 1;
    }
  } finally {
    db.$client.close();
  }
}
process.exit(exitCode);
