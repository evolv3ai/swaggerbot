/**
 * What the site and the README say about the `swaggerbot` CLI: how to run
 * it, how to sign in, and one example per command. `/docs`, the answer
 * card, the not-in-the-Index view, `/keys` and `/` all read it from here.
 * Each example names the HTTP API example (`EXAMPLES` in `./reference`)
 * of the route it calls first, and `src/cli/`'s tests run it against that
 * recorded answer, so the CLI section can't drift from the routes above it.
 */

/** Run it without installing; `npm install -g swaggerbot` keeps it. */
export const CLI_INSTALL = `npx swaggerbot lookup "Val Town"`;
export const CLI_INSTALL_GLOBAL = "npm install -g swaggerbot";

/** Stores a key for later commands: asked for hidden, never put on the line. */
export const CLI_LOGIN = "swaggerbot login";

/** The Node the CLI needs (`cli/package.json`'s `engines`). */
export const CLI_NODE = "Node 20 or later";

/** One command of the CLI, as `/docs` lists it. */
export type CliCommandRow = {
  command: string;
  /** Its arguments and own flags, as `swaggerbot --help` gives them. */
  usage: string;
  gives: string;
  /** A whole command line, to copy. */
  example: string;
  /** The `EXAMPLES` id of the route the example calls first; none for a command that calls none. */
  calls?: string;
};

/** Every command, in `swaggerbot --help`'s order. */
export const CLI_COMMANDS: CliCommandRow[] = [
  {
    command: "lookup",
    usage: "<name> [--api-version V] [--community] [--fresh]",
    gives:
      "The Outcome in one line: the API, its Spec's URL and Provenance, or why there is none.",
    example: `swaggerbot lookup "Val Town"`,
    calls: "lookup",
  },
  {
    command: "login",
    usage: "[--key K]",
    gives:
      "Checks a key at no cost to its credits and stores it for this swagger.bot; asked for, hidden, when `--key` isn't given.",
    example: CLI_LOGIN,
    calls: "key",
  },
  {
    command: "logout",
    usage: "",
    gives: "Forgets the stored key.",
    example: "swaggerbot logout",
  },
  {
    command: "key",
    usage: "",
    gives: "The key in use: its id, credits left today, when they reset.",
    example: "swaggerbot key",
    calls: "key",
  },
  {
    command: "spec",
    usage:
      "<name | apiId | specId> [--form published|normalized] [-o FILE] [--force] [--no-wait]",
    gives:
      "Downloads the Spec, by name (a Lookup, Resolved only), API id or Spec id, and checks its sha256 is its Spec id.",
    example: `swaggerbot spec "Val Town" -o openapi.json`,
    calls: "lookup",
  },
  {
    command: "outline",
    usage: "<name | apiId> [--tag T] [--query Q] [--limit N] [--all]",
    gives:
      "The Spec Outline: title, servers, security schemes, tags, then the operations, filtered by tag or a word.",
    example: "swaggerbot outline val.town/api --tag me",
    calls: "outline",
  },
  {
    command: "operation",
    usage: "<name | apiId> <method> <path>",
    gives: "One operation, every reference inlined, as JSON.",
    example: "swaggerbot operation val.town/api delete /v1/blob/{key}",
    calls: "operation",
  },
  {
    command: "schema",
    usage: "<name | apiId> <schemaName>",
    gives: "One component schema, as JSON.",
    example: "swaggerbot schema val.town/api PaginationLinks",
    calls: "schema",
  },
  {
    command: "vendors",
    usage: "[<query>] [--all]",
    gives: "The Vendors in the Index, 50 a page: id, name and API count.",
    example: "swaggerbot vendors val",
    calls: "vendors",
  },
  {
    command: "vendor",
    usage: "<vendor>",
    gives:
      "A Vendor's APIs in the Index, each with its Current Spec, Provenance and download URLs.",
    example: "swaggerbot vendor val.town",
    calls: "vendor-apis",
  },
];

/** One exit code and when the CLI gives it. */
export type CliExitRow = { code: number; means: string };

/** The exit codes, the same with `--json`. */
export const CLI_EXIT_CODES: CliExitRow[] = [
  { code: 0, means: "Resolved, or the command did what it was asked." },
  { code: 3, means: "Ambiguous." },
  { code: 4, means: "Unconfirmed." },
  { code: 5, means: "No Spec." },
  { code: 6, means: "Unknown." },
  {
    code: 1,
    means:
      "Refused or failed: no key, the quota used, the service unreachable, a download that isn't its Spec.",
  },
  { code: 2, means: "A usage error." },
];

/** `swaggerbot lookup` for a Lookup's name (and options), quoted for a shell; `--url` when `baseUrl` isn't the default. */
export function cliLookup(
  request: { name: string; apiVersion?: string; allowCommunity?: boolean },
  baseUrl: string,
  defaultUrl: string,
): string {
  return [
    "swaggerbot lookup",
    shellWord(request.name),
    request.apiVersion ? `--api-version ${shellWord(request.apiVersion)}` : "",
    request.allowCommunity ? "--community" : "",
    baseUrl === defaultUrl ? "" : `--url ${baseUrl}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** `text` as one shell word: as is when it is safe bare, else in double quotes (or single, when it holds `$`, `` ` ``, `"` or `\`). */
function shellWord(text: string): string {
  if (/^[\w./:@%+-]+$/.test(text)) return text;
  if (!/[$`"\\!]/.test(text)) return `"${text}"`;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
