import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Outcome } from "~/domain/outcome";
import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { FakeJudge } from "~/judge/fake";
import { createLookup } from "~/lookup/lookup";
import { Route } from "./lookup";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-route-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The route's real dependencies, faked: an empty APIs.guru, no web search.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
const keys = createKeys(db);
afterAll(() => db.$client.close());
const { secret } = keys.createKey("route test");
const auth = { authorization: `Bearer ${secret}` };
createApp.mockImplementation(() => ({
  keys,
  lookup: createLookup({
    db,
    judge: new FakeJudge(),
    apisGuru: {
      findCandidates: async () => [],
      findVendorApis: async () => [],
    },
    webSearch: null,
    fetcher: createFetcher(),
  }),
}));

async function post(
  body: string,
  headers: Record<string, string> = auth,
): Promise<Response> {
  const handlers = Route.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.POST;
  if (typeof handler !== "function") throw new Error("no POST handler");
  const response = await handler({
    request: new Request("http://localhost/api/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

describe("POST /api/lookup", () => {
  it.each([
    ["no name", { fresh: true }],
    ["a blank name", { name: "  " }],
    ["a non-boolean fresh", { name: "stripe", fresh: "yes" }],
  ])("answers 400 with the issues for %s", async (_, body) => {
    const response = await post(JSON.stringify(body));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.issues.length).toBeGreaterThan(0);
    expect(createApp).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that isn't JSON", async () => {
    expect((await post("name=stripe")).status).toBe(400);
  });

  it("answers 200 with the Outcome for a valid body", async () => {
    const response = await post(
      JSON.stringify({
        name: "no such api",
        allowCommunity: false,
        fresh: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(Outcome.parse(await response.json())).toEqual({
      outcome: "Unknown",
      name: "no such api",
    });
  });

  it("answers 401 for Discovery without a key", async () => {
    const response = await post(JSON.stringify({ name: "no such api" }), {});

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Discovery needs an API key.",
    });
  });

  it("passes allowCommunity through to the Lookup", async () => {
    const lookup = Object.assign(
      vi.fn(async () => ({ outcome: "Unknown", name: "fans" })),
      { fromIndex: vi.fn(() => null) },
    );
    createApp.mockImplementationOnce(() => ({ lookup, keys }));
    // The app is kept on `globalThis` (see `getApp`), which a module reset
    // doesn't clear.
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for("swaggerbot.app")
    ];
    vi.resetModules();
    const { Route: fresh } = await import("./lookup");
    const handlers = fresh.options.server?.handlers;
    const handler = typeof handlers === "function" ? undefined : handlers?.POST;
    if (typeof handler !== "function") throw new Error("no POST handler");

    await handler({
      request: new Request("http://localhost/api/lookup", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ name: "fans", allowCommunity: true }),
      }),
    } as never);

    expect(lookup).toHaveBeenCalledWith({ name: "fans", allowCommunity: true });
  });
});
