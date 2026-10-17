import { parseArgs } from "node:util";

export const CLI_USAGE = `usage: swaggerbot <command> [options]
  lookup <name> [--api-version V] [--community] [--fresh]
                      resolve a name to its verified Spec and Provenance,
                      or say why not
  login [--key K]     check a key and store it for this swagger.bot
                      (prompted for it when --key isn't given)
  logout              forget the stored key
  key                 the key in use: its id, credits left, when they reset
  spec <name | apiId | specId> [--form published|normalized]
       [--api-version V] [-o FILE] [--force] [--no-wait]
                      download a Spec: by name (a Lookup, Resolved only),
                      apiId (its Current Spec) or Spec id; to FILE, to
                      stdout on a pipe, else to the file the server names
                      (--force to overwrite it). --no-wait: fail at once
                      while the Normalized Form is being built. --json
                      prints what was written, so it needs -o or a terminal
Options:
  --json              print the answer as the HTTP API gives it
  --key <key>         the API key (or SWAGGERBOT_API_KEY, or the one
                      login stored); needed for Discovery and --fresh
  --url <origin>      another swagger.bot (or SWAGGERBOT_URL);
                      default https://swaggerbot.dev
  --no-color          no colour (or NO_COLOR); never on a pipe anyway
  -V, --version       print the version
  -h, --help          print this
Exit codes: 0 Resolved or success, 3 Ambiguous, 4 Unconfirmed, 5 No Spec,
6 Unknown, 1 refused or failed (no key, quota, unreachable), 2 usage.`;

/** What every command takes, from the flags or the environment. */
export type CliGlobals = {
  /** The swagger.bot origin, no trailing slash. */
  url?: string;
  key?: string;
  json: boolean;
  /** `--no-color` was given. */
  noColor: boolean;
};

/** A `swaggerbot` command, once validated. Issues 4 and 5 add theirs here. */
export type CliCommand =
  | {
      command: "lookup";
      name: string;
      apiVersion?: string;
      community: boolean;
      fresh: boolean;
    }
  | {
      command: "spec";
      /** A name, an apiId (it has a `/`) or a Spec id (64 hex characters). */
      target: SpecTarget;
      form: "published" | "normalized";
      apiVersion?: string;
      /** `-o FILE`. */
      output?: string;
      force: boolean;
      noWait: boolean;
    }
  | { command: "login" }
  | { command: "logout" }
  | { command: "key" }
  | { command: "help" }
  | { command: "version" };

/** What `spec` downloads: a Spec id needs no Lookup, an apiId reads its outline, a name is looked up. */
export type SpecTarget =
  | { kind: "specId"; specId: string }
  | { kind: "apiId"; apiId: string }
  | { kind: "name"; name: string };

export type ParsedCliArgs =
  | { ok: true; command: CliCommand; globals: CliGlobals }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedCliArgs {
  return { ok: false, error, exitCode: 2 };
}

/** The flags that go with some commands only, to refuse them elsewhere. */
const COMMAND_FLAGS: Record<string, string[]> = {
  lookup: ["api-version", "community", "fresh"],
  spec: ["api-version", "form", "output", "force", "no-wait"],
};

/** `-o` is `--output` to `parseArgs`; say it as it was given. */
const FLAG_WORDS: Record<string, string> = { output: "-o" };

/** A Spec id: the lowercase hex sha256 of its Published Form. */
const SPEC_ID = /^[0-9a-f]{64}$/i;

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
    form?: string;
    output?: string;
    force?: boolean;
    "no-wait"?: boolean;
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
        form: { type: "string" },
        output: { type: "string", short: "o" },
        force: { type: "boolean" },
        "no-wait": { type: "boolean" },
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
  const owned = new Set(command ? COMMAND_FLAGS[command] : undefined);
  for (const flag of new Set(Object.values(COMMAND_FLAGS).flat())) {
    if (owned.has(flag) || values[flag as keyof typeof values] === undefined)
      continue;
    const owners = Object.keys(COMMAND_FLAGS).filter((owner) =>
      COMMAND_FLAGS[owner]?.includes(flag),
    );
    return fail(
      `${FLAG_WORDS[flag] ?? `--${flag}`} only goes with ${owners.join(" or ")}`,
    );
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
    case "spec": {
      const [given, ...extra] = rest;
      const arg = given?.trim();
      if (!arg) return fail("spec needs a name, an apiId or a Spec id");
      if (extra.length > 0) return fail(`unexpected argument: ${extra[0]}`);
      const target: SpecTarget = SPEC_ID.test(arg)
        ? { kind: "specId", specId: arg.toLowerCase() }
        : arg.includes("/")
          ? { kind: "apiId", apiId: arg }
          : { kind: "name", name: arg };
      const form = values.form ?? "published";
      if (form !== "published" && form !== "normalized")
        return fail(`--form is published or normalized (got "${form}")`);
      const apiVersion = values["api-version"];
      if (apiVersion !== undefined && !apiVersion.trim())
        return fail("--api-version needs a version");
      if (apiVersion !== undefined && target.kind !== "name")
        return fail(
          target.kind === "specId"
            ? "--api-version goes with a name: a Spec id names one Spec already"
            : "--api-version goes with a name: an apiId gives its Current Spec only",
        );
      if (values.output !== undefined && !values.output.trim())
        return fail("-o needs a file");
      return {
        ok: true,
        command: {
          command,
          target,
          form,
          ...(apiVersion === undefined
            ? {}
            : { apiVersion: apiVersion.trim() }),
          ...(values.output === undefined ? {} : { output: values.output }),
          force: values.force === true,
          noWait: values["no-wait"] === true,
        },
        globals,
      };
    }
    case "login":
    case "logout":
    case "key": {
      if (rest.length > 0) return fail(`unexpected argument: ${rest[0]}`);
      return { ok: true, command: { command }, globals };
    }
    case undefined:
      return fail("no command given");
    default:
      return fail(`unknown command: ${command}`);
  }
}
