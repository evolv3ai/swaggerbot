import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outcome } from "~/domain/outcome";
import { fakeUnkey } from "~/index-store/__fixtures__/fake-unkey";
import { type Db, openDb } from "~/index-store/db";
import { createUnkeyKeys, type UnkeyKeys } from "~/index-store/unkey-keys";
import type { Gate } from "~/lookup/http";
import type { IndexedLookup, LookupRequest } from "~/lookup/lookup";
import { createRateLimiter } from "~/lookup/rate-limit";
import { handleMcpRequest } from "./http";
import { createSwaggerbotMcpHandler } from "./server";

const NOW = new Date("2026-09-27T21:30:00.000Z");

/** `/mcp` over the Unkey key store, with a fake Unkey client. */
describe("/mcp with Unkey", () => {
  let dir: string;
  let db: Db;
  let unkey: ReturnType<typeof fakeUnkey>;
  let keys: UnkeyKeys;
  let run: ReturnType<typeof vi.fn>;
  let handler: ReturnType<typeof createSwaggerbotMcpHandler>;
  let gate: Gate;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-mcp-unkey-"));
    db = openDb(join(dir, "test.db"));
    unkey = fakeUnkey([
      {
        keyId: "key_1",
        secret: "sb_live",
        externalId: "user_1",
        credits: 1,
        refill: 1,
        enabled: true,
        createdAt: 0,
      },
    ]);
    keys = createUnkeyKeys({
      client: unkey.client,
      apiId: "api_test",
      now: () => NOW,
    });
    run = vi.fn(
      async ({ name }: LookupRequest): Promise<Outcome> => ({
        outcome: "Unknown",
        name,
      }),
    );
    const lookup = Object.assign(run, {
      fromIndex: () => null,
      currentFromIndex: () => null,
    }) as unknown as IndexedLookup;
    gate = {
      rateLimiter: createRateLimiter({ perMinute: 60, now: () => 0 }),
      clientIpHeader: "x-forwarded-for",
      dailyQuota: 100,
      now: () => NOW,
    };
    handler = createSwaggerbotMcpHandler({
      getApp: () => ({ db, lookup, keys }),
      gate,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function rpc(
    method: string,
    params: object = {},
    headers: Record<string, string> = {},
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
      handler,
      () => ({ keys }),
      gate,
    );
  }

  async function resultOf(response: Response) {
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
    if (!data) throw new Error(`no JSON-RPC message in ${text}`);
    return JSON.parse(data).result;
  }

  const bearer = { authorization: "Bearer sb_live" };
  const lookupApi = (headers: Record<string, string> = {}) =>
    rpc(
      "tools/call",
      { name: "lookup_api", arguments: { name: "newco" } },
      headers,
    );

  it("never calls Unkey for a request with no key", async () => {
    await resultOf(await rpc("tools/list"));
    const refused = await resultOf(await lookupApi());

    expect(refused.isError).toBe(true);
    expect(unkey.verifyKey).not.toHaveBeenCalled();
  });

  it("verifies at cost 0 per request and 1 per Discovery, then says the quota is used", async () => {
    await resultOf(await rpc("tools/list", {}, bearer));
    expect(unkey.keys[0]?.credits).toBe(1);

    const first = await resultOf(await lookupApi(bearer));
    expect(first.isError).toBeFalsy();
    expect(unkey.keys[0]?.credits).toBe(0);

    const second = await resultOf(await lookupApi(bearer));
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toBe(
      "Daily quota used. This key has made all of its Discovery Lookups for today. The quota resets at 00:00 UTC, in 2 h 30 min. Names already in the Index still answer without using any.",
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(unkey.verifyKey.mock.calls.map(([r]) => r.credits?.cost)).toEqual([
      0, 0, 1, 0, 1,
    ]);
  });

  it("answers HTTP 401 for an unknown key", async () => {
    const response = await lookupApi({ authorization: "Bearer sb_nope" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unknown or revoked API key.",
    });
  });

  it("answers HTTP 503 with retry-after 30 when Unkey throws", async () => {
    unkey.state.mode = "throw";

    const response = await lookupApi(bearer);

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toMatchObject({ hint: "retry shortly" });
    expect(run).not.toHaveBeenCalled();
  });

  it("answers HTTP 503 when Unkey takes more than 2 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    unkey.state.mode = "hang";

    const pending = lookupApi(bearer);
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("says so as a tool error when Unkey fails between the request and the Discovery", async () => {
    unkey.verifyKey.mockImplementation(async ({ credits }) => {
      if (credits?.cost === 1) throw new Error("Unkey is down");
      return {
        meta: { requestId: "r" },
        data: { valid: true, code: "VALID", keyId: "key_1" },
      } as never;
    });

    const result = await resultOf(await lookupApi(bearer));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "API keys can't be checked right now. Try again in 30 seconds (retry shortly). Names already in the Index still answer.",
    );
    expect(run).not.toHaveBeenCalled();
  });
});
