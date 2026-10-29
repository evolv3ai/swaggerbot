/**
 * The browser's side of `POST /specs/{specId}/ask` (`src/server/chat.ts`):
 * the request, the `text/event-stream` it answers with, and what the panel
 * sends back each turn. The server keeps no conversation, so the panel
 * holds it and sends the recent turns, and what they cited, with each
 * question. Nothing here imports the server: its limits are restated, and a
 * test checks they match.
 */

/** The most turns of `history` a question may bring (the route's limit). */
export const ASK_HISTORY_TURNS = 8;

/** The longest earlier turn the route takes, in characters. */
export const ASK_HISTORY_CHARS = 8_000;

/** The most operations and schemas cited earlier a question may bring. */
export const ASK_MAX_CITED = 10;

/** The longest question, in characters. */
export const ASK_QUESTION_CHARS = 2_000;

/** What an answer cited: an operation, a schema, or the Spec's facts. */
export type AskCitation =
  | { kind: "operation"; method: string; path: string; cited: string }
  | { kind: "schema"; name: string; cited: string }
  | { kind: "facts"; cited: string };

/** One event of a turn's stream, as the panel reads it. */
export type AskEvent =
  | { type: "delta"; text: string }
  | { type: "citation"; citation: AskCitation }
  | { type: "refusal"; message: string }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string };

/** The words for a turn that failed in a way the server didn't put into words. */
export const ASK_FAILED = "Something went wrong answering that. Try again.";

/** A refused request's words when it carries none. */
const STATUS_WORDS: Record<number, string> = {
  409: "Ask this Spec is ready once the Normalized Form is built.",
  422: "Ask this Spec can't be used: the Normalized Form couldn't be built.",
};

/**
 * The events in a `text/event-stream` body, in order, each frame's `data`
 * parsed as JSON. Unknown events and frames that don't parse are skipped:
 * the panel shows only what it knows. A stream that ends without `done`,
 * `refusal` or `error` is the caller's to treat as cut short.
 */
export async function* readAskEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += decoder
        .decode(value, { stream: !done })
        .replace(/\r\n?/g, "\n");
      let end = buffered.indexOf("\n\n");
      while (end !== -1) {
        const event = eventOf(buffered.slice(0, end));
        buffered = buffered.slice(end + 2);
        if (event) yield event;
        end = buffered.indexOf("\n\n");
      }
      if (done) break;
    }
    const last = eventOf(buffered);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function eventOf(frame: string): AskEvent | undefined {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    return undefined;
  }
  const text = (key: string) =>
    typeof parsed[key] === "string" ? (parsed[key] as string) : undefined;
  switch (name) {
    case "delta": {
      const t = text("text");
      return t === undefined ? undefined : { type: "delta", text: t };
    }
    case "citation": {
      const citation = citationOf(parsed);
      return citation ? { type: "citation", citation } : undefined;
    }
    case "refusal":
      return { type: "refusal", message: text("message") ?? ASK_FAILED };
    case "done":
      return { type: "done", stopReason: text("stopReason") ?? "" };
    case "error":
      return { type: "error", message: text("error") ?? ASK_FAILED };
    default:
      return undefined;
  }
}

function citationOf(data: Record<string, unknown>): AskCitation | undefined {
  const cited = typeof data.cited === "string" ? data.cited : "";
  const { kind, method, path, name } = data;
  if (
    kind === "operation" &&
    typeof method === "string" &&
    typeof path === "string"
  )
    return { kind, method, path, cited };
  if (kind === "schema" && typeof name === "string")
    return { kind, name, cited };
  if (kind === "facts") return { kind, cited };
  return undefined;
}

/** A turn of the conversation the panel holds. */
export type AskTurn = {
  question: string;
  answer: string;
  citations: AskCitation[];
  /**
   * `streaming` while it is being answered; `answered` once it is done;
   * `stopped` when the person stopped it; `declined` when the model
   * declined; `failed` for any error or refusal, with the server's words in
   * `message`.
   */
  status: "streaming" | "answered" | "stopped" | "declined" | "failed";
  message?: string;
};

/** What a question carries back: the recent turns, and what they cited. */
export type AskBody = {
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  cited: ({ method: string; path: string } | { name: string })[];
};

/**
 * The body for `question` after `turns`: the answered turns' questions and
 * answers, the most recent `ASK_HISTORY_TURNS` of them (each at most
 * `ASK_HISTORY_CHARS`), and the operations and schemas they cited, the most
 * recent first, each once, at most `ASK_MAX_CITED`.
 */
export function askBodyOf(
  question: string,
  turns: readonly AskTurn[],
): AskBody {
  const answered = turns.filter((t) => t.status === "answered");
  const history = answered
    .flatMap((t) => [
      { role: "user" as const, text: t.question },
      { role: "assistant" as const, text: t.answer },
    ])
    .slice(-ASK_HISTORY_TURNS)
    .map((t) => ({ ...t, text: t.text.slice(0, ASK_HISTORY_CHARS) }));
  const cited: AskBody["cited"] = [];
  const seen = new Set<string>();
  for (const turn of [...answered].reverse())
    for (const c of turn.citations) {
      if (c.kind === "facts") continue;
      const ref =
        c.kind === "operation"
          ? { method: c.method, path: c.path }
          : { name: c.name };
      const key = JSON.stringify(ref);
      if (seen.has(key) || cited.length >= ASK_MAX_CITED) continue;
      seen.add(key);
      cited.push(ref);
    }
  return { question: question.trim(), history, cited };
}

/** Where a request went: refused before streaming, or the turn's events. */
export type AskStart =
  | { ok: false; message: string }
  | { ok: true; events: AsyncGenerator<AskEvent> };

/**
 * Sends one question. A refusal (signed out, the day's questions used, a
 * turn in flight, the forms not built) comes back as the server's words;
 * otherwise the turn's events, as they stream.
 */
export async function startAsk(
  specId: string,
  body: AskBody,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AskStart> {
  const response = await fetcher(`/specs/${encodeURIComponent(specId)}/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
  const type = response.headers.get("content-type") ?? "";
  if (response.ok && response.body && type.startsWith("text/event-stream"))
    return { ok: true, events: readAskEvents(response.body) };
  const answer = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return {
    ok: false,
    message:
      typeof answer?.error === "string"
        ? answer.error
        : (STATUS_WORDS[response.status] ?? ASK_FAILED),
  };
}

/**
 * A citation as a chip: its words, the link to what it cites and, for an
 * operation, its method and path, to show it in the API reference.
 */
export type CitationChip = {
  key: string;
  label: string;
  href: string;
  external: boolean;
  operation?: { method: string; path: string };
};

/**
 * An answer's citations as chips, in the order they came, each once: an
 * operation (`POST /v1/customers`) or a schema (`customer`) links to its
 * JSON from the HTTP API, in a new tab; the Spec's facts to the top of this
 * page. These are the only links the panel makes: nothing in an answer is
 * ever a link. An operation is also shown in the API reference on this
 * page, when it is there (`TurnView`).
 */
export function citationChips(
  citations: readonly AskCitation[],
  ids: { apiId: string; specId: string },
): CitationChip[] {
  // An API id is ours and carries its slash (`stripe.com/stripe-api`), as
  // `outlineUrl` has it.
  const base = `/api/apis/${ids.apiId}`;
  const chips = new Map<string, CitationChip>();
  for (const c of citations) {
    const chip: CitationChip =
      c.kind === "operation"
        ? {
            key: `op ${c.method.toLowerCase()} ${c.path}`,
            label: `${c.method.toUpperCase()} ${c.path}`,
            href: `${base}/operation?${new URLSearchParams({ specId: ids.specId, method: c.method.toLowerCase(), path: c.path })}`,
            external: true,
            operation: { method: c.method.toLowerCase(), path: c.path },
          }
        : c.kind === "schema"
          ? {
              key: `schema ${c.name}`,
              label: c.name,
              href: `${base}/schema?${new URLSearchParams({ specId: ids.specId, name: c.name })}`,
              external: true,
            }
          : {
              key: "facts",
              label: "About this Spec",
              href: `/specs/${encodeURIComponent(ids.specId)}#spec`,
              external: false,
            };
    if (!chips.has(chip.key)) chips.set(chip.key, chip);
  }
  return [...chips.values()];
}
