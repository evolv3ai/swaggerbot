import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createKeys, type VerifyOptions } from "~/index-store/keys";
import { Route } from "./key";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-key-route-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The route's shared app, faked: the SQLite key store over a temp Index,
// watched so the test can see what each call cost; one secret the store
// can't check, as an outage answers.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
const local = createKeys(db, { DAILY_QUOTA: "5" });
const verify = vi.fn((secret: string, options: VerifyOptions) =>
  secret === "sb_down"
    ? Promise.resolve({ ok: false as const, reason: "unavailable" as const })
    : local.verify(secret, options),
);
createApp.mockImplementation(() => ({ keys: { verify } }));
const { id, secret } = local.createKey("route test");

async function get(
  headers: Record<string, string> = {},
  ip = "10.2.0.1",
): Promise<Response> {
  const handlers = Route.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.GET;
  if (typeof handler !== "function") throw new Error("no GET handler");
  const response = await handler({
    request: new Request("http://localhost/api/key", {
      headers: { "x-forwarded-for": ip, ...headers },
    }),
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

describe("GET /api/key", () => {
  afterEach(() => {
    verify.mockClear();
    vi.useRealTimers();
  });

  it("answers 400 without a bearer, asking the store nothing", async () => {
    const response = await get();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Send the key as Authorization: Bearer <key>.",
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 401 for a key that isn't live", async () => {
    const response = await get({ authorization: "Bearer sb_nope" });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({
      error: "Unknown or revoked API key.",
    });
  });

  it("answers 503 with retry-after when the key store can't say", async () => {
    const response = await get({ authorization: "Bearer sb_down" });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.json()).toMatchObject({
      error: "API keys can't be checked right now.",
    });
  });

  it("answers 200 with the live key's id and today's figures, at cost 0 only, never cached", async () => {
    const response = await get({ authorization: `Bearer ${secret}` });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      id,
      remaining: 5,
      limit: 5,
      resetsAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/),
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(secret, { cost: 0 });
    // Nothing spent: the same figures again.
    expect(
      await (await get({ authorization: `Bearer ${secret}` })).json(),
    ).toMatchObject({ remaining: 5 });
    expect(verify.mock.calls.every(([, options]) => options.cost === 0)).toBe(
      true,
    );
  });

  it("answers the 61st request in a minute from one IP with 429", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = "10.2.0.61";
    for (let i = 0; i < 60; i++) expect((await get({}, ip)).status).toBe(400);

    const limited = await get({ authorization: `Bearer ${secret}` }, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await get({}, "10.2.0.62")).status).toBe(400);
  });
});
