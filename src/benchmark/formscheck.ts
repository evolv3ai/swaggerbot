import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { percentile } from "./latency";

/** The names checked when `--names` isn't given: the largest Benchmark Specs. */
export const DEFAULT_NAMES = ["GitHub", "Stripe", "Cloudflare"];
/** The outline's p90 must stay under this, in ms. */
export const OUTLINE_TARGET_MS = 500;
/** The operations' p90 must stay under this, in ms. */
export const OPERATION_TARGET_MS = 2_000;
/** Each download must finish within this, in ms. */
export const DOWNLOAD_TARGET_MS = 60_000;
/** Requests a second, at most: under the default 60/min per-IP limit. */
export const DEFAULT_RPS = 0.8;
/** While a Spec's forms are pending, the outline is asked again this often. */
export const PENDING_POLL_MS = 5_000;
/** And for this long, at most. */
export const PENDING_WAIT_MS = 120_000;
/** How many operations are fetched per Spec. */
export const OPERATION_SAMPLE = 5;
/** A request that takes longer than this is an error. */
const REQUEST_TIMEOUT_MS = { download: 180_000, other: 30_000 };
/** The longest `retry-after` waited for after a 429, and how many retries. */
const MAX_RETRY_WAIT_MS = 60_000;
const MAX_RETRIES = 5;

export const FORMSCHECK_USAGE = `usage: pnpm tsx scripts/formscheck.ts <baseUrl> [--names ${DEFAULT_NAMES.join(",")}] [--json]

Checks the Spec forms and the navigation on a deployment. For each name:
POST /api/lookup (an Index answer; with LOADCHECK_KEY as the bearer when it
is set, so a name missing from the Index can be found), which must be
Resolved; waits out a pending Normalized Form (the outline every
${PENDING_POLL_MS / 1000} s, for up to ${PENDING_WAIT_MS / 60_000} min); downloads both forms (the Published bytes'
sha256 must be the Spec id, the Normalized Form OpenAPI 3.1.x); GETs the
outline, ${OPERATION_SAMPLE} of its operations and the Vendor's APIs, which must list the API.

Passes when every step succeeded, outline p90 < ${OUTLINE_TARGET_MS} ms, operation
p90 < ${OPERATION_TARGET_MS / 1000} s and every download finished within ${DOWNLOAD_TARGET_MS / 1000} s. Requests are paced
under the default 60/min per-IP limit, and a 429 is retried after its
retry-after.

  --names a,b,c   the names to check (default ${DEFAULT_NAMES.join(",")})
  --json          print the whole report, with every request

Exits 1 when a check fails, 2 on bad arguments.`;

/** The options of `scripts/formscheck.ts`, once validated. */
export type FormscheckOptions = {
  /** The deployment, without a trailing slash. */
  baseUrl: string;
  names: string[];
  /** Sent as the bearer of each Lookup (`LOADCHECK_KEY`). */
  key?: string;
  /** Requests a second, at most. */
  rps: number;
  json: boolean;
};

export type ParsedFormscheckArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: FormscheckOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedFormscheckArgs {
  return { ok: false, error, exitCode: 2 };
}

/**
 * Parses and validates the `scripts/formscheck.ts` arguments without running
 * anything. The key comes from `LOADCHECK_KEY` in `env`, if set.
 */
export function parseFormscheckArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): ParsedFormscheckArgs {
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

/** The step of a name's check a request belongs to. */
export type FormscheckStep =
  | "lookup"
  | "pending"
  | "published"
  | "normalized"
  | "outline"
  | "operation"
  | "vendor-apis";

/** One request the forms check sent. */
export type FormscheckRequest = {
  name: string;
  step: FormscheckStep;
  method: "GET" | "POST";
  /** The path and query asked for. */
  path: string;
  /** Wall-clock milliseconds, rounded, until the whole body was read. */
  ms: number;
  /** HTTP status; `null` when no response came (network error, timeout). */
  status: number | null;
  /** Bytes of the body. */
  bytes: number;
  /** Why it failed, for a request that did. */
  error?: string;
};

/** A timed download or GET: how long it took and how big it was. */
export type Timed = { ms: number; bytes: number };

export type OperationCheck = Timed & {
  method: string;
  path: string;
  truncated: boolean;
};

/** One name's numbers. A step that didn't run is absent. */
export type NameReport = {
  name: string;
  apiId?: string;
  vendorId?: string;
  specId?: string;
  lookup?: Timed & { outcome?: string };
  /** How long the pending forms were waited for, in ms; absent when they weren't pending. */
  pendingWaitMs?: number;
  published?: Timed & { sha256Matches: boolean };
  normalized?: Timed & { openapi?: string };
  outline?: Timed & { operationCount: number };
  operations: OperationCheck[];
  vendorApis?: Timed & { listed: boolean };
  /** What failed, in words; empty when every step succeeded. */
  failures: string[];
};

export type FormscheckReport = {
  baseUrl: string;
  names: NameReport[];
  outlineP90: number;
  operationP90: number;
  /** Every answer that wasn't a 2xx, the waited-out 409s and retried 429s included. */
  non2xx: FormscheckRequest[];
  /** What failed, in words: each name's failures, then the targets missed. */
  failures: string[];
  pass: boolean;
  requests: FormscheckRequest[];
};

/**
 * The operations to fetch of `operations`: the first, the last and
 * `count - 2` evenly spaced between them, in order; all of them when there
 * are no more than `count`.
 */
export function pickOperations<T>(
  operations: readonly T[],
  count = OPERATION_SAMPLE,
): T[] {
  if (operations.length <= count) return [...operations];
  const last = operations.length - 1;
  return Array.from(
    { length: count },
    (_, i) => operations[Math.round((i * last) / (count - 1))] as T,
  );
}

/**
 * The whole report from each name's numbers and every request: the outline
 * and operation p90s, the non-2xx answers, and what failed. It passes when
 * no name failed a step, the outline p90 is under 500 ms, the operation p90
 * under 2 s, and every download finished within 60 s.
 */
export function formscheckReport(
  baseUrl: string,
  names: NameReport[],
  requests: FormscheckRequest[],
): FormscheckReport {
  const outlines = names.flatMap((n) => (n.outline ? [n.outline.ms] : []));
  const operations = names.flatMap((n) => n.operations.map((o) => o.ms));
  const outlineP90 = percentile(outlines, 90);
  const operationP90 = percentile(operations, 90);
  const failures = names.flatMap((n) =>
    n.failures.map((f) => `${n.name}: ${f}`),
  );
  if (outlines.length > 0 && outlineP90 >= OUTLINE_TARGET_MS)
    failures.push(
      `outline p90 ${duration(outlineP90)} is not under ${duration(OUTLINE_TARGET_MS)}`,
    );
  if (operations.length > 0 && operationP90 >= OPERATION_TARGET_MS)
    failures.push(
      `operation p90 ${duration(operationP90)} is not under ${duration(OPERATION_TARGET_MS)}`,
    );
  for (const n of names)
    for (const [form, d] of [
      ["Published", n.published],
      ["Normalized", n.normalized],
    ] as const)
      if (d && d.ms > DOWNLOAD_TARGET_MS)
        failures.push(
          `${n.name}: the ${form} Form took ${duration(d.ms)} to download, over ${duration(DOWNLOAD_TARGET_MS)}`,
        );
  const non2xx = requests.filter(
    (r) => r.status === null || r.status < 200 || r.status > 299,
  );
  return {
    baseUrl,
    names,
    outlineP90,
    operationP90,
    non2xx,
    failures,
    pass: names.length > 0 && failures.length === 0,
    requests,
  };
}

/** `320 ms` under a second, `14.2 s` from there. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** `812 B`, `3.4 KB`, `12.7 MB`. */
function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The report as text: a block per name, then the overall numbers and the verdict. */
export function formscheckLines(report: FormscheckReport): string[] {
  const lines = [`Forms check: ${report.baseUrl}`];
  for (const n of report.names) {
    lines.push("");
    const ids = [
      n.apiId && `API ${n.apiId}`,
      n.specId && `Spec ${n.specId.slice(0, 12)}`,
    ].filter(Boolean);
    lines.push(`${n.name}${ids.length ? `  (${ids.join(" · ")})` : ""}`);
    if (n.lookup) {
      const waited =
        n.pendingWaitMs === undefined
          ? ""
          : ` · forms pending, waited ${duration(n.pendingWaitMs)}`;
      lines.push(
        `  lookup      ${duration(n.lookup.ms)} · ${n.lookup.outcome ?? "no Outcome"}${waited}`,
      );
    }
    if (n.published)
      lines.push(
        `  published   ${size(n.published.bytes)} in ${duration(n.published.ms)} · sha256 ${n.published.sha256Matches ? "= Spec id" : "MISMATCH"}`,
      );
    if (n.normalized)
      lines.push(
        `  normalized  ${size(n.normalized.bytes)} in ${duration(n.normalized.ms)} · openapi ${n.normalized.openapi ?? "missing"}`,
      );
    if (n.outline)
      lines.push(
        `  outline     ${size(n.outline.bytes)} in ${duration(n.outline.ms)} · ${n.outline.operationCount} operations`,
      );
    for (const o of n.operations)
      lines.push(
        `  operation   ${size(o.bytes)} in ${duration(o.ms)} · ${o.method.toUpperCase()} ${o.path}${o.truncated ? " · truncated" : ""}`,
      );
    if (n.vendorApis)
      lines.push(
        `  vendor APIs ${size(n.vendorApis.bytes)} in ${duration(n.vendorApis.ms)} · ${n.vendorApis.listed ? "lists the API" : "does NOT list the API"}`,
      );
    for (const f of n.failures) lines.push(`  FAIL: ${f}`);
  }
  lines.push("");
  lines.push(
    `Outline p90 ${duration(report.outlineP90)} (< ${duration(OUTLINE_TARGET_MS)}) · operation p90 ${duration(report.operationP90)} (< ${duration(OPERATION_TARGET_MS)})`,
  );
  lines.push(`Non-2xx: ${report.non2xx.length}`);
  for (const r of report.non2xx)
    lines.push(
      `  ${r.status ?? "no response"} ${r.method} ${r.path}${r.error ? ` (${r.error})` : ""}`,
    );
  if (report.pass) lines.push("PASS");
  else {
    lines.push("FAIL");
    for (const f of report.failures) lines.push(`  ${f}`);
  }
  return lines;
}

/** What the forms check runs on; tests pass their own `sleep`. */
export type FormscheckDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type Sent = { request: FormscheckRequest; body?: Buffer };

/** The parts of a Resolved Outcome the check reads. */
type ResolvedAnswer = {
  outcome: "Resolved";
  api: { id: string; vendorId: string };
  currentSpec: {
    id: string;
    normalized: string;
    downloads: { published: string; normalized: string };
  };
};

function parseJson(body: Buffer | undefined): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `/api/apis/{apiId}/…`: an API id's slash stays a slash. */
function apiPath(apiId: string, resource: string): string {
  return `/api/apis/${apiId.split("/").map(encodeURIComponent).join("/")}/${resource}`;
}

/**
 * Runs the forms check over `options.names`, one name and one request at a
 * time, and returns the report. Each request starts at least `1 / rps`
 * seconds after the previous one; a 429 is retried after its `retry-after`.
 */
export async function runFormscheck(
  options: FormscheckOptions,
  deps: FormscheckDeps = {},
): Promise<FormscheckReport> {
  const doFetch = deps.fetch ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => performance.now());
  const intervalMs = 1000 / options.rps;
  const requests: FormscheckRequest[] = [];
  let nextAt = 0;

  /** One request, paced; a 429 is waited out and sent again. */
  async function send(
    name: string,
    step: FormscheckStep,
    target: string,
    init: { method?: "GET" | "POST"; body?: string } = {},
  ): Promise<Sent> {
    const method = init.method ?? "GET";
    const url = new URL(target, `${options.baseUrl}/`);
    const headers: Record<string, string> = {};
    if (method === "POST") headers["content-type"] = "application/json";
    if (step === "lookup" && options.key)
      headers.authorization = `Bearer ${options.key}`;
    const timeout =
      step === "published" || step === "normalized"
        ? REQUEST_TIMEOUT_MS.download
        : REQUEST_TIMEOUT_MS.other;
    for (let attempt = 0; ; attempt++) {
      const wait = nextAt - now();
      if (wait > 0) await sleep(wait);
      const started = now();
      nextAt = started + intervalMs;
      const path = url.pathname + url.search;
      let sent: Sent;
      let retryAfter: string | null = null;
      try {
        const response = await doFetch(url, {
          method,
          headers,
          body: init.body,
          signal: AbortSignal.timeout(timeout),
        });
        const body = Buffer.from(await response.arrayBuffer());
        const request: FormscheckRequest = {
          name,
          step,
          method,
          path,
          ms: Math.round(now() - started),
          status: response.status,
          bytes: body.length,
        };
        if (response.status < 200 || response.status > 299) {
          const json = parseJson(body);
          request.error =
            isRecord(json) && typeof json.error === "string"
              ? json.error
              : `HTTP ${response.status}`;
        }
        if (response.status === 429)
          retryAfter = response.headers.get("retry-after");
        sent = { request, body };
      } catch (err) {
        sent = {
          request: {
            name,
            step,
            method,
            path,
            ms: Math.round(now() - started),
            status: null,
            bytes: 0,
            error: (err as Error).message,
          },
        };
      }
      requests.push(sent.request);
      if (sent.request.status !== 429 || attempt >= MAX_RETRIES) return sent;
      const retry = Number(retryAfter);
      if (Number.isFinite(retry) && retry > 0)
        nextAt = Math.max(
          nextAt,
          now() + Math.min(retry * 1000, MAX_RETRY_WAIT_MS),
        );
    }
  }

  /** "HTTP 404 on GET /x (No such route.)", for a failure. */
  function failed({ request }: Sent): string {
    const status = request.status ?? "no response";
    const why =
      request.error && request.error !== `HTTP ${request.status}`
        ? ` (${request.error})`
        : "";
    return `${status} on ${request.method} ${request.path}${why}`;
  }

  const ok = ({ request }: Sent) =>
    request.status !== null && request.status >= 200 && request.status <= 299;
  const timed = ({ request }: Sent): Timed => ({
    ms: request.ms,
    bytes: request.bytes,
  });

  async function checkName(name: string): Promise<NameReport> {
    const report: NameReport = { name, operations: [], failures: [] };
    const failures = report.failures;

    // 1. The Lookup: an Index answer, which must be Resolved.
    const lookup = await send(name, "lookup", "/api/lookup", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const outcome = parseJson(lookup.body);
    report.lookup = {
      ...timed(lookup),
      outcome:
        isRecord(outcome) && typeof outcome.outcome === "string"
          ? outcome.outcome
          : undefined,
    };
    if (!ok(lookup)) {
      failures.push(`lookup: ${failed(lookup)}`);
      return report;
    }
    if (report.lookup.outcome !== "Resolved") {
      failures.push(
        `lookup: the Outcome is ${report.lookup.outcome ?? "missing"}, not Resolved`,
      );
      return report;
    }
    const resolved = outcome as ResolvedAnswer;
    const apiId = resolved.api?.id;
    const spec = resolved.currentSpec;
    if (!apiId || !spec?.id || !spec.downloads) {
      failures.push(
        "lookup: the Resolved Outcome has no API id or Current Spec",
      );
      return report;
    }
    report.apiId = apiId;
    report.vendorId = resolved.api.vendorId;
    report.specId = spec.id;
    const outlinePath = `${apiPath(apiId, "outline")}?specId=${spec.id}`;

    // 2. Pending forms: the outline, every 5 s, until they're built.
    if (spec.normalized === "failed") {
      failures.push(
        "lookup: the Current Spec's Normalized Form failed to build",
      );
      return report;
    }
    if (spec.normalized === "pending") {
      const started = now();
      const polls = PENDING_WAIT_MS / PENDING_POLL_MS;
      let poll = await send(name, "pending", outlinePath);
      for (let i = 0; i < polls && poll.request.status === 409; i++) {
        await sleep(PENDING_POLL_MS);
        poll = await send(name, "pending", outlinePath);
      }
      report.pendingWaitMs = Math.round(now() - started);
      if (poll.request.status === 409) {
        failures.push(
          `the forms were still pending after ${duration(PENDING_WAIT_MS)}`,
        );
        return report;
      }
      if (!ok(poll)) {
        failures.push(`waiting for the forms: ${failed(poll)}`);
        return report;
      }
    }

    // 3. Both forms, from the Outcome's downloads.
    const published = await send(name, "published", spec.downloads.published);
    if (ok(published)) {
      const sha = createHash("sha256")
        .update(published.body as Buffer)
        .digest("hex");
      report.published = {
        ...timed(published),
        sha256Matches: sha === spec.id,
      };
      if (sha !== spec.id)
        failures.push(
          `published: the sha256 of the bytes is ${sha}, not the Spec id ${spec.id}`,
        );
    } else failures.push(`published: ${failed(published)}`);

    const normalized = await send(
      name,
      "normalized",
      spec.downloads.normalized,
    );
    if (ok(normalized)) {
      const doc = parseJson(normalized.body);
      const openapi =
        isRecord(doc) && typeof doc.openapi === "string"
          ? doc.openapi
          : undefined;
      report.normalized = { ...timed(normalized), openapi };
      if (doc === undefined)
        failures.push("normalized: the Normalized Form isn't JSON");
      else if (!openapi || !/^3\.1\.\d+$/.test(openapi))
        failures.push(
          `normalized: openapi is ${openapi ?? "missing"}, not 3.1.x`,
        );
    } else failures.push(`normalized: ${failed(normalized)}`);

    // 4. The outline.
    const outline = await send(name, "outline", outlinePath);
    const outlineJson = parseJson(outline.body);
    const operations =
      isRecord(outlineJson) &&
      isRecord(outlineJson.outline) &&
      Array.isArray(outlineJson.outline.operations)
        ? (outlineJson.outline.operations as unknown[]).filter(
            (o): o is { method: string; path: string } =>
              isRecord(o) &&
              typeof o.method === "string" &&
              typeof o.path === "string",
          )
        : undefined;
    if (!ok(outline)) failures.push(`outline: ${failed(outline)}`);
    else if (!operations)
      failures.push("outline: the answer has no operations");
    else {
      report.outline = {
        ...timed(outline),
        operationCount: operations.length,
      };
      if (operations.length === 0)
        failures.push("outline: the Spec Outline lists no operations");

      // 5. The first, the last and 3 evenly spaced operations.
      for (const { method, path } of pickOperations(operations)) {
        const query = new URLSearchParams({ method, path, specId: spec.id });
        const operation = await send(
          name,
          "operation",
          `${apiPath(apiId, "operation")}?${query}`,
        );
        if (!ok(operation)) {
          failures.push(`operation: ${failed(operation)}`);
          continue;
        }
        const json = parseJson(operation.body);
        report.operations.push({
          ...timed(operation),
          method,
          path,
          truncated: isRecord(json) && json.truncated === true,
        });
      }
    }

    // 6. The Vendor's APIs, which must list the API.
    const vendorApis = await send(
      name,
      "vendor-apis",
      `/api/vendors/${encodeURIComponent(resolved.api.vendorId)}/apis`,
    );
    if (ok(vendorApis)) {
      const json = parseJson(vendorApis.body);
      const listed =
        isRecord(json) &&
        Array.isArray(json.apis) &&
        json.apis.some(
          (a: unknown) => isRecord(a) && isRecord(a.api) && a.api.id === apiId,
        );
      report.vendorApis = { ...timed(vendorApis), listed };
      if (!listed)
        failures.push(
          `vendor APIs: ${resolved.api.vendorId}'s APIs don't list ${apiId}`,
        );
    } else failures.push(`vendor APIs: ${failed(vendorApis)}`);

    return report;
  }

  const names: NameReport[] = [];
  for (const name of options.names) names.push(await checkName(name));
  return formscheckReport(options.baseUrl, names, requests);
}
