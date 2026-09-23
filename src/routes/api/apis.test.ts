import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { FakeJudge } from "~/judge/fake";
import { createLookup } from "~/lookup/lookup";
import { Route } from "./apis/$";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-apis-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The routes' shared app, over an Index in a temp database.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const AT = "2026-09-23T10:00:00.000Z";
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
const lookup = createLookup({
  db,
  judge: new FakeJudge(),
  apisGuru: { findCandidates: async () => [], findVendorApis: async () => [] },
  webSearch: null,
  fetcher: createFetcher(),
  now: () => new Date(AT),
});
createApp.mockImplementation(() => ({ db, lookup, keys: createKeys(db) }));

const repo = createRepo(db);
repo.upsertVendor({ id: "stripe.com", name: "Stripe", domain: "stripe.com" });
repo.upsertApi({
  id: "stripe.com/stripe-api",
  vendorId: "stripe.com",
  name: "Stripe",
});
const specId = repo.putSpec(
  "stripe.com/stripe-api",
  new TextEncoder().encode('{"openapi":"3.0.0"}'),
  { specVersion: "3.0.0", apiVersion: "2024-06-20", format: "json" },
).id;
repo.confirmSpec(specId, AT);
repo.addSource(specId, "https://stripe.com/openapi.json", "Official", AT);
const outline = {
  title: "Stripe API",
  apiVersion: "2024-06-20",
  servers: [],
  securitySchemes: [],
  tags: [],
  operations: [],
};
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
    outline,
  },
  AT,
);

async function get(splat: string, query = ""): Promise<Response> {
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

describe("GET /api/apis/{apiId}/outline", () => {
  it("resolves an apiId with a slash through the splat", async () => {
    const response = await get("stripe.com/stripe-api/outline");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      apiId: "stripe.com/stripe-api",
      specId,
      outline,
    });
  });

  it.each([
    "stripe.com/stripe-api",
    "stripe.com/stripe-api/outlines",
    "outline",
  ])("answers 404 for /api/apis/%s", async (splat) => {
    expect((await get(splat)).status).toBe(404);
  });
});

describe("GET /api/apis/{apiId}/operation", () => {
  it("resolves an API id with a slash through the splat", async () => {
    const response = await get(
      "stripe.com/stripe-api/operation",
      "method=POST&path=%2Fv1%2Fcustomers",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      apiId: "stripe.com/stripe-api",
      specId,
      method: "post",
      path: "/v1/customers",
      operation: { responses: { "200": { description: "Created" } } },
    });
  });
});
