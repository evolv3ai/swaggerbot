import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outcome } from "~/domain/outcome";
import { fakeUnkey } from "~/index-store/__fixtures__/fake-unkey";
import { createUnkeyKeys } from "~/index-store/unkey-keys";
import { type Gate, handleLookupRequest } from "./http";
import type { IndexedLookup, LookupRequest } from "./lookup";
import { createRateLimiter } from "./rate-limit";

const NOW = new Date("2026-09-27T22:00:00.000Z");
const INDEXED = "payco";
const indexedOutcome = { outcome: "Unknown", name: INDEXED } as Outcome;
const discovered = { outcome: "Unknown", name: "newco" } as Outcome;

/** `POST /api/lookup` over the Unkey key store, with a fake Unkey client. */
describe("handleLookupRequest with Unkey", () => {
  let unkey: ReturnType<typeof fakeUnkey>;
  let run: ReturnType<typeof vi.fn>;
  let lookup: IndexedLookup;
  let gate: Gate;

  beforeEach(() => {
    unkey = fakeUnkey([
      {
        keyId: "key_1",
        secret: "sb_live",
        externalId: "user_1",
        credits: 2,
        refill: 2,
        enabled: true,
        createdAt: 0,
      },
    ]);
    run = vi.fn(async (_: LookupRequest) => discovered);
    lookup = Object.assign(run, {
      fromIndex: (request: LookupRequest) =>
        request.name === INDEXED && !request.fresh ? indexedOutcome : null,
      currentFromIndex: () => null,
    }) as unknown as IndexedLookup;
    gate = {
      rateLimiter: createRateLimiter({ perMinute: 60, now: () => 0 }),
      clientIpHeader: "x-forwarded-for",
      dailyQuota: 100,
      now: () => NOW,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function post(
    body: object,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const keys = createUnkeyKeys({
      client: unkey.client,
      apiId: "api_test",
      now: () => NOW,
    });
    return handleLookupRequest(
      new Request("http://localhost/api/lookup", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      () => ({ lookup, keys }),
      gate,
    );
  }

  const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
  const credits = () => unkey.keys[0]?.credits;

  it("never calls Unkey for a request with no key", async () => {
    expect((await post({ name: INDEXED })).status).toBe(200);
    expect((await post({ name: "newco" })).status).toBe(401);
    expect(unkey.verifyKey).not.toHaveBeenCalled();
  });

  it("verifies a key on an Index answer at cost 0, spending nothing", async () => {
    const response = await post({ name: INDEXED }, bearer("sb_live"));

    expect(response.status).toBe(200);
    expect(credits()).toBe(2);
    expect(unkey.verifyKey.mock.calls.map(([r]) => r.credits)).toEqual([
      { cost: 0 },
    ]);
  });

  it("spends one credit on Discovery, with the credits left as a header", async () => {
    const response = await post({ name: "newco" }, bearer("sb_live"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(discovered);
    expect(credits()).toBe(1);
    expect(response.headers.get("x-quota-remaining")).toBe("1");
    expect(unkey.verifyKey.mock.calls.map(([r]) => r.credits)).toEqual([
      { cost: 0 },
      { cost: 1 },
    ]);
  });

  it("answers 429 on USAGE_EXCEEDED, with retry-after until the UTC midnight reset", async () => {
    await post({ name: "newco" }, bearer("sb_live"));
    await post({ name: INDEXED, fresh: true }, bearer("sb_live"));

    const response = await post({ name: "newco" }, bearer("sb_live"));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Daily quota used." });
    // 22:00 UTC: two hours until the credits are refilled.
    expect(response.headers.get("retry-after")).toBe("7200");
    expect(response.headers.get("x-quota-remaining")).toBe("0");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an unknown key", bearer("sb_nope"), 1],
    ["a header that isn't Bearer", { authorization: "Basic abc" }, 0],
  ])("answers 401 for %s, as without Unkey", async (_, headers, calls) => {
    const response = await post({ name: INDEXED }, headers);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({
      error: "Unknown or revoked API key.",
    });
    expect(unkey.verifyKey).toHaveBeenCalledTimes(calls);
  });

  it("answers 503 with retry-after 30 when Unkey throws, a keyless Index answer still 200", async () => {
    unkey.state.mode = "throw";

    const response = await post({ name: INDEXED }, bearer("sb_live"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({
      error: "API keys can't be checked right now.",
      hint: "retry shortly",
    });
    expect((await post({ name: INDEXED })).status).toBe(200);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 503 when Unkey takes more than 2 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    unkey.state.mode = "hang";

    const pending = post({ name: "newco" }, bearer("sb_live"));
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(run).not.toHaveBeenCalled();
  });
});
