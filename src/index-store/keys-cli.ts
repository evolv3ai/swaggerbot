import { parseArgs } from "node:util";

export const KEYS_USAGE = `usage: pnpm tsx scripts/keys.ts <command>   (built: node .output/cli/keys.mjs <command>)
  create <owner> [--quota N]   issue a key; prints its id and secret once
  list                         every key, with today's (UTC) usage
  revoke <id>                  revoke a key`;

/** A `scripts/keys.ts` command, once validated. */
export type KeysCommand =
  | { command: "create"; owner: string; quota?: number }
  | { command: "list" }
  | { command: "revoke"; id: string };

export type ParsedKeysArgs =
  | { ok: true; options: KeysCommand }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedKeysArgs {
  return { ok: false, error, exitCode: 2 };
}

/** Parses and validates the `scripts/keys.ts` arguments without running anything. */
export function parseKeysArgs(args: string[]): ParsedKeysArgs {
  let values: { quota?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { quota: { type: "string" } },
    }));
  } catch (err) {
    return fail((err as Error).message);
  }

  const [command, ...rest] = positionals;
  if (command !== "create" && values.quota !== undefined)
    return fail("--quota only goes with create");

  switch (command) {
    case "create": {
      const [owner, ...extra] = rest;
      if (!owner?.trim()) return fail("create needs an owner");
      if (extra.length > 0) return fail(`unexpected argument: ${extra[0]}`);
      if (values.quota === undefined)
        return { ok: true, options: { command, owner: owner.trim() } };
      const quota = /^\d+$/.test(values.quota)
        ? Number(values.quota)
        : Number.NaN;
      if (!Number.isSafeInteger(quota) || quota < 1)
        return fail(
          `--quota must be a positive integer (got "${values.quota}")`,
        );
      return { ok: true, options: { command, owner: owner.trim(), quota } };
    }
    case "list":
      if (rest.length > 0) return fail(`unexpected argument: ${rest[0]}`);
      return { ok: true, options: { command } };
    case "revoke": {
      const [id, ...extra] = rest;
      if (!id) return fail("revoke needs a key id");
      if (extra.length > 0) return fail(`unexpected argument: ${extra[0]}`);
      return { ok: true, options: { command, id } };
    }
    case undefined:
      return fail("no command given");
    default:
      return fail(`unknown command: ${command}`);
  }
}
