import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "~/index-store/db";
import { createKeys, type Keys } from "~/index-store/keys";
import {
  createRateLimiter,
  createWindowLimiter,
  type RateLimiter,
} from "~/lookup/rate-limit";
import type { SignedInUser } from "./auth";
import {
  createKeyPage,
  KEY_ACTIONS_PER_HOUR,
  type KeyIssued,
  type KeyPageDeps,
} from "./keys-page";

const ADA: SignedInUser = { id: "user_ada", email: "ada@example.com" };
const BOB: SignedInUser = { id: "user_bob", email: "bob@example.com" };
const BASE = "https://swaggerbot.dev";
const NOW = new Date("2026-09-27T19:00:00Z");

function request(ip = "203.0.113.7"): Request {
  return new Request(`${BASE}/_serverFn/keys`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

function issued(result: unknown): KeyIssued {
  expect(result).toMatchObject({ ok: true });
  return result as KeyIssued;
}

describe("the key page's server functions, over the SQLite store", () => {
  let dir: string;
  let db: Db;
  let keys: Keys;
  let warn: ReturnType<typeof vi.fn<(message: string) => void>>;

  /** The key page as the server builds it, with a signed-in person passed per call (the fake `currentUser()`). */
  function page(overrides: Partial<KeyPageDeps> = {}) {
    return createKeyPage({
      keys,
      configured: true,
      quota: 100,
      perUser: createWindowLimiter({
        limit: KEY_ACTIONS_PER_HOUR,
        windowMs: 3_600_000,
      }),
      gate: {
        rateLimiter: createRateLimiter({ perMinute: 1000 }),
        clientIpHeader: "x-forwarded-for",
      },
      now: () => NOW,
      warn,
      ...overrides,
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-keys-page-"));
    db = openDb(join(dir, "test.db"));
    keys = createKeys(db, {});
    warn = vi.fn<(message: string) => void>();
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the person's key once, with the daily quota, and shows its secret in that answer only", async () => {
    const keyPage = page();
    const created = issued(await keyPage.create(ADA, request()));
    expect(created.secret).toMatch(/^sb_/);
    expect(keys.findKey(created.secret)).toMatchObject({
      id: created.id,
      owner: ADA.id,
      dailyQuota: 100,
    });
    expect(created.key).toMatchObject({
      id: created.id,
      remaining: 100,
      limit: 100,
      asOf: NOW.toISOString(),
    });

    const shown = await keyPage.page(ADA, BASE);
    expect(shown).toMatchObject({ state: "key", key: { id: created.id } });
    expect(JSON.stringify(shown)).not.toContain(created.secret);
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a second key while the first is live (409)", async () => {
    const keyPage = page();
    issued(await keyPage.create(ADA, request()));
    expect(await keyPage.create(ADA, request())).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("already have a live key"),
    });
    expect(keys.listKeys()).toHaveLength(1);
  });

  it("issues one key when two creates arrive together", async () => {
    const keyPage = page();
    const both = await Promise.all([
      keyPage.create(ADA, request()),
      keyPage.create(ADA, request()),
    ]);
    expect(both.map((r) => (r.ok ? 200 : r.status)).sort()).toEqual([200, 409]);
    expect(keys.listKeys()).toHaveLength(1);
  });

  it("rolls: a new secret, the old one dead, and the key's id in the answer", async () => {
    const keyPage = page();
    const created = issued(await keyPage.create(ADA, request()));
    await keys.verify(created.secret, { cost: 1 });

    const rolled = issued(await keyPage.roll(ADA, request()));
    expect(rolled.secret).not.toBe(created.secret);
    // SQLite keeps the id; Unkey issues a new one, which the answer carries.
    expect(rolled.id).toBe(created.id);
    expect(rolled.key.id).toBe(rolled.id);
    expect(keys.findKey(created.secret)).toBeUndefined();
    expect(keys.findKey(rolled.secret)?.id).toBe(rolled.id);
    // The day's use carries over.
    expect(rolled.key.remaining).toBe(99);
  });

  it("uses the id a roll returns when the store issues a new key", async () => {
    const store = {
      ...keys,
      liveKeyOf: vi
        .fn()
        .mockResolvedValueOnce({
          id: "key_old",
          start: "sb_abcd",
          createdAt: "2026-09-01T00:00:00.000Z",
        })
        .mockResolvedValueOnce({
          id: "key_new",
          start: "sb_wxyz",
          createdAt: "2026-09-27T19:00:00.000Z",
        }),
      roll: vi.fn().mockResolvedValue({ id: "key_new", secret: "sb_new" }),
    };
    const rolled = issued(await page({ keys: store }).roll(ADA, request()));
    expect(store.roll).toHaveBeenCalledWith("key_old");
    expect(rolled).toMatchObject({
      id: "key_new",
      secret: "sb_new",
      key: { id: "key_new", start: "sb_wxyz" },
    });
  });

  it("revokes, after which the person may create again", async () => {
    const keyPage = page();
    const first = issued(await keyPage.create(ADA, request()));
    expect(await keyPage.revoke(ADA, request())).toEqual({ ok: true });
    expect(keys.findKey(first.secret)).toBeUndefined();
    expect(await keyPage.page(ADA, BASE)).toMatchObject({ state: "no-key" });

    const second = issued(await keyPage.create(ADA, request()));
    expect(second.id).not.toBe(first.id);
  });

  it("acts only on the caller's own key: another person's can't be touched", async () => {
    const keyPage = page();
    const adas = issued(await keyPage.create(ADA, request()));

    expect(await keyPage.page(BOB, BASE)).toMatchObject({ state: "no-key" });
    expect(await keyPage.roll(BOB, request())).toMatchObject({ status: 404 });
    expect(await keyPage.revoke(BOB, request())).toMatchObject({
      status: 404,
    });
    expect(keys.findKey(adas.secret)?.id).toBe(adas.id);

    // Bob's own key is his, and Ada's stays live.
    issued(await keyPage.create(BOB, request()));
    expect(keys.findKey(adas.secret)?.id).toBe(adas.id);
  });

  it("answers a signed-out call with 401 and touches nothing", async () => {
    const store = {
      ...keys,
      liveKeyOf: vi.fn(keys.liveKeyOf),
      create: vi.fn(keys.create),
    };
    const keyPage = page({ keys: store });
    for (const action of [keyPage.create, keyPage.roll, keyPage.revoke])
      expect(await action(null, request())).toMatchObject({
        ok: false,
        status: 401,
      });
    expect(store.liveKeyOf).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(await keyPage.page(null, BASE)).toEqual({
      state: "signed-out",
      status: 200,
      quota: 100,
    });
  });

  it("says keys are issued by hand when Unkey or WorkOS isn't configured", async () => {
    const keyPage = page({ configured: false });
    expect(await keyPage.page(ADA, BASE)).toEqual({
      state: "by-hand",
      status: 200,
      quota: 100,
    });
    expect(await keyPage.create(ADA, request())).toMatchObject({
      status: 404,
    });
    expect(keys.listKeys()).toHaveLength(0);
  });

  it("limits creates and rolls to 5 an hour per person", async () => {
    let t = NOW.getTime();
    const keyPage = page({
      perUser: createWindowLimiter({
        limit: KEY_ACTIONS_PER_HOUR,
        windowMs: 3_600_000,
        now: () => t,
      }),
    });
    issued(await keyPage.create(ADA, request()));
    for (let i = 0; i < 4; i++) issued(await keyPage.roll(ADA, request()));
    const limited = await keyPage.roll(ADA, request());
    expect(limited).toMatchObject({
      ok: false,
      status: 429,
      retryAfterSeconds: 3600,
      error: expect.stringContaining("5 times this hour"),
    });
    // Someone else is unaffected; revoking isn't limited.
    issued(await keyPage.create(BOB, request()));
    expect(await keyPage.revoke(ADA, request())).toEqual({ ok: true });
    t += 3_600_000;
    issued(await keyPage.create(ADA, request()));
  });

  it("puts every action under the shared per-IP limit", async () => {
    const rateLimiter: RateLimiter = createRateLimiter({ perMinute: 1 });
    const keyPage = page({
      gate: { rateLimiter, clientIpHeader: "x-forwarded-for" },
    });
    issued(await keyPage.create(ADA, request("198.51.100.1")));
    expect(await keyPage.revoke(ADA, request("198.51.100.1"))).toMatchObject({
      status: 429,
      error: expect.stringContaining("Too many requests"),
    });
    expect(await keyPage.revoke(ADA, request("198.51.100.2"))).toEqual({
      ok: true,
    });
  });

  it("answers 503 when the store fails, and never logs a secret", async () => {
    const store = {
      ...keys,
      liveKeyOf: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockRejectedValue(new TypeError("fetch failed sb_x")),
    };
    const keyPage = page({ keys: store });
    expect(await keyPage.create(ADA, request())).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(warn).toHaveBeenCalledWith("keys page: create failed (TypeError)");

    store.liveKeyOf.mockRejectedValue(new Error("down"));
    expect(await keyPage.page(ADA, BASE)).toEqual({
      state: "unavailable",
      status: 503,
    });
  });
});
