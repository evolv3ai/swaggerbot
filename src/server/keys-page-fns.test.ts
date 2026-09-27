import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeUnkey } from "~/index-store/__fixtures__/fake-unkey";
import { createUnkeyKeys } from "~/index-store/unkey-keys";
import { createRateLimiter } from "~/lookup/rate-limit";

/**
 * The server functions as the router calls them, on the real key page over
 * the fake Unkey client: who they act for comes from `currentUser()` on the
 * request, and every answer is marked uncacheable.
 */

const request = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  headers: new Map<string, string>(),
  status: 200,
}));

// `createServerFn(...).handler(fn)` is `fn` here: no router, no RPC.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (fn: unknown) => fn }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://swaggerbot.dev/_serverFn/keys", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
  setResponseStatus: (status: number) => {
    request.status = status;
  },
  setResponseHeader: (name: string, value: string) => {
    request.headers.set(name.toLowerCase(), value);
  },
}));
vi.mock("./auth", () => ({
  currentUser: () => request.user,
  signInConfigured: () => true,
}));
vi.mock("~/index-store/key-store", () => ({
  unkeyConfigOf: () => ({ rootKey: "unkey_root", apiId: "api_test" }),
}));
const unkey = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("./app-instance", () => ({
  getApp: () => ({ keys: unkey.store }),
  gate: {
    dailyQuota: 100,
    rateLimiter: createRateLimiter({ perMinute: 1000 }),
    clientIpHeader: "x-forwarded-for",
  },
}));

const { createOwnKey, rollOwnKey, revokeOwnKey } = await import(
  "./keys-page-fns"
);
type Fn = () => Promise<{
  ok: boolean;
  status?: number;
  id?: string;
  secret?: string;
  key?: { id: string };
}>;
const call = (fn: unknown) => (fn as Fn)();

const ada = { id: "user_ada", email: "ada@example.com" };
const bob = { id: "user_bob", email: "bob@example.com" };

beforeEach(() => {
  request.user = null;
  request.headers.clear();
  request.status = 200;
  unkey.store = createUnkeyKeys({
    client: fakeUnkey().client,
    apiId: "api_test",
    env: { DAILY_QUOTA: "100" },
  });
  // A fresh page (and per-person limit) for each test.
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("swaggerbot.keyPage")
  ];
});

describe("/keys server functions", () => {
  it("answer 401 to a signed-out request", async () => {
    for (const fn of [createOwnKey, rollOwnKey, revokeOwnKey]) {
      expect(await call(fn)).toMatchObject({ ok: false, status: 401 });
      expect(request.status).toBe(401);
    }
  });

  it("act for the person signed in on the request, and no one else", async () => {
    request.user = ada;
    const created = await call(createOwnKey);
    expect(created.ok).toBe(true);

    request.user = bob;
    expect(await call(rollOwnKey)).toMatchObject({ ok: false, status: 404 });
    expect(await call(revokeOwnKey)).toMatchObject({ ok: false, status: 404 });

    request.user = ada;
    expect(await call(revokeOwnKey)).toMatchObject({ ok: true });
  });

  it("follow a roll to the new key Unkey issues", async () => {
    request.user = ada;
    const created = await call(createOwnKey);
    const rolled = await call(rollOwnKey);

    expect(rolled.ok).toBe(true);
    expect(rolled.key?.id).not.toBe(created.key?.id);
    expect(rolled.secret).not.toBe(created.secret);
    // The next action finds the rolled key, not the dead one.
    const again = await call(rollOwnKey);
    expect(again.ok).toBe(true);
    expect(again.key?.id).not.toBe(rolled.key?.id);
    expect(await call(revokeOwnKey)).toMatchObject({ ok: true });
    expect((await call(createOwnKey)).ok).toBe(true);
  });

  it("mark every answer private and uncacheable", async () => {
    request.user = ada;
    await call(createOwnKey);
    expect(request.headers.get("cache-control")).toBe("private, no-store");

    request.headers.clear();
    request.user = null;
    await call(rollOwnKey);
    expect(request.headers.get("cache-control")).toBe("private, no-store");
  });
});
