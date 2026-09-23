import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { Route } from "./apis/$";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-apis-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The routes' shared app, over an Index in a temp database.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const API = "stripe.com/stripe-api";
const repo = createRepo(db);
repo.upsertVendor({ id: "stripe.com", name: "Stripe", domain: "stripe.com" });
repo.upsertApi({ id: API, vendorId: "stripe.com", name: "Stripe" });
const specId = repo.putSpec(API, new TextEncoder().encode("{}"), {
  specVersion: "3.0.0",
  apiVersion: "2026-09-01",
  format: "json",
}).id;
createSpecForms(db).saveBuilt(
  specId,
  {
    normalized: new TextEncoder().encode(
      JSON.stringify({
        openapi: "3.1.1",
        paths: {
          "/v1/customers": {
            post: { responses: { "200": { description: "Created" } } },
          },
        },
      }),
    ),
    normalizedSpecVersion: "3.1.1",
    validityIssues: [],
    validityFindingCount: 0,
    normalizedFindingCount: 0,
    outline: {
      title: null,
      apiVersion: null,
      servers: [],
      securitySchemes: [],
      tags: [],
      operations: [],
    },
  },
  "2026-09-23T00:00:00.000Z",
);
const currentFromIndex = vi.fn((apiId: string) =>
  apiId === API ? { currentSpec: { id: specId } } : null,
);
createApp.mockImplementation(() => ({ db, lookup: { currentFromIndex } }));

async function get(splat: string, query: string): Promise<Response> {
  const handlers = Route.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.GET;
  if (typeof handler !== "function") throw new Error("no GET handler");
  const response = await handler({
    request: new Request(`http://localhost/api/apis/${splat}?${query}`, {
      headers: { "x-forwarded-for": "10.0.1.1" },
    }),
    params: { _splat: splat },
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

describe("GET /api/apis/{apiId}/operation", () => {
  it("resolves an API id with a slash through the splat", async () => {
    const response = await get(
      `${API}/operation`,
      "method=POST&path=%2Fv1%2Fcustomers",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      apiId: API,
      specId,
      method: "post",
      path: "/v1/customers",
      operation: { responses: { "200": { description: "Created" } } },
    });
    expect(currentFromIndex).toHaveBeenCalledWith(API);
  });

  it("gets 404 for anything else under /api/apis", async () => {
    expect((await get(`${API}/nothing`, "")).status).toBe(404);
  });
});
