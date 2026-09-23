import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outcome } from "~/domain/outcome";
import { type Db, openDb } from "~/index-store/db";
import { createKeys, type Keys } from "~/index-store/keys";
import { type Gate, handleLookupRequest, secondsToUtcMidnight } from "./http";
import type { IndexedLookup, LookupRequest } from "./lookup";
import { createRateLimiter } from "./rate-limit";

const NOW = new Date("2026-09-23T23:00:00.000Z");
const INDEXED = "payco";
const indexedOutcome = {
  outcome: "Unknown",
  name: INDEXED,
} as unknown as Outcome;
const discovered = { outcome: "Unknown", name: "newco" } as Outcome;

/** A fake Lookup whose Index knows only "payco". */
function fakeLookup() {
  const run = vi.fn(async (_: LookupRequest) => discovered);
  const fromIndex = vi.fn((request: LookupRequest) =>
    request.name === INDEXED && !request.fresh ? indexedOutcome : null,
  );
  const currentFromIndex = vi.fn(() => null);
  return {
    lookup: Object.assign(run, {
      fromIndex,
      currentFromIndex,
    }) as IndexedLookup,
    run,
  };
}

describe("handleLookupRequest", () => {
  let dir: string;
  let db: Db;
  let keys: Keys;
  let fake: ReturnType<typeof fakeLookup>;
  let gate: Gate;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-http-"));
    db = openDb(join(dir, "test.db"));
    keys = createKeys(db);
    fake = fakeLookup();
    gate = {
      rateLimiter: createRateLimiter({ perMinute: 60, now: () => 0 }),
      clientIpHeader: "x-forwarded-for",
      dailyQuota: 100,
      now: () => NOW,
    };
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function post(
    body: object,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return handleLookupRequest(
      new Request("http://localhost/api/lookup", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      () => ({ lookup: fake.lookup, keys }),
      gate,
    );
  }

  const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

  it("answers an indexed name without a key, using no quota", async () => {
    const { id, secret } = keys.createKey("alice");

    const response = await post({ name: INDEXED });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(indexedOutcome);
    expect(fake.run).not.toHaveBeenCalled();
    // A key on an indexed name uses no quota either.
    expect((await post({ name: INDEXED }, bearer(secret))).status).toBe(200);
    expect(keys.listKeys("2026-09-23").find((k) => k.id === id)?.used).toBe(0);
  });

  it.each([
    ["an unindexed name", { name: "newco" }],
    ["fresh: true", { name: INDEXED, fresh: true }],
  ])("answers 401 for %s without a key", async (_, body) => {
    const response = await post(body);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Discovery needs an API key.",
      hint: expect.stringContaining("Authorization: Bearer"),
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", bearer("sb_nope")],
    ["a header that isn't Bearer", { authorization: "Basic abc" }],
  ])("answers 401 for %s, even on an indexed name", async (_, headers) => {
    const response = await post({ name: INDEXED }, headers);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unknown or revoked API key.",
    });
  });

  it("answers 401 for a revoked key", async () => {
    const { id, secret } = keys.createKey("alice");
    keys.revokeKey(id);

    expect((await post({ name: "newco" }, bearer(secret))).status).toBe(401);
  });

  it("runs Discovery with a key, then refuses past its daily quota", async () => {
    const { secret } = keys.createKey("alice", 2);

    const first = await post({ name: "newco" }, bearer(secret));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(discovered);
    expect(first.headers.get("x-quota-limit")).toBe("2");
    expect(first.headers.get("x-quota-remaining")).toBe("1");

    const second = await post({ name: INDEXED, fresh: true }, bearer(secret));
    expect(second.status).toBe(200);
    expect(second.headers.get("x-quota-remaining")).toBe("0");
    expect(fake.run).toHaveBeenLastCalledWith({ name: INDEXED, fresh: true });

    const third = await post({ name: "newco" }, bearer(secret));
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({
      error: "Daily quota used.",
      limit: 2,
      used: 2,
    });
    // 23:00 UTC: an hour until the quota resets.
    expect(third.headers.get("retry-after")).toBe("3600");
    expect(fake.run).toHaveBeenCalledTimes(2);
  });

  it("uses the default daily quota for a key without its own", async () => {
    gate.dailyQuota = 1;
    const { secret } = keys.createKey("bob");

    expect((await post({ name: "newco" }, bearer(secret))).status).toBe(200);
    expect((await post({ name: "newco" }, bearer(secret))).status).toBe(429);
  });

  it("answers 429 with Retry-After past the per-IP limit, before the body", async () => {
    gate.rateLimiter = createRateLimiter({ perMinute: 2, now: () => 0 });
    const ip = { "x-forwarded-for": "203.0.113.9" };
    await post({ name: INDEXED }, ip);
    await post({ name: INDEXED }, ip);

    const response = await post({}, ip);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toEqual({ error: "Rate limit exceeded." });
  });

  it("takes the client IP from CLIENT_IP_HEADER", async () => {
    gate.rateLimiter = createRateLimiter({ perMinute: 1, now: () => 0 });
    gate.clientIpHeader = "cf-connecting-ip";
    const from = (ip: string) => ({
      "cf-connecting-ip": ip,
      "x-forwarded-for": "10.0.0.1",
    });

    expect((await post({ name: INDEXED }, from("1.1.1.1"))).status).toBe(200);
    expect((await post({ name: INDEXED }, from("2.2.2.2"))).status).toBe(200);
    expect((await post({ name: INDEXED }, from("1.1.1.1"))).status).toBe(429);
  });

  it("keeps the 400s for a bad body", async () => {
    expect((await post({ name: " " })).status).toBe(400);
  });
});

describe("secondsToUtcMidnight", () => {
  it("counts whole seconds to the next UTC day", () => {
    expect(secondsToUtcMidnight(new Date("2026-09-23T00:00:00.000Z"))).toBe(
      86_400,
    );
    expect(secondsToUtcMidnight(new Date("2026-09-23T23:59:59.500Z"))).toBe(1);
  });
});
