import { parseArgs } from "node:util";
import { latencyOf } from "./latency";

/** Index answers must reach this p90, in ms. */
export const INDEX_TARGET_MS = 200;
/** Discovery answers must reach this p90, in ms. */
export const DISCOVERY_TARGET_MS = 15_000;
/** Rounds of the Index phase when `--rounds` isn't given. */
export const DEFAULT_ROUNDS = 5;
/** Requests a second when `--rps` isn't given: under the default 60/min per-IP limit. */
export const DEFAULT_RPS = 0.8;
/** A request that takes longer than this is an error. */
export const REQUEST_TIMEOUT_MS = { discovery: 120_000, index: 10_000 };
/** The longest `retry-after` the loop waits for after a rate-limit 429. */
const MAX_RETRY_WAIT_MS = 60_000;

export const LOADCHECK_USAGE = `usage: pnpm tsx scripts/loadcheck.ts <baseUrl> [--key <secret>] [--only discovery|index] [--rounds N] [--rps R] [--json]

Measures POST <baseUrl>/api/lookup and checks the p90 targets:
Discovery < ${DISCOVERY_TARGET_MS / 1000} s, Index answers < ${INDEX_TARGET_MS} ms.

  Discovery phase  one fresh Lookup per Benchmark entry, one at a time, with the
                   API key. It uses ONE QUOTA UNIT PER ENTRY (every entry of
                   benchmark/entries.json), so issue the key with a quota that
                   covers them (pnpm tsx scripts/keys.ts create <owner> --quota N).
                   It also fills the Index for the next phase.
  Index phase      --rounds rounds over the names Discovery answered Resolved
                   (with --only index: every Benchmark name, skipping those
                   that come back 401), without a key.

  --key <secret>   the API key for Discovery (or env LOADCHECK_KEY)
  --only <phase>   run only discovery or only index (index needs no key)
  --rounds N       Index phase rounds (default ${DEFAULT_ROUNDS})
  --rps R          requests a second, at most (default ${DEFAULT_RPS}, under the
                   default 60/min per-IP limit)
  --json           print the whole report, with every request

Exits 1 when a phase misses its target, 2 on bad arguments.`;

export type LoadcheckPhase = "discovery" | "index";

/** The options of `scripts/loadcheck.ts`, once validated. */
export type LoadcheckOptions = {
  /** The deployment, without a trailing slash. */
  baseUrl: string;
  key?: string;
  only?: LoadcheckPhase;
  rounds: number;
  rps: number;
  json: boolean;
};

export type ParsedLoadcheckArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: LoadcheckOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedLoadcheckArgs {
  return { ok: false, error, exitCode: 2 };
}

/**
 * Parses and validates the `scripts/loadcheck.ts` arguments without running
 * anything. The key comes from `--key`, else `LOADCHECK_KEY` in `env`.
 */
export function parseLoadcheckArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): ParsedLoadcheckArgs {
  let values: {
    key?: string;
    only?: string;
    rounds?: string;
    rps?: string;
    json?: boolean;
    help?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        key: { type: "string" },
        only: { type: "string" },
        rounds: { type: "string" },
        rps: { type: "string" },
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

  const only = values.only;
  if (only !== undefined && only !== "discovery" && only !== "index")
    return fail(`--only must be discovery or index (got "${only}")`);

  const rounds =
    values.rounds === undefined
      ? DEFAULT_ROUNDS
      : /^\d+$/.test(values.rounds)
        ? Number(values.rounds)
        : 0;
  if (!Number.isSafeInteger(rounds) || rounds < 1)
    return fail(`--rounds must be a positive integer (got "${values.rounds}")`);

  const rps =
    values.rps === undefined
      ? DEFAULT_RPS
      : /^\d*\.?\d+$/.test(values.rps)
        ? Number(values.rps)
        : 0;
  if (!Number.isFinite(rps) || rps <= 0)
    return fail(`--rps must be a positive number (got "${values.rps}")`);

  const key = values.key ?? env.LOADCHECK_KEY;
  if (key !== undefined && !key.trim())
    return fail("--key (or LOADCHECK_KEY) is empty");
  if (only !== "index" && key === undefined)
    return fail(
      "the Discovery phase needs an API key: pass --key or set LOADCHECK_KEY, or use --only index",
    );

  return {
    ok: true,
    help: false,
    options: {
      baseUrl: url.href.replace(/\/+$/, ""),
      key: key?.trim(),
      only: only as LoadcheckPhase | undefined,
      rounds,
      rps,
      json: values.json ?? false,
    },
  };
}

/** One request the load check sent. */
export type LoadcheckRequest = {
  name: string;
  phase: LoadcheckPhase;
  /** Wall-clock milliseconds, rounded, until the whole body was read. */
  ms: number;
  /** HTTP status; `null` when no response came (network error, timeout). */
  status: number | null;
  /** The Outcome kind of a 200 answer. */
  outcome?: string;
  /** Why it failed, for a request that did. */
  error?: string;
};

/** One phase's numbers, over its 200 answers. */
export type PhaseReport = {
  phase: LoadcheckPhase;
  /** The p90 this phase must stay under, in ms. */
  targetMs: number;
  /** Requests sent. */
  requests: number;
  /** 200 answers, the ones measured. */
  count: number;
  p50: number;
  p90: number;
  max: number;
  /** Failed requests other than 429s (and other than skipped 401s). */
  errors: number;
  /** 429 answers: the rate limit or the key's daily quota. */
  rateLimited: number;
  /** 401 answers of `--only index`: names the Index doesn't hold. */
  skipped: number;
  /** p90 under the target, over at least one answer. */
  pass: boolean;
};

export type LoadcheckReport = {
  baseUrl: string;
  discovery?: PhaseReport;
  index?: PhaseReport;
  /** Every phase that ran passed. */
  pass: boolean;
  requests: LoadcheckRequest[];
};

/**
 * A phase's report from its requests. Only 200 answers are measured; a phase
 * with none fails. With `skip401`, 401s are skipped names, not errors.
 */
export function phaseReport(
  phase: LoadcheckPhase,
  requests: readonly LoadcheckRequest[],
  { skip401 = false }: { skip401?: boolean } = {},
): PhaseReport {
  const mine = requests.filter((r) => r.phase === phase);
  const answered = mine.filter((r) => r.status === 200);
  const rateLimited = mine.filter((r) => r.status === 429).length;
  const skipped = skip401 ? mine.filter((r) => r.status === 401).length : 0;
  const targetMs = phase === "index" ? INDEX_TARGET_MS : DISCOVERY_TARGET_MS;
  const latency = latencyOf(answered.map((r) => r.ms));
  return {
    phase,
    targetMs,
    requests: mine.length,
    ...latency,
    errors: mine.length - answered.length - rateLimited - skipped,
    rateLimited,
    skipped,
    pass: latency.count > 0 && latency.p90 < targetMs,
  };
}

/** The whole report; `pass` when every phase that ran passed. */
export function loadcheckReport(
  baseUrl: string,
  requests: LoadcheckRequest[],
  { only }: { only?: LoadcheckPhase } = {},
): LoadcheckReport {
  const discovery =
    only === "index" ? undefined : phaseReport("discovery", requests);
  const index =
    only === "discovery"
      ? undefined
      : phaseReport("index", requests, { skip401: only === "index" });
  const phases = [discovery, index].filter((p) => p !== undefined);
  return {
    baseUrl,
    discovery,
    index,
    pass: phases.length > 0 && phases.every((p) => p.pass),
    requests,
  };
}

/** `320 ms` under a second, `14.2 s` from there. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The report as text, one line per phase. */
export function reportLines(report: LoadcheckReport): string[] {
  const lines = [`Load check: ${report.baseUrl}`];
  for (const p of [report.discovery, report.index]) {
    if (!p) continue;
    const label = p.phase === "discovery" ? "Discovery" : "Index    ";
    const skipped = p.skipped > 0 ? ` · ${p.skipped} skipped (401)` : "";
    lines.push(
      `${label}  n=${p.count}/${p.requests}  p50 ${duration(p.p50)} · p90 ${duration(p.p90)} · max ${duration(p.max)}  errors ${p.errors} · 429s ${p.rateLimited}${skipped}  p90 < ${duration(p.targetMs)}: ${p.pass ? "PASS" : "FAIL"}`,
    );
  }
  return lines;
}

/** What the load check runs on; tests pass their own `sleep` and `warn`. */
export type LoadcheckDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  warn?: (message: string) => void;
};

/**
 * Runs the phases `options` asks for over the Benchmark `names` and returns
 * the report. Requests go one at a time, each start at least `1 / rps`
 * seconds after the previous one; after a rate-limit 429 the loop also waits
 * out its `retry-after`. Discovery stops early once the key's daily quota is
 * used.
 */
export async function runLoadcheck(
  options: LoadcheckOptions,
  names: readonly string[],
  deps: LoadcheckDeps = {},
): Promise<LoadcheckReport> {
  const doFetch = deps.fetch ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => performance.now());
  const warn = deps.warn ?? ((m: string) => console.error(m));
  const url = `${options.baseUrl}/api/lookup`;
  const intervalMs = 1000 / options.rps;
  const requests: LoadcheckRequest[] = [];
  let nextAt = 0;

  async function send(
    phase: LoadcheckPhase,
    name: string,
  ): Promise<{ request: LoadcheckRequest; response?: Response }> {
    const wait = nextAt - now();
    if (wait > 0) await sleep(wait);
    const started = now();
    nextAt = started + intervalMs;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (phase === "discovery") headers.authorization = `Bearer ${options.key}`;
    const body = JSON.stringify(
      phase === "discovery" ? { name, fresh: true } : { name },
    );
    let request: LoadcheckRequest;
    let response: Response | undefined;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS[phase]),
      });
      const text = await response.text();
      const ms = Math.round(now() - started);
      request = { name, phase, ms, status: response.status };
      let json: { outcome?: unknown; error?: unknown } | undefined;
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON: keep the status only.
      }
      if (response.status === 200 && typeof json?.outcome === "string")
        request.outcome = json.outcome;
      if (response.status !== 200)
        request.error =
          typeof json?.error === "string"
            ? json.error
            : `HTTP ${response.status}`;
    } catch (err) {
      request = {
        name,
        phase,
        ms: Math.round(now() - started),
        status: null,
        error: (err as Error).message,
      };
    }
    requests.push(request);
    if (response?.status === 429 && !response.headers.has("x-quota-limit")) {
      const retry = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retry) && retry > 0)
        nextAt = Math.max(
          nextAt,
          now() + Math.min(retry * 1000, MAX_RETRY_WAIT_MS),
        );
    }
    return { request, response };
  }

  let indexNames: string[] = [...names];
  if (options.only !== "index") {
    const resolved: string[] = [];
    for (const [i, name] of names.entries()) {
      const { request, response } = await send("discovery", name);
      if (request.outcome === "Resolved") resolved.push(name);
      const remaining = Number(response?.headers.get("x-quota-remaining"));
      const left = names.length - i - 1;
      if (i === 0 && Number.isFinite(remaining) && remaining < left)
        warn(
          `The key has ${remaining} Lookups left today; Discovery needs ${left} more.`,
        );
      if (response?.status === 429 && response.headers.has("x-quota-limit")) {
        warn(
          `The key's daily quota is used; Discovery stopped after ${i + 1} of ${names.length}.`,
        );
        break;
      }
    }
    indexNames = resolved;
  }

  if (options.only !== "discovery") {
    const skip = new Set<string>();
    for (let round = 0; round < options.rounds; round++) {
      for (const name of indexNames) {
        if (skip.has(name)) continue;
        const { request } = await send("index", name);
        if (options.only === "index" && request.status === 401) skip.add(name);
      }
    }
  }

  return loadcheckReport(options.baseUrl, requests, { only: options.only });
}
