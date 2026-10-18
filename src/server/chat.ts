import { z } from "zod";
import { CHAT_MAX_TOKENS, type Model } from "~/chat/model";
import { type ChatConfig, systemPrompt } from "~/chat/prompt";
import { type GroundingDocument, groundingFor } from "~/chat/retrieve";
import type { ChatStore, ChatTurnRow } from "~/index-store/chat";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { type Gate, rateLimited } from "~/lookup/http";
import type { IndexedLookup } from "~/lookup/lookup";
import {
  type NormalizedCache,
  openNormalized,
  PENDING_RETRY_AFTER_SECONDS,
} from "~/spec-forms/operation-http";
import type { SignedInUser } from "./auth";
import type { ChatGate, ChatRefusal } from "./chat-gate";
import { isSpecId } from "./downloads";

/**
 * `POST /specs/{specId}/ask` (Slice 9, D6): one Ask this Spec turn, streamed
 * as `text/event-stream`. Not part of the public HTTP API: it needs the
 * person's session, so it lives outside `/api/`, where AuthKit's middleware
 * runs. The server keeps no conversation; the browser sends the recent turns
 * back, and what they cited.
 *
 * Events, each `data` one JSON object:
 * - `delta` `{ text }`: the next piece of the answer, plain text.
 * - `citation` `{ index, kind, method?, path?, name?, cited }`: the text
 *   before it cites the turn's document `index`, an operation (`method`,
 *   `path`), a schema (`name`) or the Spec's facts; `cited` is the text it
 *   quotes.
 * - `usage` `{ input, cached, cacheWritten, output }`: the turn's tokens.
 * - `refusal` `{ message }`: the model declined; one neutral line.
 * - `done` `{ stopReason }`: the answer ended.
 * - `error` `{ error }`: the turn failed or ran out of time; one neutral line.
 */

/** The most turns of history a question may bring. */
export const MAX_HISTORY_TURNS = 8;

/** The longest question, in characters. */
export const MAX_QUESTION_CHARS = 2_000;

/** The longest earlier turn, in characters: an answer runs to 1,500 tokens. */
export const MAX_HISTORY_CHARS = 8_000;

/** The most operations and schemas the conversation cited a question may bring. */
export const MAX_CITED = 10;

/** A turn is cut off after this long, whatever it is waiting on. */
export const TURN_LIMIT_MS = 60_000;

const Ref = z.union([
  z
    .object({
      method: z.string().min(1).max(16),
      path: z.string().min(1).max(2_000),
    })
    .strict(),
  z.object({ name: z.string().min(1).max(500) }).strict(),
]);

export const AskBody = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(MAX_HISTORY_CHARS),
      }),
    )
    .max(MAX_HISTORY_TURNS)
    .default([]),
  cited: z.array(Ref).max(MAX_CITED).default([]),
});
export type AskBody = z.infer<typeof AskBody>;

/** What a turn needs, all of it passed in so tests need no server. */
export type ChatDeps = {
  db: Db;
  lookup: Pick<IndexedLookup, "currentFromIndex">;
  cache: NormalizedCache;
  /** The per-IP limit every route shares. */
  rateGate: Pick<Gate, "rateLimiter" | "clientIpHeader">;
  currentUser: () => SignedInUser | null;
  /** The feature, or `undefined` when it is off (no `ANTHROPIC_API_KEY`). */
  chat:
    | {
        config: Pick<ChatConfig, "model" | "effort">;
        model: Model;
        store: Pick<ChatStore, "logTurn">;
        gate: ChatGate;
      }
    | undefined;
  /** The turn's log line. */
  log?: (line: string) => void;
  now?: () => number;
  timeoutMs?: number;
};

const SIGN_IN = { error: "Sign in to ask this Spec." };
const OFF = { error: "Ask this Spec is off on this site." };
const NO_SPEC = { error: "No such Spec." };
const CROSS_SITE = {
  error: "Ask this Spec only from swagger.bot's own pages.",
};

/** The panel's words when the model declines. */
export const REFUSAL_MESSAGE = "I can't answer that one.";

/** The panel's words when a turn fails or runs out of time. */
export const ERROR_MESSAGE = "Something went wrong answering that. Try again.";

/**
 * Answers `POST /specs/{specId}/ask`. Refused, in order: over the per-IP
 * limit (429); not from this site's own pages (403); signed out (401); the
 * feature off (404); a bad body (400); a Spec not in the Index (404); its
 * forms pending (409 with `retry-after`) or failed (422); the person's
 * questions for the day used (429 with `retry-after`); a turn of theirs
 * still in flight (409). Else the turn's event stream.
 */
export async function handleAsk(
  request: Request,
  specId: string,
  deps: ChatDeps,
): Promise<Response> {
  const limited = rateLimited(request, deps.rateGate);
  if (limited) return limited;
  if (!sameOrigin(request)) return json(CROSS_SITE, 403);
  const user = deps.currentUser();
  if (!user) return json(SIGN_IN, 401);
  const { chat } = deps;
  if (!chat) return json(OFF, 404);

  const parsed = AskBody.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success)
    return json(
      {
        error: `Send { question (1 to ${MAX_QUESTION_CHARS} characters), history (at most ${MAX_HISTORY_TURNS} turns of { role, text }), cited (at most ${MAX_CITED}) }.`,
      },
      400,
    );
  const body = parsed.data;

  const spec = isSpecId(specId)
    ? createRepo(deps.db).getSpec(specId)
    : undefined;
  const api = spec && createRepo(deps.db).getApiWithSpecs(spec.apiId)?.api;
  if (!spec || !api) return json(NO_SPEC, 404);
  const opened = await openNormalized(spec.apiId, specId, deps);
  if ("status" in opened)
    return Response.json(opened.body, {
      status: opened.status,
      headers: { ...opened.headers, "cache-control": "no-store" },
    });
  const outline = createSpecForms(deps.db).getOutline(specId);
  if (outline.status !== "ready")
    return json({ status: "pending" }, 409, {
      "retry-after": String(PENDING_RETRY_AFTER_SECONDS),
    });

  const admitted = await admit(chat.gate, user.id);
  if ("ok" in admitted)
    return json(
      { error: admitted.error },
      admitted.status,
      admitted.retryAfterSeconds === undefined
        ? {}
        : { "retry-after": String(admitted.retryAfterSeconds) },
    );

  let stream: ReadableStream<Uint8Array>;
  try {
    const grounding = groundingFor(
      body.question,
      // Retrieval keeps what the conversation cited in; the turns' own text
      // goes to the model, not to retrieval.
      [{ role: "assistant", text: "", cited: body.cited }],
      { outline: outline.outline, doc: opened.doc, apiId: spec.apiId, specId },
    );
    stream = turnStream({
      deps: { ...deps, chat },
      request,
      body,
      documents: grounding.documents,
      system: systemPrompt({
        name: outline.outline.title ?? api.name,
        apiVersion: spec.apiVersion,
      }),
      row: {
        specId,
        apiId: spec.apiId,
        userId: user.id,
        model: chat.config.model,
        effort: chat.config.effort,
        operationsSent: grounding.stats.operations,
        schemasSent: grounding.stats.schemas,
        bytesSent: grounding.stats.bytes,
      },
      settle: admitted.settle,
    });
  } catch (thrown) {
    admitted.settle();
    throw thrown;
  }
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Whether the request came from this site's own pages: `Sec-Fetch-Site` is
 * `same-origin`, or, from a client that doesn't send it, `Origin` is this
 * site's. The CSRF middleware covers server functions only.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  return request.headers.get("origin") === new URL(request.url).origin;
}

/**
 * Lets `userId`'s turn through the gate, or says why not. A turn let
 * through holds the person's place until `settle` is called.
 */
function admit(
  gate: ChatGate,
  userId: string,
): Promise<{ settle: () => void } | ChatRefusal> {
  return new Promise((resolve) => {
    void gate
      .run(userId, () => new Promise<void>((settle) => resolve({ settle })))
      .then((refused) => {
        if (refused) resolve(refused);
      });
  });
}

type TurnInput = {
  deps: ChatDeps & { chat: NonNullable<ChatDeps["chat"]> };
  request: Request;
  body: AskBody;
  documents: GroundingDocument[];
  system: string;
  row: Pick<
    ChatTurnRow,
    | "specId"
    | "apiId"
    | "userId"
    | "model"
    | "effort"
    | "operationsSent"
    | "schemasSent"
    | "bytesSent"
  >;
  settle: () => void;
};

/**
 * The turn's events as the model streams them, each written as it comes.
 * However the turn ends (answered, declined, failed, timed out, or the
 * Caller gone) it is logged once and the person's place is let go.
 */
function turnStream({
  deps,
  request,
  body,
  documents,
  system,
  row,
  settle,
}: TurnInput): ReadableStream<Uint8Array> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.info;
  const started = now();
  const gone = new AbortController();
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? TURN_LIMIT_MS);
  const signal = AbortSignal.any([gone.signal, timeout, request.signal]);
  const encoder = new TextEncoder();
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        if (event === "error") sentError = true;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };
      const usage = { input: 0, cached: 0, cacheWritten: 0, output: 0 };
      let answer = "";
      let citations = 0;
      let stopReason: string | null = null;
      let refusalCategory: string | null = null;
      let error: string | null = null;
      let sentError = false;
      try {
        const events = deps.chat.model.stream({
          system,
          documents,
          history: body.history,
          question: body.question,
          maxTokens: CHAT_MAX_TOKENS,
          signal,
        });
        for await (const event of events) {
          if (signal.aborted) break;
          switch (event.type) {
            case "text":
              answer += event.text;
              send("delta", { text: event.text });
              break;
            case "citation": {
              const doc = documents[event.documentIndex];
              if (!doc) break;
              citations += 1;
              send("citation", {
                index: event.documentIndex,
                kind: doc.kind,
                ...doc.ref,
                cited: event.cited,
              });
              break;
            }
            case "usage":
              Object.assign(usage, {
                input: event.input,
                cached: event.cached,
                cacheWritten: event.cacheWritten,
                output: event.output,
              });
              send("usage", usage);
              break;
            case "refusal":
              refusalCategory = event.category ?? null;
              send("refusal", { message: REFUSAL_MESSAGE });
              break;
            case "done":
              stopReason = event.stopReason;
              send("done", { stopReason });
              break;
            case "error":
              error = event.kind;
              send("error", { error: ERROR_MESSAGE });
              break;
          }
        }
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.name : "unknown";
        send("error", { error: ERROR_MESSAGE });
      }
      // An abort is the turn's own, whatever the model made of it.
      if (timeout.aborted) error = "timeout";
      else if (signal.aborted) error = "aborted";
      else if (!error && stopReason === null) error = "no-done";
      if (error && !sentError) send("error", { error: ERROR_MESSAGE });

      const turn: ChatTurnRow = {
        ...row,
        inputTokens: usage.input + usage.cacheWritten,
        cachedTokens: usage.cached,
        outputTokens: usage.output,
        latencyMs: Math.max(0, Math.round(now() - started)),
        citations,
        stopReason,
        refusalCategory,
        error,
        question: body.question,
        answer,
      };
      try {
        deps.chat.store.logTurn(turn);
      } catch (thrown) {
        console.error("chat turn: not logged:", thrown);
      }
      const { question: _q, answer: _a, ...figures } = turn;
      log(`chat turn: ${JSON.stringify(figures)}`);
      settle();
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
      gone.abort();
    },
  });
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...headers, "cache-control": "no-store" },
  });
}
