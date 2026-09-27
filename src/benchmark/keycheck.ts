import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

/** The name looked up when `--name` isn't given: in the Index, with a small Spec. */
export const DEFAULT_NAME = "Val Town";
/** A request that takes longer than this is an error (Discovery included). */
const REQUEST_TIMEOUT_MS = 120_000;

export const KEYCHECK_USAGE = `usage: KEYCHECK_KEY=sb_… pnpm tsx scripts/keycheck.ts <baseUrl> [--name "${DEFAULT_NAME}"] [--json]

Checks API keys on a deployment with POST <baseUrl>/api/lookup, in order:

  1. the name without a key: 200 (an answer from the Index);
  2. the same with KEYCHECK_KEY: 200, and the key's credits don't change;
  3. the name with fresh: true (Discovery) and KEYCHECK_KEY: 200, and it
     spends one credit. This USES ONE OF THE KEY'S CREDITS;
  4. the name with a made-up sb_ key: 401.

The name must already be in the Index: when step 1 isn't 200, steps 2
and 3 are skipped, spending nothing. With UNKEY_ROOT_KEY set, the key's
credits are read before and after through Unkey's admin API (keys.whoami);
without it, the credit checks are skipped and step 3 reports the
x-quota-remaining header.

  --name <name>   the API to look up (default "${DEFAULT_NAME}")
  --json          print the whole report

Exits 1 when a check fails, 2 on bad arguments.`;

/** The options of `scripts/keycheck.ts`, once validated. */
export type KeycheckOptions = {
  /** The deployment, without a trailing slash. */
  baseUrl: string;
  name: string;
  /** The key checked (`KEYCHECK_KEY`). */
  key: string;
  /** Unkey's root key (`UNKEY_ROOT_KEY`), to read the key's credits. */
  rootKey?: string;
  json: boolean;
};

export type ParsedKeycheckArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: KeycheckOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedKeycheckArgs {
  return { ok: false, error, exitCode: 2 };
}

/**
 * Parses and validates the `scripts/keycheck.ts` arguments without running
 * anything. The key comes from `KEYCHECK_KEY` in `env` and is required;
 * `UNKEY_ROOT_KEY`, if set, is how credits are read.
 */
export function parseKeycheckArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): ParsedKeycheckArgs {
  let values: { name?: string; json?: boolean; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        name: { type: "string" },
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

  const name = (values.name ?? DEFAULT_NAME).trim();
  if (!name) return fail("--name must name an API");

  const key = env.KEYCHECK_KEY?.trim();
  if (!key) return fail("set KEYCHECK_KEY to the API key to check");
  const rootKey = env.UNKEY_ROOT_KEY?.trim();
  return {
    ok: true,
    help: false,
    options: {
      baseUrl: url.href.replace(/\/+$/, ""),
      name,
      key,
      rootKey: rootKey || undefined,
      json: values.json ?? false,
    },
  };
}

/** One Lookup the check made, and what it expected. */
export type KeycheckStep = {
  /** In words: `keyless Index Lookup`, … */
  check: string;
  /** The status it must answer. */
  expected: number;
  /** The status it answered; absent when the request failed. */
  status?: number;
  /** Wall-clock milliseconds, rounded, until the body was read. */
  ms: number;
  /** In words, what it found: the Outcome, the credits, … */
  note?: string;
  /** Why it failed, for a step that did. */
  error?: string;
};

export type KeycheckReport = {
  baseUrl: string;
  name: string;
  /** Whether the key's credits were read through Unkey's admin API. */
  creditsRead: boolean;
  steps: KeycheckStep[];
  /** What failed, in words; empty when every check passed. */
  failures: string[];
  pass: boolean;
};

/** `320 ms` under a second, `14.2 s` from there. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The report as text: a line per step, then the verdict. */
export function keycheckLines(report: KeycheckReport): string[] {
  const lines = [
    `Key check: ${report.baseUrl}/api/lookup ("${report.name}")`,
    report.creditsRead
      ? "Credits read through Unkey's admin API."
      : "Credits not read (UNKEY_ROOT_KEY not set): the credit checks are skipped.",
    "",
  ];
  for (const s of report.steps) {
    const got = s.status === undefined ? "---" : String(s.status);
    const found = s.error ? `ERROR ${s.error}` : (s.note ?? "");
    lines.push(
      `  ${s.check.padEnd(26)} ${got} (want ${s.expected}) in ${duration(s.ms).padStart(7)}${found ? ` · ${found}` : ""}`,
    );
  }
  lines.push("");
  if (report.pass) lines.push("PASS");
  else {
    lines.push("FAIL");
    for (const f of report.failures) lines.push(`  ${f}`);
  }
  return lines;
}

/** What the check runs on; tests pass their own `fetch` and credit reader. */
export type KeycheckDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * The key's remaining credits, read without spending any (Unkey's
   * `keys.whoami`); `null` for a key without credits. Absent: not read.
   */
  readCredits?: () => Promise<number | null>;
  /** The made-up key sent in step 4; random by default. */
  madeUpKey?: string;
};

/** A key no store issued: `sb_keycheck` and 24 random hex digits. */
export function madeUpKey(): string {
  return `sb_keycheck${randomBytes(12).toString("hex")}`;
}

/**
 * Runs the key check against `options.baseUrl`, one Lookup at a time, and
 * returns the report. It spends one of the key's credits (the Discovery).
 */
export async function runKeycheck(
  options: KeycheckOptions,
  deps: KeycheckDeps = {},
): Promise<KeycheckReport> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => performance.now());
  const steps: KeycheckStep[] = [];
  const failures: string[] = [];

  /** One Lookup, timed; a status other than `expected` is a failure. */
  async function lookup(
    check: string,
    expected: number,
    body: Record<string, unknown>,
    key?: string,
  ): Promise<{ step: KeycheckStep; headers?: Headers; json?: unknown }> {
    const started = now();
    const step: KeycheckStep = { check, expected, ms: 0 };
    steps.push(step);
    try {
      const response = await doFetch(`${options.baseUrl}/api/lookup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      step.ms = Math.round(now() - started);
      step.status = response.status;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {}
      if (response.status !== expected) {
        const said =
          isRecord(json) && typeof json.error === "string"
            ? `: ${json.error}`
            : "";
        step.error = `answered ${response.status}${said}`;
        failures.push(`${check}: answered ${response.status}, not ${expected}`);
      } else if (isRecord(json) && typeof json.outcome === "string")
        step.note = json.outcome;
      return { step, headers: response.headers, json };
    } catch (err) {
      step.ms = Math.round(now() - started);
      step.error = (err as Error).message;
      failures.push(`${check}: ${step.error}`);
      return { step };
    }
  }

  /** The key's credits, or `undefined` when they aren't read or can't be. */
  async function credits(when: string): Promise<number | null | undefined> {
    if (!deps.readCredits) return undefined;
    try {
      return await deps.readCredits();
    } catch (err) {
      failures.push(
        `reading the key's credits ${when}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  /** Appends `text` to a step's note. */
  function note(step: KeycheckStep, text: string) {
    step.note = step.note ? `${step.note} · ${text}` : text;
  }

  const { name, key } = options;

  /** Steps 2 and 3: the key on an Index answer (no credit), then on a Discovery (one). */
  async function keyed() {
    // 2. Keyed, from the Index: verified at cost 0.
    const before = await credits("before the keyed Index Lookup");
    const indexed = await lookup("keyed Index Lookup", 200, { name }, key);
    const afterIndex = await credits("after the keyed Index Lookup");
    if (typeof before === "number" && typeof afterIndex === "number") {
      note(indexed.step, `credits ${before} → ${afterIndex}`);
      if (afterIndex !== before)
        failures.push(
          `keyed Index Lookup: the key's credits went from ${before} to ${afterIndex}; an Index answer spends none`,
        );
    }

    // 3. Keyed Discovery: verified at cost 1.
    const discovery = await lookup(
      "keyed Discovery Lookup",
      200,
      { name, fresh: true },
      key,
    );
    const afterDiscovery = await credits("after the keyed Discovery Lookup");
    const header = discovery.headers?.get("x-quota-remaining");
    if (
      discovery.step.status === 200 &&
      header !== null &&
      header !== undefined
    )
      note(discovery.step, `x-quota-remaining ${header}`);
    if (typeof afterIndex === "number" && typeof afterDiscovery === "number") {
      note(discovery.step, `credits ${afterIndex} → ${afterDiscovery}`);
      if (afterDiscovery !== afterIndex - 1)
        failures.push(
          `keyed Discovery Lookup: the key's credits went from ${afterIndex} to ${afterDiscovery}; a Discovery spends one`,
        );
    }
    if ([before, afterIndex, afterDiscovery].includes(null))
      failures.push(
        "the key has no credits (unlimited): its Discovery Lookups aren't counted",
      );
  }

  // 1. Keyless: only the Index can answer it. When it doesn't, the keyed
  // "Index" Lookup would be a Discovery: skip both rather than spend.
  const keyless = await lookup("keyless Index Lookup", 200, { name });
  if (keyless.step.status === 200) await keyed();
  else
    failures.push(
      `"${name}" isn't answered from the Index: the keyed Lookups were skipped (pick a name the Index knows with --name)`,
    );

  // 4. A key no store issued.
  await lookup("made-up sb_ key", 401, { name }, deps.madeUpKey ?? madeUpKey());

  return {
    baseUrl: options.baseUrl,
    name,
    creditsRead: deps.readCredits !== undefined,
    steps,
    failures,
    pass: failures.length === 0,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
