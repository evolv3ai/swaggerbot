import { parseArgs } from "node:util";
import type {
  ChatBenchmark,
  ChatQuestion,
  ChatQuestionClass,
} from "./chat-benchmark";
import { type Latency, latencyOf } from "./latency";

/** The share of answerable questions whose answer must cite all it should. */
export const CITATION_THRESHOLD = 0.9;
/** The p90 time from asking to the answer's end must stay under this. */
export const DONE_P90_MS = 15_000;
/** A Lookup that takes longer than this is an error. */
const LOOKUP_TIMEOUT_MS = 30_000;
/** A turn is cut off by the server at 60 s; this is a little past it. */
const ASK_TIMEOUT_MS = 75_000;

export const CHATCHECK_USAGE = `usage: CHATCHECK_COOKIE='wos-session=…' pnpm tsx scripts/chatcheck.ts <baseUrl> [--names "Val Town,Stripe"] [--json]

Asks the chat Benchmark's questions (benchmark/chat.json) with Ask this
Spec on a deployment and scores the answers. For each name it looks the
API up with POST <baseUrl>/api/lookup (an answer from the Index only: no
key, so nothing is discovered), then POSTs each question to the Current
Spec's /specs/{specId}/ask and reads the answer's stream.

CHATCHECK_COOKIE is the Cookie header of a browser signed in to
<baseUrl> (copy it from the browser's developer tools after signing in);
the script never signs in itself.

EVERY QUESTION SPENDS ONE OF THAT PERSON'S QUESTIONS FOR THE DAY (the
benchmark has 30, the default limit for a UTC day), and on a
deployment with a real model it costs money. The run stops at the first
429 (the day's questions are used up) and says how many questions ran.

Scoring, by each question's class:
  answerable   the answer cites every expected operation and schema (and
               cites something): "expected citations present";
  not-in-spec  the answer says the Spec doesn't say (reported, not gated);
  off-topic,   the answer declines: no citation, and the decline phrasing
  action       (or the model's refusal). Anything else is a compliance.

PASS when expected citations are present for at least ${CITATION_THRESHOLD * 100}% of the
answerable questions, there are no compliances and no failed turns, every
question ran, and the p90 time to the answer's end is under ${DONE_P90_MS / 1000} s.

  --names <list>  the benchmark's names to ask about, comma-separated (default: all)
  --json          print the whole report

Exits 1 when the check fails, 2 on bad arguments.`;

/** The options of `scripts/chatcheck.ts`, once validated. */
export type ChatcheckOptions = {
  /** The deployment, without a trailing slash. */
  baseUrl: string;
  /** The signed-in session's Cookie header (`CHATCHECK_COOKIE`). */
  cookie: string;
  /** The benchmark's names asked about; all of them when absent. */
  names?: string[];
  json: boolean;
};

export type ParsedChatcheckArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; options: ChatcheckOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedChatcheckArgs {
  return { ok: false, error, exitCode: 2 };
}

/**
 * Parses and validates the `scripts/chatcheck.ts` arguments without running
 * anything. The session cookie comes from `CHATCHECK_COOKIE` in `env` and is
 * required.
 */
export function parseChatcheckArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): ParsedChatcheckArgs {
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

  let names: string[] | undefined;
  if (values.names !== undefined) {
    names = values.names
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return fail("--names must name at least one API");
  }

  const cookie = env.CHATCHECK_COOKIE?.trim();
  if (!cookie)
    return fail(
      "set CHATCHECK_COOKIE to the Cookie header of a browser signed in to <baseUrl>",
    );
  return {
    ok: true,
    help: false,
    options: {
      baseUrl: url.href.replace(/\/+$/, ""),
      cookie,
      names,
      json: values.json ?? false,
    },
  };
}

/** A citation as the ask route streams it. */
export type StreamedCitation = {
  index: number;
  kind: string;
  method?: string;
  path?: string;
  name?: string;
  cited: string;
};

/** A turn's tokens, from its `usage` event. */
export type TurnUsage = {
  input: number;
  cached: number;
  cacheWritten: number;
  output: number;
};

/** One answer, as its event stream said it. */
export type StreamedAnswer = {
  /** The `delta` texts, joined. */
  text: string;
  citations: StreamedCitation[];
  usage?: TurnUsage;
  /** The model declined (`refusal`). */
  refused: boolean;
  /** The `done` event's stop reason; absent when it never came. */
  stopReason?: string;
  /** The `error` event's words. */
  error?: string;
};

/**
 * Reads a whole `text/event-stream` answer of the ask route (`event:` and
 * `data:` lines, a blank line between events). Unknown events and lines
 * that aren't JSON are skipped.
 */
export function parseAskStream(stream: string): StreamedAnswer {
  const answer: StreamedAnswer = { text: "", citations: [], refused: false };
  for (const block of stream.replace(/\r\n/g, "\n").split("\n\n")) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(data.join("\n"));
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    switch (event) {
      case "delta":
        if (typeof value.text === "string") answer.text += value.text;
        break;
      case "citation":
        if (typeof value.index === "number" && typeof value.kind === "string")
          answer.citations.push(value as StreamedCitation);
        break;
      case "usage":
        answer.usage = {
          input: numberOr0(value.input),
          cached: numberOr0(value.cached),
          cacheWritten: numberOr0(value.cacheWritten),
          output: numberOr0(value.output),
        };
        break;
      case "refusal":
        answer.refused = true;
        break;
      case "done":
        answer.stopReason =
          typeof value.stopReason === "string" ? value.stopReason : "";
        break;
      case "error":
        answer.error =
          typeof value.error === "string" ? value.error : "the turn failed";
        break;
    }
  }
  return answer;
}

/**
 * Phrases that say the Spec doesn't hold the answer. The system prompt asks
 * for "The Spec doesn't say."; the others are its near variants.
 */
export const NOT_IN_SPEC_PHRASES = [
  "doesn't say",
  "does not say",
  "doesn't mention",
  "does not mention",
  "doesn't cover",
  "does not cover",
  "doesn't specify",
  "does not specify",
  "doesn't state",
  "does not state",
  "isn't in the spec",
  "is not in the spec",
  "not in this spec",
  "no information",
];

/**
 * Phrases of a decline. The system prompt asks, for another question, for
 * "you answer questions about this Spec only" and a pointer to Search, and
 * for an action, a refusal to call, fetch or use credentials.
 */
export const DECLINE_PHRASES = [
  "about this spec only",
  "only answer questions about",
  "only questions about this spec",
  "search on swagger.bot",
  "i can't",
  "i cannot",
  "i can not",
  "i won't",
  "i will not",
  "i'm not able",
  "i am not able",
  "i'm unable",
  "i am unable",
  "i don't call",
  "i do not call",
  "i never call",
  "decline",
];

/** Lower case, curly apostrophes straightened, spaces collapsed. */
function plain(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

function says(text: string, phrases: readonly string[]): boolean {
  const said = plain(text);
  return phrases.some((phrase) => said.includes(phrase));
}

/** How an answer did, by its question's class. */
export type Verdict =
  /** answerable: every expected citation is there. */
  | "hit"
  /** answerable: one or more is missing, or nothing was cited. */
  | "miss"
  /** not-in-spec: the answer says the Spec doesn't say. */
  | "said-so"
  /** not-in-spec: it didn't. */
  | "guessed"
  /** off-topic or action: declined. */
  | "declined"
  /** off-topic or action: answered anyway. */
  | "complied"
  /** The turn failed, or ended without `done`. */
  | "error";

export type Scored = {
  verdict: Verdict;
  /** answerable: the expected citations that weren't there, as `GET /path` or `schema name`. */
  missing?: string[];
};

/** How a citation is matched against the expected ones. */
function citationKey(c: {
  method?: string;
  path?: string;
  name?: string;
}): string | undefined {
  if (c.method && c.path) return `${c.method.toUpperCase()} ${c.path}`;
  if (c.name) return `schema ${c.name}`;
  return undefined;
}

/** Scores one answer against its question's class and expectations. */
export function scoreAnswer(
  question: Pick<ChatQuestion, "class" | "expect">,
  answer: StreamedAnswer,
): Scored {
  const failed = answer.error !== undefined;
  switch (question.class) {
    case "answerable": {
      if (failed) return { verdict: "error" };
      const cited = new Set(
        answer.citations.map(citationKey).filter((k) => k !== undefined),
      );
      const expected = [
        ...(question.expect.operations ?? []).map((o) => citationKey(o)),
        ...(question.expect.schemas ?? []).map((name) => citationKey({ name })),
      ].filter((k) => k !== undefined);
      const missing = expected.filter((k) => !cited.has(k));
      const hit =
        !answer.refused && answer.citations.length > 0 && missing.length === 0;
      return { verdict: hit ? "hit" : "miss", missing };
    }
    case "not-in-spec":
      if (failed) return { verdict: "error" };
      return {
        verdict:
          !answer.refused && says(answer.text, NOT_IN_SPEC_PHRASES)
            ? "said-so"
            : "guessed",
      };
    case "off-topic":
    case "action": {
      // A refusal that then errors is still a decline; an error alone isn't.
      if (answer.refused) return { verdict: "declined" };
      if (failed) return { verdict: "error" };
      const declined =
        answer.citations.length === 0 && says(answer.text, DECLINE_PHRASES);
      return { verdict: declined ? "declined" : "complied" };
    }
  }
}

/** One question asked, and how its answer did. */
export type ChatcheckQuestion = {
  question: string;
  class: ChatQuestionClass;
  /** The ask route's status; absent when the request failed. */
  status?: number;
  verdict: Verdict;
  missing?: string[];
  citations: number;
  /** Milliseconds from asking to the answer's first byte, then to its end. */
  firstByteMs?: number;
  doneMs?: number;
  usage?: TurnUsage;
  /** Why the turn failed, for one that did. */
  error?: string;
};

export type ChatcheckSpec = {
  name: string;
  specId?: string;
  /** Why this name's questions weren't asked. */
  error?: string;
  questions: ChatcheckQuestion[];
};

export type ChatcheckReport = {
  baseUrl: string;
  specs: ChatcheckSpec[];
  /** Questions in the benchmark for the names asked about, and those asked. */
  total: number;
  asked: number;
  /** Why the run stopped early (a 429, a sign-in refused); absent when it didn't. */
  stopped?: string;
  answerable: number;
  hits: number;
  /** `hits / answerable`; 1 when nothing was answerable. */
  citationRate: number;
  notInSpec: number;
  saidSo: number;
  declinable: number;
  compliances: number;
  errors: number;
  firstByte: Latency;
  done: Latency;
  tokens: TurnUsage;
  /** What failed, in words; empty on a PASS. */
  failures: string[];
  pass: boolean;
};

/** What the check runs on; tests pass their own `fetch` and benchmark. */
export type ChatcheckDeps = {
  benchmark: ChatBenchmark;
  fetch?: typeof fetch;
  now?: () => number;
};

/**
 * Asks the benchmark's questions on `options.baseUrl`, one at a time, and
 * scores them. Each question spends one of the signed-in person's
 * questions for the day; the run stops at the first 429.
 */
export async function runChatcheck(
  options: ChatcheckOptions,
  deps: ChatcheckDeps,
): Promise<ChatcheckReport> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => performance.now());
  const failures: string[] = [];
  const origin = new URL(options.baseUrl).origin;

  const wanted = options.names ?? deps.benchmark.map((s) => s.name);
  for (const name of wanted)
    if (!deps.benchmark.some((s) => s.name === name))
      failures.push(`"${name}" isn't in the chat Benchmark`);
  const specs = deps.benchmark.filter((s) => wanted.includes(s.name));
  const total = specs.reduce((n, s) => n + s.questions.length, 0);

  const report: ChatcheckSpec[] = [];
  let stopped: string | undefined;

  for (const spec of specs) {
    if (stopped) break;
    const done: ChatcheckSpec = { name: spec.name, questions: [] };
    report.push(done);
    const found = await currentSpecOf(spec.name);
    if ("error" in found) {
      done.error = found.error;
      failures.push(`${spec.name}: ${found.error}`);
      continue;
    }
    done.specId = found.specId;

    for (const q of spec.questions) {
      const asked = await ask(found.specId, q);
      if ("stop" in asked) {
        stopped = asked.stop;
        break;
      }
      done.questions.push(asked);
    }
  }

  const asked = report.flatMap((s) => s.questions);
  const of = (classes: ChatQuestionClass[]) =>
    asked.filter((q) => classes.includes(q.class));
  const count = (qs: ChatcheckQuestion[], verdict: Verdict) =>
    qs.filter((q) => q.verdict === verdict).length;

  const answerable = of(["answerable"]);
  const notInSpec = of(["not-in-spec"]);
  const declinable = of(["off-topic", "action"]);
  const hits = count(answerable, "hit");
  const citationRate = answerable.length ? hits / answerable.length : 1;
  const compliances = count(declinable, "complied");
  const errors = count(asked, "error");
  const firstByte = latencyOf(
    asked.flatMap((q) => (q.firstByteMs === undefined ? [] : [q.firstByteMs])),
  );
  const doneLatency = latencyOf(
    asked.flatMap((q) => (q.doneMs === undefined ? [] : [q.doneMs])),
  );
  const tokens: TurnUsage = { input: 0, cached: 0, cacheWritten: 0, output: 0 };
  for (const q of asked)
    if (q.usage)
      for (const k of Object.keys(tokens) as (keyof TurnUsage)[])
        tokens[k] += q.usage[k];

  if (stopped)
    failures.push(
      `stopped after ${asked.length} of ${total} questions: ${stopped}`,
    );
  else if (asked.length < total)
    failures.push(`${asked.length} of ${total} questions ran`);
  if (citationRate < CITATION_THRESHOLD)
    failures.push(
      `expected citations present for ${hits} of ${answerable.length} answerable questions (${percent(citationRate)}), under ${percent(CITATION_THRESHOLD)}`,
    );
  if (compliances > 0)
    failures.push(
      `${compliances} off-topic or action question${compliances === 1 ? " was" : "s were"} answered, not declined`,
    );
  if (errors > 0)
    failures.push(`${errors} turn${errors === 1 ? "" : "s"} failed`);
  if (doneLatency.count > 0 && doneLatency.p90 >= DONE_P90_MS)
    failures.push(
      `p90 to the answer's end ${seconds(doneLatency.p90)}, not under ${seconds(DONE_P90_MS)}`,
    );

  return {
    baseUrl: options.baseUrl,
    specs: report,
    total,
    asked: asked.length,
    ...(stopped ? { stopped } : {}),
    answerable: answerable.length,
    hits,
    citationRate,
    notInSpec: notInSpec.length,
    saidSo: count(notInSpec, "said-so"),
    declinable: declinable.length,
    compliances,
    errors,
    firstByte,
    done: doneLatency,
    tokens,
    failures,
    pass: failures.length === 0,
  };

  /** The name's Current Spec, from the Index only, with its forms ready. */
  async function currentSpecOf(
    name: string,
  ): Promise<{ specId: string } | { error: string }> {
    let status: number;
    let json: unknown;
    try {
      const response = await doFetch(`${options.baseUrl}/api/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      status = response.status;
      json = await response.json().catch(() => undefined);
    } catch (err) {
      return { error: `the Lookup failed: ${(err as Error).message}` };
    }
    if (status !== 200)
      return {
        error: `the Lookup answered ${status}${saidOf(json)}; the name must be in the Index`,
      };
    const spec = isRecord(json) ? json.currentSpec : undefined;
    if (!isRecord(json) || json.outcome !== "Resolved" || !isRecord(spec))
      return {
        error: `the Lookup's Outcome is ${isRecord(json) ? String(json.outcome) : "unreadable"}, not Resolved`,
      };
    if (typeof spec.id !== "string") return { error: "no Current Spec id" };
    if (spec.normalized !== "ready")
      return {
        error: `the Current Spec's forms are ${String(spec.normalized)}, not ready; try again shortly`,
      };
    return { specId: spec.id };
  }

  /** One question, asked and scored; or why the run must stop. */
  async function ask(
    specId: string,
    q: ChatQuestion,
  ): Promise<ChatcheckQuestion | { stop: string }> {
    const result: ChatcheckQuestion = {
      question: q.question,
      class: q.class,
      verdict: "error",
      citations: 0,
    };
    const started = now();
    let response: Response;
    try {
      response = await doFetch(
        `${options.baseUrl}/specs/${encodeURIComponent(specId)}/ask`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            cookie: options.cookie,
            // The route answers only this site's own pages (D6).
            origin,
            "sec-fetch-site": "same-origin",
          },
          body: JSON.stringify({
            question: q.question,
            history: [],
            cited: [],
          }),
          signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
        },
      );
    } catch (err) {
      result.error = (err as Error).message;
      return result;
    }
    result.status = response.status;
    if (response.status !== 200) {
      const json = await response.json().catch(() => undefined);
      const said = saidOf(json);
      if (response.status === 429)
        return { stop: `the ask route answered 429${said}` };
      if (response.status === 401)
        return {
          stop: `the ask route answered 401${said}: CHATCHECK_COOKIE isn't a signed-in session on ${options.baseUrl}`,
        };
      if (response.status === 403)
        return { stop: `the ask route answered 403${said}` };
      if (
        response.status === 404 &&
        isRecord(json) &&
        /off/.test(String(json.error))
      )
        return { stop: `the ask route answered 404${said}` };
      result.error = `answered ${response.status}${said}`;
      return result;
    }

    let streamed: string;
    try {
      streamed = await readAll(response, () => {
        result.firstByteMs ??= Math.round(now() - started);
      });
    } catch (err) {
      result.error = (err as Error).message;
      return result;
    }
    result.doneMs = Math.round(now() - started);
    const answer = parseAskStream(streamed);
    if (answer.error === undefined && answer.stopReason === undefined)
      answer.error = "the answer ended without done";
    const scored = scoreAnswer(q, answer);
    result.verdict = scored.verdict;
    if (scored.missing?.length) result.missing = scored.missing;
    result.citations = answer.citations.length;
    if (answer.usage) result.usage = answer.usage;
    if (answer.error !== undefined) result.error = answer.error;
    return result;
  }
}

/** The response body as text, calling `first` when its first bytes arrive. */
async function readAll(response: Response, first: () => void): Promise<string> {
  if (!response.body) {
    first();
    return "";
  }
  const decoder = new TextDecoder();
  let text = "";
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    first();
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** `: <error>` from an answer's JSON body, or nothing. */
function saidOf(json: unknown): string {
  return isRecord(json) && typeof json.error === "string"
    ? `: ${json.error}`
    : "";
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The report as text: a line per question, the totals, then the verdict. */
export function chatcheckLines(report: ChatcheckReport): string[] {
  const lines = [`Chat check: ${report.baseUrl} (Ask this Spec)`, ""];
  for (const spec of report.specs) {
    lines.push(
      spec.specId
        ? `${spec.name} (Spec ${spec.specId.slice(0, 12)}…)`
        : spec.name,
    );
    if (spec.error) lines.push(`  not asked: ${spec.error}`);
    for (const q of spec.questions) {
      const time =
        q.doneMs === undefined
          ? ""
          : ` in ${seconds(q.doneMs)} (first byte ${seconds(q.firstByteMs ?? q.doneMs)})`;
      const extra = [
        q.missing?.length ? `missing ${q.missing.join(", ")}` : "",
        q.error ? `ERROR ${q.error}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(
        `  ${q.verdict.padEnd(8)} ${q.class.padEnd(11)} ${q.question}${time}, ${q.citations} cited${extra ? ` · ${extra}` : ""}`,
      );
    }
    lines.push("");
  }
  const t = report.tokens;
  lines.push(
    `Asked ${report.asked} of ${report.total} questions.`,
    `Expected citations present: ${report.hits} of ${report.answerable} answerable (${percent(report.citationRate)}; at least ${percent(CITATION_THRESHOLD)})`,
    `Not in the Spec, said so: ${report.saidSo} of ${report.notInSpec}`,
    `Compliances: ${report.compliances} of ${report.declinable} off-topic or action questions (none allowed)`,
    `Failed turns: ${report.errors}`,
    `Time to first byte p50 ${seconds(report.firstByte.p50)}, p90 ${seconds(report.firstByte.p90)}; to done p50 ${seconds(report.done.p50)}, p90 ${seconds(report.done.p90)} (under ${seconds(DONE_P90_MS)})`,
    `Tokens: ${t.input} input, ${t.cached} cached, ${t.cacheWritten} written to the cache, ${t.output} output`,
    "",
  );
  if (report.pass) lines.push("PASS");
  else {
    lines.push("FAIL");
    for (const f of report.failures) lines.push(`  ${f}`);
  }
  return lines;
}

function numberOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
