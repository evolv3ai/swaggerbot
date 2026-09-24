import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { rateLimitPerMinute } from "~/lookup/rate-limit";
import { Route as LookupRoute } from "./api/lookup";
import { Route as McpRoute } from "./mcp";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-mcp-route-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The routes' shared app, over an empty Index in a temp database.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
const lookup = Object.assign(
  vi.fn(async () => ({ outcome: "Unknown", name: "x" })),
  { fromIndex: vi.fn(() => null) },
);
createApp.mockImplementation(() => ({ db, lookup, keys: createKeys(db) }));

async function call(
  route: typeof McpRoute | typeof LookupRoute,
  url: string,
  ip: string,
): Promise<Response> {
  const handlers = route.options.server?.handlers as
    | Record<string, (ctx: never) => unknown>
    | undefined;
  const handler = handlers?.POST ?? handlers?.ANY;
  if (typeof handler !== "function") throw new Error("no handler");
  const response = await handler({
    request: new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

const mcp = (ip: string) => call(McpRoute, "http://localhost/mcp", ip);
const lookupPost = (ip: string) =>
  call(LookupRoute, "http://localhost/api/lookup", ip);

describe("/mcp route", () => {
  it("serves MCP", async () => {
    const response = await mcp("198.51.100.1");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"name":"lookup_api"');
  });

  it("shares the per-IP rate limit with /api/lookup, both ways", async () => {
    const limit = rateLimitPerMinute();
    for (let i = 0; i < limit; i++) await lookupPost("198.51.100.2");
    const overMcp = await mcp("198.51.100.2");
    expect(overMcp.status).toBe(429);
    expect(overMcp.headers.get("retry-after")).toBeTruthy();

    for (let i = 0; i < limit; i++) await mcp("198.51.100.3");
    expect((await lookupPost("198.51.100.3")).status).toBe(429);
  });
});
