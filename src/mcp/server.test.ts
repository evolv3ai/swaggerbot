import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Outcome } from "~/domain/outcome";
import { type Db, openDb } from "~/index-store/db";
import { createKeys, type Keys } from "~/index-store/keys";
import type { Gate } from "~/lookup/http";
import type { IndexedLookup, LookupRequest } from "~/lookup/lookup";
import { createRateLimiter } from "~/lookup/rate-limit";
import { handleMcpRequest } from "./http";
import { createSwaggerbotMcpHandler } from "./server";

const NOW = new Date("2026-09-23T21:30:00.000Z");
const SPEC_ID = "0".repeat(64);
const resolved = Outcome.parse({
  outcome: "Resolved",
  api: { id: "stripe.com/stripe-api", vendorId: "stripe.com", name: "Stripe" },
  vendor: { id: "stripe.com", name: "Stripe", domain: "stripe.com" },
  currentSpec: {
    id: SPEC_ID,
    apiId: "stripe.com/stripe-api",
    specVersion: "3.0.0",
    apiVersion: "2024-06-20",
    isPreview: false,
    supersededAt: null,
    format: "json",
    byteLength: 1024,
    downloads: {
      published: `/api/specs/${SPEC_ID}/published`,
      normalized: `/api/specs/${SPEC_ID}/normalized`,
    },
    normalized: "ready",
  },
  alternateSpecs: [],
  provenance: "Official",
  sources: [
    {
      id: 1,
      specId: SPEC_ID,
      url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
      provenance: "Official",
      firstSeenAt: "2026-09-22T10:00:00.000Z",
      lastVerifiedAt: "2026-09-22T10:00:00.000Z",
    },
  ],
  validityIssues: [],
  validityIssueCount: 0,
  verifiedAt: "2026-09-22T10:00:00.000Z",
});

/** A fake Lookup whose Index knows only "Stripe"; Discovery answers Unknown. */
function fakeLookup() {
  const run = vi.fn(
    async ({ name }: LookupRequest): Promise<Outcome> => ({
      outcome: "Unknown",
      name,
    }),
  );
  const fromIndex = vi.fn((request: LookupRequest) =>
    request.name === "Stripe" && !request.fresh ? resolved : null,
  );
  return {
    lookup: Object.assign(run, {
      fromIndex,
      currentFromIndex: vi.fn(() => null),
    }) as IndexedLookup,
    run,
  };
}

describe("/mcp", () => {
  let dir: string;
  let db: Db;
  let keys: Keys;
  let fake: ReturnType<typeof fakeLookup>;
  let gate: Gate;
  let handler: ReturnType<typeof createSwaggerbotMcpHandler>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-mcp-"));
    db = openDb(join(dir, "test.db"));
    keys = createKeys(db);
    fake = fakeLookup();
    gate = {
      rateLimiter: createRateLimiter({ perMinute: 60, now: () => 0 }),
      clientIpHeader: "x-forwarded-for",
      dailyQuota: 100,
      now: () => NOW,
    };
    const getApp = () => ({ db, lookup: fake.lookup, keys });
    handler = createSwaggerbotMcpHandler({ getApp, gate });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** One JSON-RPC request to `/mcp`, as a stateless (2025-era) client sends it. */
  function rpc(
    method: string,
    params: object = {},
    headers: Record<string, string> = {},
    via: Pick<typeof handler, "fetch"> = handler,
  ): Promise<Response> {
    return handleMcpRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
      via,
      () => ({ keys }),
      gate,
    );
  }

  /** The JSON-RPC result of a 200 answer, sent as JSON or as one SSE event. */
  async function resultOf(response: Response) {
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
    if (!data) throw new Error(`no JSON-RPC message in ${text}`);
    const message = JSON.parse(data);
    if (message.error) throw new Error(JSON.stringify(message.error));
    return message.result;
  }

  function callLookup(
    args: object,
    headers: Record<string, string> = {},
  ): Promise<{
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: unknown;
  }> {
    return rpc(
      "tools/call",
      { name: "lookup_api", arguments: args },
      headers,
    ).then(resultOf);
  }

  const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

  it("lists lookup_api with the Lookup's input schema", async () => {
    const { tools } = await resultOf(await rpc("tools/list"));

    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      "lookup_api",
      "list_vendor_apis",
      "get_operation",
      "get_schema",
    ]);
    const [tool] = tools;
    expect(tool.description).toContain("get_spec_outline");
    expect(tool.description).toContain("never returned inline");
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        apiVersion: { type: "string" },
        allowCommunity: { type: "boolean" },
        fresh: { type: "boolean" },
      },
      required: ["name"],
    });
  });

  it("resolves an indexed name without a key, using no quota", async () => {
    const result = await callLookup({ name: "Stripe" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(resolved);
    const text = result.content[0]?.text;
    expect(text).toMatch(
      /^Resolved: Stripe by Stripe, apiId "stripe\.com\/stripe-api"\./,
    );
    expect(text).toContain("Official Provenance");
    expect(text).toContain(`/api/specs/${SPEC_ID}/published`);
    expect(text).toContain(`/api/specs/${SPEC_ID}/normalized`);
    expect(text).toContain(
      'Next: get_spec_outline(apiId: "stripe.com/stripe-api")',
    );
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("refuses Discovery without a key as a tool error with the key hint", async () => {
    const result = await callLookup({ name: "newco" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = result.content[0]?.text;
    expect(text).toMatch(/^Discovery needs an API key\./);
    expect(text).toContain("Authorization: Bearer <key>");
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("runs Discovery with a key, then says when a used quota resets", async () => {
    const { secret } = keys.createKey("alice", 1);

    const first = await callLookup({ name: "newco" }, bearer(secret));
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toEqual({
      outcome: "Unknown",
      name: "newco",
    });

    const second = await callLookup({ name: "newco" }, bearer(secret));
    expect(second.isError).toBe(true);
    // 21:30 UTC: 2 h 30 min until the quota resets.
    expect(second.content[0]?.text).toBe(
      "Daily quota used. This key has made 1 of its 1 Discovery Lookups today. The quota resets at 00:00 UTC, in 2 h 30 min. Names already in the Index still answer without using any.",
    );
    expect(fake.run).toHaveBeenCalledTimes(1);
  });

  it("refuses a bad argument as a tool error, not a protocol error", async () => {
    const result = await callLookup({ name: " " });

    expect(result.isError).toBe(true);
    expect(fake.lookup.fromIndex).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", bearer("sb_nope")],
    ["a header that isn't Bearer", { authorization: "Basic abc" }],
  ])("answers HTTP 401 for %s before any tool runs", async (_, headers) => {
    const spy = { fetch: vi.fn(handler.fetch) };

    const response = await rpc(
      "tools/call",
      { name: "lookup_api", arguments: { name: "Stripe" } },
      headers,
      spy,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({
      error: "Unknown or revoked API key.",
    });
    expect(spy.fetch).not.toHaveBeenCalled();
    expect(fake.lookup.fromIndex).not.toHaveBeenCalled();
  });

  it("answers 429 with retry-after past the per-IP limit", async () => {
    gate.rateLimiter = createRateLimiter({ perMinute: 1, now: () => 0 });
    const ip = { "x-forwarded-for": "203.0.113.9" };
    await resultOf(await rpc("tools/list", {}, ip));

    const response = await rpc("tools/list", {}, ip);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "Rate limit exceeded." });
  });

  it("gives two concurrent requests with different keys each their own key", async () => {
    const spent = keys.createKey("spent", 1);
    keys.takeQuota(spent.id, "2026-09-23", 1);
    const open = keys.createKey("open", 5);
    const takeQuota = vi.spyOn(keys, "takeQuota");
    // Holds every Discovery until both calls have reached the tool.
    let release = () => {};
    const bothIn = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = 0;
    fake.lookup.fromIndex = () => {
      arrived += 1;
      if (arrived === 2) release();
      return null;
    };
    fake.run.mockImplementation(async ({ name }) => {
      await bothIn;
      return { outcome: "Unknown", name };
    });

    const [a, b] = await Promise.all([
      callLookup({ name: "newco" }, bearer(open.secret)),
      callLookup({ name: "newco" }, bearer(spent.secret)),
    ]);

    expect(a.isError).toBeFalsy();
    expect(a.structuredContent).toEqual({ outcome: "Unknown", name: "newco" });
    expect(b.isError).toBe(true);
    expect(b.content[0]?.text).toMatch(/^Daily quota used\./);
    expect(takeQuota.mock.calls.map(([id, , limit]) => [id, limit])).toEqual(
      expect.arrayContaining([
        [open.id, 5],
        [spent.id, 1],
      ]),
    );
  });
});
