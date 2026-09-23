import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { Route } from "./vendors/$vendor/apis";

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
