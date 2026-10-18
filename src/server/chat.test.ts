import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import payco from "~/chat/__fixtures__/payco.json";
import { FakeModel } from "~/chat/fake";
import type { Model, ModelEvent, ModelRequest } from "~/chat/model";
import { groundingFor } from "~/chat/retrieve";
import { type ChatStore, createChatStore } from "~/index-store/chat";
import { type Db, openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { chatTurns } from "~/index-store/schema";
import { createSpecForms } from "~/index-store/spec-forms";
import { outlineOf, SpecFormsError } from "~/spec-forms/build";
import { createNormalizedCache } from "~/spec-forms/operation-http";
import { Route } from "../routes/specs/$specId/ask";
import type { SignedInUser } from "./auth";
import {
  type ChatDeps,
  ERROR_MESSAGE,
  handleAsk,
  REFUSAL_MESSAGE,
} from "./chat";
import { createChatGate } from "./chat-gate";

const AT = "2026-10-18T19:00:00.000Z";
const ADA: SignedInUser = { id: "user_ada", email: "ada@example.com" };
const ORIGIN = "http://localhost";
const QUESTION = "How do I create a customer?";

/** One server-sent event as the panel reads it. */
type Sse = { event: string; data: Record<string, unknown> };

function parseSse(text: string): Sse[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [eventLine, dataLine] = block.split("\n");
      return {
        event: eventLine?.replace(/^event: /, "") ?? "",
        data: JSON.parse(dataLine?.replace(/^data: /, "") ?? "null"),
      };
    });
}

/** A Model that sends `first`, then waits until the turn is aborted. */
function hangingModel(first: ModelEvent[] = []): Model & {
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async *stream(request) {
      requests.push(request);
      for (const event of first) yield event;
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve();
        request.signal?.addEventListener("abort", () => resolve());
      });
      yield { type: "error", kind: "APIUserAbortError" };
    },
  };
}

/** Polls `check` until it is truthy, for work the stream finishes after the test reads it. */
async function until<T>(check: () => T): Promise<NonNullable<T>> {
  for (let i = 0; i < 200; i += 1) {
    const value = check();
    if (value) return value as NonNullable<T>;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out waiting");
}

describe("handleAsk", () => {
  let dir: string;
  let db: Db;
  let store: ChatStore;
  let readySpec: string;
  let pendingSpec: string;
  let failedSpec: string;
  let user: SignedInUser | null;
  let logged: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-chat-"));
    db = openDb(join(dir, "index.db"));
    store = createChatStore(db);
    user = ADA;
    logged = [];
    const repo = createRepo(db);
    repo.upsertVendor({
      id: "payco.example",
      name: "PayCo",
      domain: "payco.example",
    });
    repo.upsertApi({
      id: "payco.example/payco",
      vendorId: "payco.example",
      name: "PayCo",
    });
    const put = (bytes: string) =>
      repo.putSpec("payco.example/payco", new TextEncoder().encode(bytes), {
        specVersion: "3.1.0",
        apiVersion: "2024-06-01",
        format: "json",
      }).id;
    readySpec = put(JSON.stringify(payco));
    pendingSpec = put('{"openapi":"3.1.0","pending":true}');
    failedSpec = put('{"openapi":"3.1.0","failed":true}');
    const forms = createSpecForms(db);
    forms.saveBuilt(
      readySpec,
      {
        normalized: new TextEncoder().encode(JSON.stringify(payco)),
        normalizedSpecVersion: "3.1.1",
        validityIssues: [],
        validityFindingCount: 0,
        normalizedFindingCount: 0,
        outline: outlineOf(payco),
      },
      AT,
    );
    forms.saveFailure(
      failedSpec,
      new SpecFormsError("not-openapi", "not an OpenAPI document"),
      AT,
    );
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function depsOf(
    model: Model,
    overrides: Partial<ChatDeps> & { limit?: number } = {},
  ): ChatDeps {
    const { limit = 30, ...rest } = overrides;
    return {
      db,
      lookup: { currentFromIndex: () => null },
      cache: createNormalizedCache(),
      rateGate: {
        rateLimiter: {
          take: () => ({ allowed: true }) as never,
          size: () => 0,
        },
        clientIpHeader: "x-forwarded-for",
      },
      currentUser: () => user,
      chat: {
        config: { model: "claude-opus-5-5", effort: "low" },
        model,
        store,
        gate: createChatGate({
          store,
          limit,
          now: () => new Date(AT),
        }),
      },
      log: (line) => logged.push(line),
      ...rest,
    };
  }

  function ask(
    deps: ChatDeps,
    body: unknown = { question: QUESTION, history: [], cited: [] },
    {
      specId = readySpec,
      headers = { "sec-fetch-site": "same-origin" },
    }: { specId?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return handleAsk(
      new Request(`${ORIGIN}/specs/${specId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      specId,
      deps,
    );
  }

  const rows = () => db.select().from(chatTurns).all();
  const used = () => store.usedToday(ADA.id, AT.slice(0, 10));

  describe("refuses, in order", () => {
    it("429 over the per-IP limit, before anything else", async () => {
      user = null;
      const response = await ask(
        depsOf(new FakeModel(), {
          rateGate: {
            rateLimiter: {
              take: () => ({ allowed: false, retryAfterSeconds: 7 }),
              size: () => 1,
            },
            clientIpHeader: "x-forwarded-for",
          },
        }),
        undefined,
        { headers: { "sec-fetch-site": "cross-site" } },
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("7");
    });

    it.each([
      ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
      ["a same-site one", { "sec-fetch-site": "same-site" }],
      [
        "no Sec-Fetch-Site and another Origin",
        { origin: "https://evil.example" },
      ],
      ["neither header", {}],
    ])("403 for %s, before sign-in", async (_, headers) => {
      user = null;
      const response = await ask(depsOf(new FakeModel()), undefined, {
        headers,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Ask this Spec only from swagger.bot's own pages.",
      });
    });

    it("lets a client without Sec-Fetch-Site through on a matching Origin", async () => {
      const response = await ask(depsOf(new FakeModel()), undefined, {
        headers: { origin: ORIGIN },
      });
      expect(response.status).toBe(200);
      await response.text();
    });

    it("401 signed out, before the feature", async () => {
      user = null;
      const response = await ask({
        ...depsOf(new FakeModel()),
        chat: undefined,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Sign in to ask this Spec.",
      });
    });

    it("404 with the feature off", async () => {
      const response = await ask({
        ...depsOf(new FakeModel()),
        chat: undefined,
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Ask this Spec is off on this site.",
      });
    });

    it.each([
      ["no JSON", "not json"],
      ["no question", { history: [] }],
      ["an empty question", { question: "   " }],
      ["a question over 2,000 characters", { question: "a".repeat(2_001) }],
      [
        "more than 8 turns of history",
        {
          question: QUESTION,
          history: Array.from({ length: 9 }, () => ({
            role: "user",
            text: "hi",
          })),
        },
      ],
      [
        "a turn with another role",
        { question: QUESTION, history: [{ role: "system", text: "hi" }] },
      ],
      [
        "more than 10 cited",
        {
          question: QUESTION,
          cited: Array.from({ length: 11 }, (_, i) => ({ name: `s${i}` })),
        },
      ],
    ])("400 for %s", async (_, body) => {
      const response = await ask(depsOf(new FakeModel()), body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/^Send \{ question/);
    });

    it.each([
      ["a Spec not in the Index", "0".repeat(64)],
      ["a malformed Spec id", "nope"],
    ])("404 for %s", async (_, specId) => {
      const response = await ask(depsOf(new FakeModel()), undefined, {
        specId,
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "No such Spec." });
    });

    it("409 with retry-after while the Spec's forms are pending, before the meter is touched", async () => {
      const model = new FakeModel();
      const response = await ask(depsOf(model), undefined, {
        specId: pendingSpec,
      });
      expect(response.status).toBe(409);
      expect(response.headers.get("retry-after")).toBe("10");
      expect(await response.json()).toEqual({ status: "pending" });
      expect(used()).toBe(0);
      expect(model.requests).toHaveLength(0);
      expect(rows()).toHaveLength(0);
    });

    it("422 when the Spec's forms failed", async () => {
      const response = await ask(depsOf(new FakeModel()), undefined, {
        specId: failedSpec,
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ status: "failed" });
      expect(used()).toBe(0);
    });

    it("429 with retry-after to UTC midnight once the day's questions are used", async () => {
      const deps = depsOf(new FakeModel(), { limit: 1 });
      await (await ask(deps)).text();
      const response = await ask(deps);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe(String(5 * 3600));
      expect((await response.json()).error).toBe(
        "You've asked 1 question today; the count resets at 00:00 UTC, in 5 h.",
      );
      expect(used()).toBe(1);
    });

    it("409 while the person's last question is still being answered", async () => {
      const deps = depsOf(hangingModel([{ type: "text", text: "Wait" }]));
      const first = await ask(deps);
      const reader = first.body?.getReader();
      await reader?.read();

      const second = await ask(deps);
      expect(second.status).toBe(409);
      expect((await second.json()).error).toBe(
        "Your last question is still being answered. Ask again when it ends.",
      );
      expect(used()).toBe(1);

      await reader?.cancel();
      await until(() => rows().length === 1);
      const third = await ask({
        ...deps,
        chat: deps.chat && { ...deps.chat, model: new FakeModel() },
      });
      expect(third.status).toBe(200);
      await third.text();
    });
  });

  it("streams a scripted answer: text, citations resolved to an operation and a schema, usage, done", async () => {
    const grounding = groundingFor(
      QUESTION,
      [{ role: "assistant", text: "", cited: [] }],
      {
        outline: outlineOf(payco),
        doc: payco,
        apiId: "payco.example/payco",
        specId: readySpec,
      },
    );
    const operation = grounding.documents.findIndex(
      (d) => d.kind === "operation",
    );
    const schema = grounding.documents.findIndex((d) => d.kind === "schema");
    expect(operation).toBeGreaterThan(0);
    expect(schema).toBeGreaterThan(0);
    const opDoc = grounding.documents[operation];
    const schemaDoc = grounding.documents[schema];
    const model = new FakeModel({
      answers: {
        [QUESTION]: [
          { type: "text", text: "Send a POST" },
          { type: "citation", documentIndex: operation, cited: "post" },
          { type: "text", text: " with a customer." },
          { type: "citation", documentIndex: schema, cited: "email" },
          { type: "citation", documentIndex: 99, cited: "nowhere" },
          {
            type: "usage",
            input: 900,
            cached: 4_000,
            cacheWritten: 100,
            output: 40,
          },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    });

    const response = await ask(depsOf(model));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(parseSse(await response.text())).toEqual([
      { event: "delta", data: { text: "Send a POST" } },
      {
        event: "citation",
        data: {
          index: operation,
          kind: "operation",
          ...(opDoc?.ref ?? {}),
          cited: "post",
        },
      },
      { event: "delta", data: { text: " with a customer." } },
      {
        event: "citation",
        data: {
          index: schema,
          kind: "schema",
          ...(schemaDoc?.ref ?? {}),
          cited: "email",
        },
      },
      {
        event: "usage",
        data: { input: 900, cached: 4_000, cacheWritten: 100, output: 40 },
      },
      { event: "done", data: { stopReason: "end_turn" } },
    ]);

    const [sent] = model.requests;
    expect(sent?.system).toContain("PayCo, API Version 2024-06-01");
    expect(sent?.documents).toEqual(grounding.documents);
    expect(sent?.maxTokens).toBe(1_500);

    const [row] = rows();
    expect(row).toMatchObject({
      specId: readySpec,
      apiId: "payco.example/payco",
      userId: "user_ada",
      model: "claude-opus-5-5",
      effort: "low",
      inputTokens: 1_000,
      cachedTokens: 4_000,
      outputTokens: 40,
      operationsSent: grounding.stats.operations,
      schemasSent: grounding.stats.schemas,
      bytesSent: grounding.stats.bytes,
      citations: 2,
      stopReason: "end_turn",
      refusalCategory: null,
      error: null,
      question: null,
      answer: null,
    });
    expect(used()).toBe(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^chat turn: \{/);
    expect(logged[0]).not.toContain(QUESTION);
    expect(logged[0]).not.toContain("with a customer");
  });

  it("sends the history to the model and keeps what the conversation cited in the documents", async () => {
    const model = new FakeModel();
    const history = [
      { role: "user" as const, text: "What is an invoice?" },
      { role: "assistant" as const, text: "An invoice is a bill." },
    ];
    const response = await ask(depsOf(model), {
      question: "And does it have a total?",
      history,
      cited: [{ method: "get", path: "/invoices" }],
    });
    await response.text();
    const [sent] = model.requests;
    expect(sent?.history).toEqual(history);
    expect(sent?.documents.map((d) => d.title)).toContain(
      "GET /invoices (operation)",
    );
  });

  it("keeps the question and answer only when the store logs text", async () => {
    store = createChatStore(db, { logText: true });
    const response = await ask(
      depsOf(
        new FakeModel({
          default: [
            { type: "text", text: "The Spec doesn't say." },
            { type: "done", stopReason: "end_turn" },
          ],
        }),
      ),
    );
    await response.text();
    expect(rows()[0]).toMatchObject({
      question: QUESTION,
      answer: "The Spec doesn't say.",
    });
  });

  it("sends a refusal as one neutral line, never as text, and logs its category", async () => {
    const response = await ask(
      depsOf(
        new FakeModel({
          default: [
            { type: "usage", input: 10, cached: 0, cacheWritten: 0, output: 0 },
            { type: "refusal", category: "cyber" },
            { type: "done", stopReason: "refusal" },
          ],
        }),
      ),
    );
    const events = parseSse(await response.text());
    expect(events.map((e) => e.event)).toEqual(["usage", "refusal", "done"]);
    expect(events[1]?.data).toEqual({ message: REFUSAL_MESSAGE });
    expect(rows()[0]).toMatchObject({
      stopReason: "refusal",
      refusalCategory: "cyber",
      error: null,
    });
  });

  it("sends a model error as one neutral line and logs its class", async () => {
    const response = await ask(
      depsOf(
        new FakeModel({
          default: [{ type: "error", kind: "RateLimitError" }],
        }),
      ),
    );
    expect(parseSse(await response.text())).toEqual([
      { event: "error", data: { error: ERROR_MESSAGE } },
    ]);
    expect(rows()[0]).toMatchObject({
      stopReason: null,
      error: "RateLimitError",
    });
    expect(used()).toBe(1);
  });

  it("counts and logs a turn the Caller abandons, and lets the next one in", async () => {
    const model = hangingModel([{ type: "text", text: "Half" }]);
    const response = await ask(depsOf(model));
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();

    const [row] = await until(() => (rows().length === 1 ? rows() : null));
    expect(row).toMatchObject({ stopReason: null, error: "aborted" });
    expect(model.requests[0]?.signal?.aborted).toBe(true);
    expect(used()).toBe(1);
  });

  it("cuts a turn off at its time limit", async () => {
    const response = await ask(
      depsOf(hangingModel([{ type: "text", text: "Slow" }]), { timeoutMs: 20 }),
    );
    expect(parseSse(await response.text())).toEqual([
      { event: "delta", data: { text: "Slow" } },
      { event: "error", data: { error: ERROR_MESSAGE } },
    ]);
    expect(rows()[0]).toMatchObject({ stopReason: null, error: "timeout" });
  });
});

describe("the /specs/{specId}/ask route", () => {
  it("answers 405 to anything but POST", async () => {
    const handlers = Route.options.server?.handlers;
    const any = typeof handlers === "function" ? undefined : handlers?.ANY;
    if (typeof any !== "function") throw new Error("no ANY handler");
    const response = (await any({
      request: new Request(`${ORIGIN}/specs/x/ask`),
      params: { specId: "x" },
    } as never)) as Response;
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
