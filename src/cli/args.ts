import { parseArgs } from "node:util";

export const CLI_USAGE = `usage: swaggerbot <command> [options]
  lookup <name> [--api-version V] [--community] [--fresh]
                      resolve a name to its verified Spec and Provenance,
                      or say why not
Options:
  --json              print the answer as the HTTP API gives it
  --key <key>         the API key (or SWAGGERBOT_API_KEY); needed for
                      Discovery and --fresh
  --url <origin>      another swagger.bot (or SWAGGERBOT_URL);
                      default https://swaggerbot.dev
  --no-color          no colour (or NO_COLOR); never on a pipe anyway
  -V, --version       print the version
  -h, --help          print this
Exit codes: 0 Resolved, 1 any other Outcome, 2 usage, 3 the request failed.`;

/** What every command takes, from the flags or the environment. */
export type CliGlobals = {
  /** The swagger.bot origin, no trailing slash. */
  url?: string;
  key?: string;
  json: boolean;
  /** `--no-color` was given. */
  noColor: boolean;
};

/** A `swaggerbot` command, once validated. Issues 2 to 5 add theirs here. */
export type CliCommand =
  | {
      command: "lookup";
      name: string;
      apiVersion?: string;
      community: boolean;
      fresh: boolean;
    }
  | { command: "help" }
  | { command: "version" };

export type ParsedCliArgs =
  | { ok: true; command: CliCommand; globals: CliGlobals }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedCliArgs {
  return { ok: false, error, exitCode: 2 };
}

/** The flags that go with one command only, to refuse them elsewhere. */
const COMMAND_FLAGS: Record<string, string[]> = {
  lookup: ["api-version", "community", "fresh"],
};

/** Parses and validates `swaggerbot`'s arguments without running anything. */
export function parseCliArgs(args: string[]): ParsedCliArgs {
  let values: {
    json?: boolean;
    key?: string;
    url?: string;
    "no-color"?: boolean;
    version?: boolean;
    help?: boolean;
    "api-version"?: string;
    community?: boolean;
    fresh?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        key: { type: "string" },
        url: { type: "string" },
        "no-color": { type: "boolean" },
        version: { type: "boolean", short: "V" },
        help: { type: "boolean", short: "h" },
        "api-version": { type: "string" },
        community: { type: "boolean" },
        fresh: { type: "boolean" },
      },
    }));
  } catch (err) {
    return fail((err as Error).message);
  }

  const globals: CliGlobals = {
    json: values.json === true,
    noColor: values["no-color"] === true,
  };
  if (values.key !== undefined) {
    if (!values.key.trim()) return fail("--key needs a key");
    globals.key = values.key.trim();
  }
  if (values.url !== undefined) {
    const url = values.url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/\S+$/.test(url))
      return fail(`--url must be an http(s) origin (got "${values.url}")`);
    globals.url = url;
  }

  if (values.version)
    return { ok: true, command: { command: "version" }, globals };
  if (values.help) return { ok: true, command: { command: "help" }, globals };

  const [command, ...rest] = positionals;
  for (const [owner, flags] of Object.entries(COMMAND_FLAGS)) {
    if (owner === command) continue;
    const used = flags.find(
      (flag) => values[flag as keyof typeof values] !== undefined,
    );
    if (used) return fail(`--${used} only goes with ${owner}`);
  }

  switch (command) {
    case "lookup": {
      const [name, ...extra] = rest;
      if (!name?.trim()) return fail("lookup needs a name");
      if (extra.length > 0) return fail(`unexpected argument: ${extra[0]}`);
      if (values["api-version"] !== undefined && !values["api-version"].trim())
        return fail("--api-version needs a version");
      return {
        ok: true,
        command: {
          command,
          name: name.trim(),
          ...(values["api-version"] === undefined
            ? {}
            : { apiVersion: values["api-version"].trim() }),
          community: values.community === true,
          fresh: values.fresh === true,
        },
        globals,
      };
    }
    case undefined:
      return fail("no command given");
    default:
      return fail(`unknown command: ${command}`);
  }
}
