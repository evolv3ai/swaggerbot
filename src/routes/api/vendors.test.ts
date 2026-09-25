import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { Route } from "./vendors/$vendor/apis";
import { Route as VendorsRoute } from "./vendors/index";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-vendors-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The routes' shared app, over an Index in a temp database.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
const currentFromIndex = vi.fn(() => null);
createApp.mockImplementation(() => ({ db, lookup: { currentFromIndex } }));

const repo = createRepo(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({ id: "payco.com/payco", vendorId: "payco.com", name: "PayCo" });

async function get(vendor: string): Promise<Response> {
  const handlers = Route.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.GET;
  if (typeof handler !== "function") throw new Error("no GET handler");
  const response = await handler({
    request: new Request(
      `http://localhost/api/vendors/${encodeURIComponent(vendor)}/apis`,
      { headers: { "x-forwarded-for": "10.1.0.1" } },
    ),
    params: { vendor },
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

describe("GET /api/vendors/{vendor}/apis", () => {
  it("lists the Vendor's APIs from the shared app's Index", async () => {
    const response = await get("https://www.payco.com/docs");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      vendor: { id: "payco.com" },
      apis: [{ api: { id: "payco.com/payco" }, currentSpec: null }],
    });
    expect(currentFromIndex).toHaveBeenCalledWith("payco.com/payco");
  });

  it("answers 404 for a Vendor not in the Index", async () => {
    expect((await get("nobody.com")).status).toBe(404);
  });
});

async function getVendors(search: string, ip: string): Promise<Response> {
  const handlers = VendorsRoute.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.GET;
  if (typeof handler !== "function") throw new Error("no GET handler");
  const response = await handler({
    request: new Request(`http://localhost/api/vendors${search}`, {
      headers: { "x-forwarded-for": ip },
    }),
    params: {},
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

describe("GET /api/vendors", () => {
  afterEach(() => vi.useRealTimers());

  it("lists the Vendors in the shared app's Index", async () => {
    const response = await getVendors("?query=pay", "10.1.0.2");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      vendors: [{ id: "payco.com", name: "PayCo", apiCount: 1 }],
      total: 1,
      nextCursor: null,
    });
  });

  it("answers a bad cursor with a JSON 400", async () => {
    const response = await getVendors("?cursor=nope", "10.1.0.3");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it("answers the 61st request in a minute from one IP with 429", async () => {
    // A frozen clock, so the bucket doesn't refill while the test runs.
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = "10.1.0.61";
    for (let i = 0; i < 60; i++)
      expect((await getVendors("", ip)).status).toBe(200);

    const limited = await getVendors("", ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another IP is not limited.
    expect((await getVendors("", "10.1.0.62")).status).toBe(200);
  });
});
