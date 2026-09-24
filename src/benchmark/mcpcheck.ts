import { parseArgs } from "node:util";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MAX_RESULT_BYTES } from "~/mcp/tools/get-spec-outline";
import { schemaNameOf, truncatedReferences } from "~/spec-forms/operation";
import { pickOperations } from "./formscheck";

/** The names checked when `--names` isn't given: the largest Benchmark Specs. */
export const DEFAULT_NAMES = ["Stripe", "GitHub REST API", "Cloudflare"];
/** Every tool `/mcp` must list. */
export const REQUIRED_TOOLS = [
  "lookup_api",
  "list_vendor_apis",
  "get_spec_outline",
  "get_operation",
  "get_schema",
];
/** Each call must answer within this, in ms. */
export const CALL_TARGET_MS = 2_000;
/** Each result must stay under this, in bytes (ADR 0005). */
export const RESULT_TARGET_BYTES = MAX_RESULT_BYTES;
/** How many operations of the filtered page are fetched per Spec. */
export const OPERATION_SAMPLE = 3;
/** Calls a second, at most: under the default 60/min per-IP limit. */
export const DEFAULT_RPS = 0.8;
/** A call that takes longer than this is an error. */
const REQUEST_TIMEOUT_MS = 30_000;

export const MCPCHECK_USAGE = `usage: pnpm tsx scripts/mcpcheck.ts <baseUrl> [--names ${DEFAULT_NAMES.join(",")}] [--json]

Checks the MCP server at <baseUrl>/mcp with the MCP SDK's HTTP client
(LOADCHECK_KEY, when set, is sent as the bearer). Lists the tools, which
must include all five:
${REQUIRED_TOOLS.join(", ")}.
For each name: lookup_api, which must be Resolved; get_spec_outline
without a filter, then with a query taken from that first page;
get_operation on ${OPERATION_SAMPLE} operations of the filtered page; and get_schema on
one schema reference they left.

Passes when no call failed or was a tool error, every result (its
structuredContent as JSON plus its text) is under ${RESULT_TARGET_BYTES / 1000} kB and every call,
the Lookups from the Index included, answered within ${CALL_TARGET_MS / 1000} s. Calls are paced
under the default 60/min per-IP limit.

  --names a,b,c   the names to check (default ${DEFAULT_NAMES.join(",")})
  --json          print the whole report, with every call

Exits 1 when a check fails, 2 on bad arguments.`;

/** The options of `scripts/mcpcheck.ts`, once validated. */
export type McpcheckOptions = {
  /** The deployment, without a trailing slash. */
  baseUrl: string;
  names: string[];
  /** Sent as the bearer of every request (`LOADCHECK_KEY`). */
  key?: string;
  /** Calls a second, at most. */
  rps: number;
  json: boolean;
};

export type ParsedMcpcheckArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: McpcheckOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedMcpcheckArgs {
  return { ok: false, error, exitCode: 2 };
}

/**
 * Parses and validates the `scripts/mcpcheck.ts` arguments without running
 * anything. The key comes from `LOADCHECK_KEY` in `env`, if set.
 */
export function parseMcpcheckArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): ParsedMcpcheckArgs {
  let values: { names?: string; json?: boolean; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        names: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (err) {
    return fail((err as Error).message);
  }
  if (values.help) return { ok: true, help: true };

  const [base, ...extra] = positionals;
  if (!base) return fail("missing <baseUrl>");
  if (extra.length > 0) return fail(`unexpected argument: ${extra[0]}`);
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return fail(`<baseUrl> must be an http(s) URL (got "${base}")`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return fail(`<baseUrl> must be an http(s) URL (got "${base}")`);

  const names =
    values.names === undefined
      ? DEFAULT_NAMES
      : values.names
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
  if (names.length === 0)
    return fail(`--names must name at least one API (got "${values.names}")`);

  const key = env.LOADCHECK_KEY?.trim();
  return {
    ok: true,
    help: false,
    options: {
      baseUrl: url.href.replace(/\/+$/, ""),
      names,
      key: key || undefined,
      rps: DEFAULT_RPS,
      json: values.json ?? false,
    },
  };
}

/** One MCP call the check made. */
export type McpcheckCall = {
  /** The name being checked; absent for connecting and listing the tools. */
  name?: string;
  /** The tool, or `connect` / `tools/list`. */
  tool: string;
  arguments?: Record<string, unknown>;
  /** Wall-clock milliseconds, rounded, until the answer was read. */
  ms: number;
  /** Bytes of the result: its `structuredContent` as JSON plus its text. */
  bytes: number;
  /** In words, what the call found: the Outcome, the operation count, … */
  note?: string;
  /** Why it failed, for a call that did (a tool error's text included). */
  error?: string;
};

/** One name's calls and what failed. */
export type McpcheckNameReport = {
  name: string;
  apiId?: string;
  /** The query taken from the outline's first page. */
  query?: string;
  calls: McpcheckCall[];
  /** What failed, in words; empty when every call succeeded. */
  failures: string[];
};

export type McpcheckReport = {
  baseUrl: string;
  /** Connecting and `tools/list`. */
  setup: McpcheckCall[];
  /** The tools `/mcp` listed. */
  tools: string[];
  names: McpcheckNameReport[];
  /** The slowest call and the largest result, in ms and bytes. */
  maxMs: number;
  maxBytes: number;
  /** What failed, in words: setup, each name, then the bounds missed. */
  failures: string[];
  pass: boolean;
};

/** What a tool call answers, as the check reads it. */
type ToolResult = {
  isError?: boolean;
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The text blocks of a result, joined. */
function textOf(result: ToolResult): string {
  return (result.content ?? [])
    .flatMap((c) =>
      isRecord(c) && c.type === "text" && typeof c.text === "string"
        ? [c.text]
        : [],
    )
    .join("\n");
}

/**
 * A result's size as an agent receives it: its `structuredContent` as JSON
 * plus its text, in bytes (the bound `get_spec_outline` holds itself to).
 */
export function resultBytes(result: ToolResult): number {
  const structured =
    result.structuredContent === undefined
      ? 0
      : Buffer.byteLength(JSON.stringify(result.structuredContent));
  return structured + Buffer.byteLength(textOf(result));
}

/**
 * A `query` for `get_spec_outline` from a page of operations: the first
 * literal path segment of at least 3 letters that isn't a version (`v1`) or
 * a `{parameter}`, lowercased. Every operation it came from matches it, so
 * the filtered page isn't empty. `undefined` when no path has one.
 */
export function queryFrom(
  operations: readonly { path: string }[],
): string | undefined {
  for (const { path } of operations)
    for (const segment of path.split("/"))
      if (/^[A-Za-z][\w.-]{2,}$/.test(segment) && !/^v\d+$/i.test(segment))
        return segment.toLowerCase();
  return undefined;
}

/**
 * The whole report from the setup calls and each name's: it passes when
 * nothing failed, every result is under `RESULT_TARGET_BYTES` and every
 * call answered within `CALL_TARGET_MS`.
 */
export function mcpcheckReport(
  baseUrl: string,
  setup: McpcheckCall[],
  tools: string[],
  names: McpcheckNameReport[],
): McpcheckReport {
  const failures = setup.flatMap((c) =>
    c.error ? [`${c.tool}: ${c.error}`] : [],
  );
  const listed = setup.some((c) => c.tool === "tools/list" && !c.error);
  const missing = REQUIRED_TOOLS.filter((t) => !tools.includes(t));
  if (listed && missing.length > 0)
    failures.push(`tools/list: missing ${missing.join(", ")}`);
  for (const n of names)
    failures.push(...n.failures.map((f) => `${n.name}: ${f}`));
  const calls = [...setup, ...names.flatMap((n) => n.calls)];
  for (const c of calls) {
    const who = `${c.name ? `${c.name}: ` : ""}${c.tool}`;
    if (c.bytes >= RESULT_TARGET_BYTES)
      failures.push(
        `${who}: the result is ${size(c.bytes)}, not under ${size(RESULT_TARGET_BYTES)}`,
      );
    if (c.ms > CALL_TARGET_MS)
      failures.push(
        `${who}: took ${duration(c.ms)}, over ${duration(CALL_TARGET_MS)}`,
      );
  }
  return {
    baseUrl,
    setup,
    tools,
    names,
    maxMs: Math.max(0, ...calls.map((c) => c.ms)),
    maxBytes: Math.max(0, ...calls.map((c) => c.bytes)),
    failures,
    pass: names.length > 0 && failures.length === 0,
  };
}

/** `320 ms` under a second, `14.2 s` from there. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** `812 B`, `3.4 KB`. */
function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** One call as a line: the tool, its size and time, and what it found. */
function callLine(c: McpcheckCall): string {
  const found = c.error ? `ERROR ${c.error}` : (c.note ?? "");
  return `  ${c.tool.padEnd(17)} ${size(c.bytes).padStart(8)} in ${duration(c.ms).padStart(7)}${found ? ` · ${found}` : ""}`;
}

/** The report as text: the setup, a block per name, then the maxima and the verdict. */
export function mcpcheckLines(report: McpcheckReport): string[] {
  const lines = [`MCP check: ${report.baseUrl}/mcp`, ""];
  lines.push(...report.setup.map(callLine));
  for (const n of report.names) {
    lines.push("");
    lines.push(`${n.name}${n.apiId ? `  (API ${n.apiId})` : ""}`);
    lines.push(...n.calls.map(callLine));
  }
  lines.push("");
  lines.push(
    `Slowest call ${duration(report.maxMs)} (≤ ${duration(CALL_TARGET_MS)}) · largest result ${size(report.maxBytes)} (< ${size(RESULT_TARGET_BYTES)})`,
  );
  if (report.pass) lines.push("PASS");
  else {
    lines.push("FAIL");
    for (const f of report.failures) lines.push(`  ${f}`);
  }
  return lines;
}

/** What the check runs on; tests pass their own `fetch` and `sleep`. */
export type McpcheckDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** The parts of a `get_spec_outline` page the check reads. */
type OutlineRow = { method: string; path: string };

function operationsOf(result: ToolResult): OutlineRow[] | undefined {
  const ops = result.structuredContent?.operations;
  return Array.isArray(ops)
    ? ops.filter(
        (o): o is OutlineRow =>
          isRecord(o) &&
          typeof o.method === "string" &&
          typeof o.path === "string",
      )
    : undefined;
}

/**
 * Runs the MCP check against `options.baseUrl`/mcp, one call at a time,
 * and returns the report. Each call starts at least `1 / rps` seconds after
 * the previous one.
 */
export async function runMcpcheck(
  options: McpcheckOptions,
  deps: McpcheckDeps = {},
): Promise<McpcheckReport> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => performance.now());
  const intervalMs = 1000 / options.rps;
  let nextAt = 0;

  async function pace(): Promise<number> {
    const wait = nextAt - now();
    if (wait > 0) await sleep(wait);
    const started = now();
    nextAt = started + intervalMs;
    return started;
  }

  const client = new Client({ name: "swagger.bot mcpcheck", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${options.baseUrl}/mcp`),
    {
      requestInit: options.key
        ? { headers: { authorization: `Bearer ${options.key}` } }
        : undefined,
      fetch: deps.fetch,
    },
  );

  const setup: McpcheckCall[] = [];
  let tools: string[] = [];
  const started = await pace();
  try {
    await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
    setup.push({ tool: "connect", ms: Math.round(now() - started), bytes: 0 });
  } catch (err) {
    setup.push({
      tool: "connect",
      ms: Math.round(now() - started),
      bytes: 0,
      error: (err as Error).message,
    });
    return mcpcheckReport(options.baseUrl, setup, tools, []);
  }

  try {
    const listStarted = await pace();
    try {
      const listed = await client.listTools(undefined, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      tools = listed.tools.map((t) => t.name);
      setup.push({
        tool: "tools/list",
        ms: Math.round(now() - listStarted),
        bytes: Buffer.byteLength(JSON.stringify(listed)),
        note: `${tools.length} tools: ${tools.join(", ")}`,
      });
    } catch (err) {
      setup.push({
        tool: "tools/list",
        ms: Math.round(now() - listStarted),
        bytes: 0,
        error: (err as Error).message,
      });
    }

    /** One tool call, paced and timed; a tool error is the call's error. */
    async function call(
      report: McpcheckNameReport,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<{ call: McpcheckCall; result?: ToolResult }> {
      const callStarted = await pace();
      const entry: McpcheckCall = {
        name: report.name,
        tool,
        arguments: args,
        ms: 0,
        bytes: 0,
      };
      report.calls.push(entry);
      try {
        const result = (await client.callTool(
          { name: tool, arguments: args },
          { timeout: REQUEST_TIMEOUT_MS },
        )) as ToolResult;
        entry.ms = Math.round(now() - callStarted);
        entry.bytes = resultBytes(result);
        if (result.isError) {
          entry.error = textOf(result) || "isError without a text";
          report.failures.push(`${tool}: ${entry.error}`);
          return { call: entry };
        }
        return { call: entry, result };
      } catch (err) {
        entry.ms = Math.round(now() - callStarted);
        entry.error = (err as Error).message;
        report.failures.push(`${tool}: ${entry.error}`);
        return { call: entry };
      }
    }

    async function checkName(name: string): Promise<McpcheckNameReport> {
      const report: McpcheckNameReport = { name, calls: [], failures: [] };

      // 1. The Lookup, which must be Resolved.
      const lookup = await call(report, "lookup_api", { name });
      if (!lookup.result) return report;
      const outcome = lookup.result.structuredContent;
      lookup.call.note = `${outcome?.outcome ?? "no Outcome"}`;
      if (outcome?.outcome !== "Resolved") {
        report.failures.push(
          `lookup_api: the Outcome is ${outcome?.outcome ?? "missing"}, not Resolved`,
        );
        return report;
      }
      const apiId =
        isRecord(outcome.api) && typeof outcome.api.id === "string"
          ? outcome.api.id
          : undefined;
      if (!apiId) {
        report.failures.push("lookup_api: the Resolved Outcome has no API id");
        return report;
      }
      report.apiId = apiId;

      // 2. The outline, unfiltered, and then with a query from its first page.
      const first = await call(report, "get_spec_outline", { apiId });
      if (!first.result) return report;
      const firstPage = operationsOf(first.result);
      const total = first.result.structuredContent?.totalOperations;
      first.call.note = `${firstPage?.length ?? 0} of ${total ?? "?"} operations`;
      if (!firstPage || firstPage.length === 0) {
        report.failures.push(
          "get_spec_outline: the first page lists no operations",
        );
        return report;
      }
      const query = queryFrom(firstPage);
      if (!query) {
        report.failures.push(
          "get_spec_outline: no path of the first page gives a query",
        );
        return report;
      }
      report.query = query;
      const filtered = await call(report, "get_spec_outline", { apiId, query });
      if (!filtered.result) return report;
      const page = operationsOf(filtered.result);
      const matched = filtered.result.structuredContent?.matchedOperations;
      filtered.call.note = `query "${query}": ${page?.length ?? 0} of ${matched ?? "?"} matched`;
      if (!page || page.length === 0) {
        report.failures.push(
          `get_spec_outline: query "${query}" matched no operations`,
        );
        return report;
      }

      // 3. Operations of that page; 4. one schema reference they left.
      let reference: string | undefined;
      for (const { method, path } of pickOperations(page, OPERATION_SAMPLE)) {
        const operation = await call(report, "get_operation", {
          apiId,
          method,
          path,
        });
        if (!operation.result) continue;
        const left = truncatedReferences(
          operation.result.structuredContent,
        ).filter((ref) => schemaNameOf(ref) !== ref);
        operation.call.note = `${method.toUpperCase()} ${path} · ${left.length} schema reference${left.length === 1 ? "" : "s"} left`;
        reference ??= left[0];
      }
      if (reference) {
        const schema = await call(report, "get_schema", {
          apiId,
          name: reference,
        });
        if (schema.result) schema.call.note = reference;
      } else
        report.calls.push({
          name,
          tool: "get_schema",
          ms: 0,
          bytes: 0,
          note: "skipped: the operations left no schema reference",
        });
      return report;
    }

    const names: McpcheckNameReport[] = [];
    if (!setup.some((c) => c.error))
      for (const name of options.names) names.push(await checkName(name));
    return mcpcheckReport(options.baseUrl, setup, tools, names);
  } finally {
    await client.close().catch(() => {});
  }
}
