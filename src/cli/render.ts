import type { Api, Vendor } from "../domain/catalog";
import type { Outcome, SpecAnswer } from "../domain/outcome";
import type { Provenance } from "../domain/provenance";
import type { SpecOutline } from "../domain/spec-forms";
import { type CliHttpError, durationWords } from "./http";

/** Where a command reads and writes, and what it may assume about the terminal. */
export type Io = {
  /** Text, and the bytes `spec` downloads; `once("drain")` when a write says to wait. */
  stdout: {
    write(chunk: string | Uint8Array): unknown;
    once?(event: "drain", listener: () => void): unknown;
  };
  stderr: { write(text: string): unknown };
  /** Where `login` reads a key it wasn't given: the terminal, hidden, or a pipe. None when there is no stdin to read. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Whether stdout, and separately stderr, is a terminal: colour is only ever used on one. */
  isTTY: boolean;
  stderrIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  /** The clock, for "in 5 h"; now unless a test says otherwise. */
  now?: () => Date;
  /** Waits `ms`, as `spec` does while a Normalized Form is built; a timer unless a test says otherwise. */
  sleep?: (ms: number) => Promise<void>;
  /** Where `spec` writes the file the server names; the process's unless a test says otherwise. */
  cwd?: string;
};

/**
 * Whether to colour a stream's output: only when it is a terminal, and never
 * with `--no-color` or `NO_COLOR` set in the environment (https://no-color.org).
 */
export function colorEnabled(
  isTTY: boolean,
  env: NodeJS.ProcessEnv,
  noColor: boolean,
): boolean {
  if (noColor) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return isTTY;
}

type Paint = (text: string) => string;

/** The few ANSI colours the views use; identity when colour is off. */
export function palette(color: boolean): {
  green: Paint;
  yellow: Paint;
  red: Paint;
  dim: Paint;
  bold: Paint;
} {
  const wrap =
    (open: number, close: number): Paint =>
    (text) =>
      color ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    red: wrap(31, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

/** The Outcome as a person reads it: `No Spec`, not `NoSpec`. */
export function outcomeWords(outcome: Outcome["outcome"]): string {
  return outcome === "NoSpec" ? "No Spec" : outcome;
}

/**
 * The CLI's exit codes (D4), the one mapping every command uses: 0 for
 * Resolved or success, one code per other Outcome, 1 for a refusal or a
 * failed request (401, 429, 503, no answer), 2 for a usage error. `--json`
 * exits the same.
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  Ambiguous: 3,
  Unconfirmed: 4,
  NoSpec: 5,
  Unknown: 6,
} as const;

/** The exit code an Outcome earns: 0 for Resolved, 3 to 6 for the others. */
export function outcomeExitCode(outcome: Outcome): number {
  return outcome.outcome === "Resolved" ? EXIT.ok : EXIT[outcome.outcome];
}

/**
 * A download URL as the server gives it, made absolute: the server gives a
 * path (`/api/specs/…`) when it has no `PUBLIC_BASE_URL`.
 */
function absolute(url: string, baseUrl: string): string {
  return /^https?:\/\//i.test(url) ? url : `${baseUrl}${url}`;
}

/** `2026-09-24T00:07:16.403Z` → `2026-09-24`. */
function day(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * One line for the Outcome, the Spec's URL (its Published Form) and the
 * Provenance where there is one; Resolved is that one line alone. Dimmer
 * lines follow for what explains the other Outcomes: candidates, reasons,
 * diagnostics.
 */
export function renderOutcome(
  outcome: Outcome,
  { baseUrl, color }: { baseUrl: string; color: boolean },
): string {
  const p = palette(color);
  const lines: string[] = [];
  switch (outcome.outcome) {
    case "Resolved": {
      lines.push(
        [
          p.green(p.bold("Resolved")),
          `${outcome.api.name} (${outcome.api.id})`,
          outcome.provenance,
          absolute(outcome.currentSpec.downloads.published, baseUrl),
          p.dim(`verified ${day(outcome.verifiedAt)}`),
        ].join("  "),
      );
      break;
    }
    case "Ambiguous": {
      lines.push(
        [
          p.yellow(p.bold("Ambiguous")),
          `${outcome.candidates.length} APIs could be meant; say which`,
        ].join("  "),
      );
      for (const c of outcome.candidates)
        lines.push(
          p.dim(
            `  ${c.name}${c.vendor ? ` (${c.vendor})` : ""}${c.apiId ? `  ${c.apiId}` : ""}  ${Math.round(c.probability * 100)}%`,
          ),
        );
      break;
    }
    case "Unconfirmed": {
      let best: string | undefined;
      for (const tier of ["Official", "Endorsed", "Mirror", "Community"])
        if (!best && outcome.sources.some((s) => s.provenance === tier))
          best = tier;
      lines.push(
        [
          p.yellow(p.bold("Unconfirmed")),
          `${outcome.api.name} (${outcome.api.id})`,
          best ?? "",
          absolute(outcome.spec.downloads.published, baseUrl),
          p.dim(`verified ${day(outcome.verifiedAt)}`),
        ]
          .filter(Boolean)
          .join("  "),
      );
      lines.push(
        p.dim(`  not confirmed to describe it: ${outcome.reasons.join("; ")}`),
      );
      break;
    }
    case "NoSpec": {
      lines.push(
        [
          p.red(p.bold("No Spec")),
          `${outcome.api.name} (${outcome.api.id})`,
          outcome.communityAvailable
            ? "a Community Spec exists: add --community to allow it"
            : "no Spec at an allowed Provenance",
        ].join("  "),
      );
      break;
    }
    case "Unknown": {
      lines.push(
        [p.red(p.bold("Unknown")), `no API matches "${outcome.name}"`].join(
          "  ",
        ),
      );
      break;
    }
  }
  if (outcome.diagnostics?.length)
    lines.push(p.dim(`  diagnostics: ${outcome.diagnostics.join(" | ")}`));
  return `${lines.join("\n")}\n`;
}

/** A size as a person reads it: `512 B`, `72.5 kB`, `6.1 MB`. */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** `87 credits left today`; `1 credit`; `no credits left today`. */
export function creditsWords(remaining: number): string {
  if (remaining <= 0) return "no credits left today";
  return `${remaining} credit${remaining === 1 ? "" : "s"} left today`;
}

/** `resets at 00:00 UTC, in 5 h`, from when the credits are next refilled. */
export function resetWords(resetsAt: string, now: Date): string {
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return "";
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  const seconds = Math.ceil((at.getTime() - now.getTime()) / 1000);
  return `resets at ${hh}:${mm} UTC, in ${durationWords(seconds)}`;
}

/** A failed request, for stderr: what went wrong, then what fixes it. */
export function renderError(error: CliHttpError, color: boolean): string {
  const p = palette(color);
  const lines = [`${p.red(p.bold("error"))}  ${error.error}`];
  if (error.hint) lines.push(`  ${error.hint}`);
  return `${lines.join("\n")}\n`;
}

/** A warning, for stderr: something the command went on past. */
export function renderWarning(message: string, color: boolean): string {
  const p = palette(color);
  return `${p.yellow(p.bold("warning"))}  ${message}\n`;
}

/** A usage error, for stderr, with where to read the usage. */
export function renderUsageError(message: string, color: boolean): string {
  const p = palette(color);
  return `${p.red(p.bold("usage error"))}  ${message}\n  Run \`swaggerbot --help\` for the usage.\n`;
}

/** One page of `GET /api/apis/{apiId}/outline`, as the CLI reads it. */
export type OutlinePageBody = {
  apiId: string;
  specId: string;
  title: string | null;
  apiVersion: string | null;
  servers: string[];
  securitySchemes: SpecOutline["securitySchemes"];
  tags: SpecOutline["tags"];
  /** The server kept only its largest tags. */
  tagsCut?: true;
  operations: SpecOutline["operations"];
  totalOperations: number;
  matchedOperations: number;
  nextCursor: string | null;
};

/** How many tags the outline view lists without `--all`. */
export const SHOWN_TAGS = 20;

/** The widest the method, path and operationId columns are padded to. */
const OUTLINE_COLUMN_CAPS = [7, 48, 36];

/**
 * The Spec Outline as a person reads it: the title and API Version, the
 * servers and security schemes, the tags with their operation counts (the
 * `SHOWN_TAGS` largest unless `allTags`), then the operations as a table,
 * `METHOD path  operationId  summary`, and how many of how many there are,
 * with the cursor of the next page when there is one.
 */
export function renderOutline(
  page: OutlinePageBody,
  { allTags, color }: { allTags: boolean; color: boolean },
): string {
  const p = palette(color);
  const lines: string[] = [];
  lines.push(
    [
      p.bold(clean(page.title ?? page.apiId)),
      page.apiVersion === null ? "" : `API Version ${clean(page.apiVersion)}`,
      p.dim(page.apiId),
    ]
      .filter(Boolean)
      .join("  "),
  );
  const field = (name: string, value: string) =>
    lines.push(`${p.dim(name.padEnd(9))} ${value}`);
  field(
    "servers",
    page.servers.length > 0 ? page.servers.map(clean).join("  ") : "none",
  );
  field(
    "security",
    page.securitySchemes.length > 0
      ? page.securitySchemes
          .map(
            (s) =>
              `${clean(s.name)} (${[s.type, s.scheme, s.in && `in ${s.in}`]
                .filter(Boolean)
                .map((w) => clean(w as string))
                .join(" ")})`,
          )
          .join(", ")
      : "none",
  );
  // A stable sort: tags with the same count keep the outline's order.
  const tags = [...page.tags].sort(
    (a, b) => b.operationCount - a.operationCount,
  );
  const shown = allTags ? tags : tags.slice(0, SHOWN_TAGS);
  const more = [
    tags.length > shown.length
      ? `+${tags.length - shown.length} more: --all lists them`
      : "",
    page.tagsCut ? "the service sent only the largest" : "",
  ].filter(Boolean);
  field(
    "tags",
    shown.length > 0
      ? `${shown.map((t) => `${clean(t.name)} ${t.operationCount}`).join(", ")}${more.length > 0 ? p.dim(`  (${more.join("; ")})`) : ""}`
      : "none",
  );

  if (page.operations.length > 0) {
    lines.push("");
    const rows = page.operations.map((op) => [
      op.method.toUpperCase(),
      clean(op.path),
      clean(op.operationId ?? ""),
      `${clean(op.summary ?? "")}${op.deprecated ? p.dim(" (deprecated)") : ""}`,
    ]);
    // A column is as wide as its widest cell up to its cap; a longer cell
    // runs past it on its own row rather than pushing every row right.
    const widths = OUTLINE_COLUMN_CAPS.map((cap, i) =>
      Math.min(cap, Math.max(...rows.map((row) => row[i]?.length ?? 0))),
    );
    for (const [method = "", path = "", operationId = "", summary = ""] of rows)
      lines.push(
        [
          p.bold(method.padEnd(widths[0] ?? 0)),
          path.padEnd(widths[1] ?? 0),
          p.dim(operationId.padEnd(widths[2] ?? 0)),
          summary,
        ]
          .join("  ")
          .trimEnd(),
      );
  }

  lines.push("");
  const { totalOperations: total, matchedOperations: matched } = page;
  const count =
    matched === total
      ? `${page.operations.length} of ${total} operations`
      : `${page.operations.length} of ${matched} matching operations (${total} in all)`;
  lines.push(
    page.nextCursor === null
      ? count
      : `${count}; next page: --cursor ${page.nextCursor}`,
  );
  return `${lines.join("\n")}\n`;
}

/** One operation of `GET /api/apis/{apiId}/operation`, as the CLI reads it. */
export type OperationBody = {
  apiId: string;
  specId: string;
  method: string;
  path: string;
  operation: { operationId?: unknown; summary?: unknown } & Record<
    string,
    unknown
  >;
  circular: Record<string, unknown>;
  securitySchemes: Record<string, unknown>;
  truncated: boolean;
};

/**
 * One operation: a heading, `METHOD path · operationId · summary`, then
 * the operation as pretty JSON (it is a JSON object; a prose view would
 * invent structure), then the security schemes it names and the schemas
 * that recur within themselves, each as JSON; `truncated` and `circular`
 * are said under the heading.
 */
export function renderOperation(body: OperationBody, color: boolean): string {
  const p = palette(color);
  const { operationId, summary } = body.operation;
  const lines = [
    [
      p.bold(`${body.method.toUpperCase()} ${clean(body.path)}`),
      typeof operationId === "string" ? clean(operationId) : "",
      typeof summary === "string" ? clean(summary) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    ...expansionNotes(body, p),
    prettyJson(body.operation),
  ];
  if (Object.keys(body.securitySchemes).length > 0)
    lines.push(p.dim("security schemes"), prettyJson(body.securitySchemes));
  if (Object.keys(body.circular).length > 0)
    lines.push(p.dim("circular"), prettyJson(body.circular));
  return `${lines.join("\n")}\n`;
}

/** One schema of `GET /api/apis/{apiId}/schema`, as the CLI reads it. */
export type SchemaBody = {
  apiId: string;
  specId: string;
  name: string;
  schema: unknown;
  circular: Record<string, unknown>;
  truncated: boolean;
};

/** One schema: a heading, its name and API, then the schema as pretty JSON, as `renderOperation`. */
export function renderSchema(body: SchemaBody, color: boolean): string {
  const p = palette(color);
  const lines = [
    `${p.bold(clean(body.name))} · ${p.dim(`components.schemas of ${body.apiId}`)}`,
    ...expansionNotes(body, p),
    prettyJson(body.schema),
  ];
  if (Object.keys(body.circular).length > 0)
    lines.push(p.dim("circular"), prettyJson(body.circular));
  return `${lines.join("\n")}\n`;
}

/** What `truncated` and `circular` mean, said only when they apply. */
function expansionNotes(
  { truncated, circular }: Pick<OperationBody, "truncated" | "circular">,
  p: ReturnType<typeof palette>,
): string[] {
  const notes: string[] = [];
  if (truncated)
    notes.push(
      p.yellow(
        'truncated: inlining stopped at the size cap; each reference left is {"$ref", "x-truncated": true}',
      ),
    );
  const names = Object.keys(circular);
  if (names.length > 0)
    notes.push(
      p.dim(
        `circular: ${names.map(clean).join(", ")} ${names.length === 1 ? "recurs within itself" : "recur within themselves"}; each is under "circular" once, and {"$ref", "x-circular": true} where it recurs`,
      ),
    );
  return notes;
}

/** One page of `GET /api/vendors`, as the CLI reads it. */
export type VendorsPageBody = {
  vendors: { id: string; name: string; apiCount: number }[];
  /** How many Vendors match the query, on every page. */
  total: number;
  nextCursor: string | null;
};

/** The widest the id and name columns of the Vendor list are padded to. */
const VENDOR_COLUMN_CAPS = [32, 32];

/**
 * The Vendor list as a person reads it: a table of `id  name  N APIs`, then
 * how many of how many there are, with the cursor of the next page when
 * there is one.
 */
export function renderVendors(
  page: VendorsPageBody,
  { query, color }: { query?: string; color: boolean },
): string {
  const p = palette(color);
  const lines: string[] = [];
  const rows = page.vendors.map((v) => [
    clean(v.id),
    clean(v.name),
    `${v.apiCount} API${v.apiCount === 1 ? "" : "s"}`,
  ]);
  const widths = VENDOR_COLUMN_CAPS.map((cap, i) =>
    Math.min(cap, Math.max(...rows.map((row) => row[i]?.length ?? 0))),
  );
  for (const [id = "", name = "", count = ""] of rows)
    lines.push(
      [
        p.bold(id.padEnd(widths[0] ?? 0)),
        name.padEnd(widths[1] ?? 0),
        p.dim(count),
      ].join("  "),
    );
  if (lines.length > 0) lines.push("");
  const count = `${page.vendors.length} of ${page.total} Vendors${query === undefined ? "" : ` matching "${clean(query)}"`}`;
  lines.push(
    page.nextCursor === null
      ? count
      : `${count}; --cursor ${page.nextCursor} for the next page`,
  );
  return `${lines.join("\n")}\n`;
}

/** The 200 of `GET /api/vendors/{vendor}/apis`, as the CLI reads it. */
export type VendorApisBody = {
  vendor: Vendor;
  apis: {
    api: Api;
    /** null when the Index holds no confirmed Official, Endorsed or Mirror Spec of it. */
    currentSpec: SpecAnswer | null;
    alternateSpecs: SpecAnswer[];
    provenance: Provenance | null;
    verifiedAt: string | null;
  }[];
};

/** The 300 of `GET /api/vendors/{vendor}/apis`: the Vendors it could mean. */
export type VendorMatchesBody = { vendors: Pick<Vendor, "id" | "name">[] };

/**
 * A Vendor's APIs as a person reads them: the Vendor, then each API with its
 * id, its Current Spec (API Version, format, Provenance, when it was
 * verified) and both download URLs, or that the Index has no confirmed Spec
 * of it yet.
 */
export function renderVendorApis(
  body: VendorApisBody,
  { baseUrl, color }: { baseUrl: string; color: boolean },
): string {
  const p = palette(color);
  const lines = [
    `${p.bold(clean(body.vendor.name))}  ${p.dim(clean(body.vendor.id))}`,
  ];
  for (const { api, currentSpec, provenance, verifiedAt } of body.apis) {
    lines.push("", `${p.bold(clean(api.name))}  ${clean(api.id)}`);
    if (!currentSpec) {
      lines.push(p.dim("  no confirmed Spec in the Index yet"));
      continue;
    }
    lines.push(
      `  ${[
        currentSpec.apiVersion === null
          ? "no API Version"
          : `API Version ${clean(currentSpec.apiVersion)}`,
        currentSpec.format,
        provenance ?? "",
        verifiedAt ? p.dim(`verified ${day(verifiedAt)}`) : "",
      ]
        .filter(Boolean)
        .join("  ")}`,
      `  ${p.dim("published ")}  ${absolute(currentSpec.downloads.published, baseUrl)}`,
      `  ${p.dim("normalized")}  ${absolute(currentSpec.downloads.normalized, baseUrl)}${
        currentSpec.normalized === "ready"
          ? ""
          : p.dim(
              currentSpec.normalized === "pending"
                ? "  (being built)"
                : "  (couldn't be built)",
            )
      }`,
    );
  }
  lines.push(
    "",
    `${body.apis.length} API${body.apis.length === 1 ? "" : "s"} in the Index`,
  );
  return `${lines.join("\n")}\n`;
}

/** The Vendors a name could mean, as `lookup` shows an Ambiguous Outcome. */
export function renderVendorMatches(
  body: VendorMatchesBody,
  { vendor, color }: { vendor: string; color: boolean },
): string {
  const p = palette(color);
  const width = Math.max(...body.vendors.map((v) => clean(v.id).length));
  const lines = [
    [
      p.yellow(p.bold("Ambiguous")),
      `${body.vendors.length} Vendors match "${clean(vendor)}"; say which`,
    ].join("  "),
    ...body.vendors.map((v) =>
      p.dim(`  ${clean(v.id).padEnd(width)}  ${clean(v.name)}`),
    ),
    p.dim("  `swaggerbot vendor <id>` lists one"),
  ];
  return `${lines.join("\n")}\n`;
}

/** A Vendor the Index doesn't hold, as `lookup` shows an Unknown Outcome, and how to add one. */
export function renderUnknownVendor(vendor: string, color: boolean): string {
  const p = palette(color);
  return `${[
    [
      p.red(p.bold("Unknown")),
      `no Vendor "${clean(vendor)}" in the Index`,
    ].join("  "),
    p.dim(
      "  Only APIs already in the Index are listed: `swaggerbot lookup <name>` finds an API and adds it, with its Vendor, to the Index.",
    ),
  ].join("\n")}\n`;
}

/**
 * `value` as JSON indented by two, safe on a terminal: `JSON.stringify`
 * escapes C0 controls itself, and DEL and the C1 controls are escaped too.
 */
function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-\u009f]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** A Spec's text for one line of a terminal: runs of whitespace as one space, control characters gone. */
function clean(text: string): string {
  return (
    text
      .replace(/\s+/g, " ")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .trim()
  );
}
