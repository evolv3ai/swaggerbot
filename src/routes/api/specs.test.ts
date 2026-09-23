import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { SpecFormsError } from "~/spec-forms/build";
import { Route as LookupRoute } from "./lookup";
import { Route as NormalizedRoute } from "./specs/$specId/normalized";
import { Route as PublishedRoute } from "./specs/$specId/published";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-downloads-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The routes' shared app, over an Index in a temp database.
const createApp = vi.hoisted(() => vi.fn());
vi.mock("~/lookup/app", () => ({ createApp }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
const lookup = Object.assign(
  vi.fn(async () => ({ outcome: "Unknown", name: "x" })),
  { fromIndex: vi.fn(() => null) },
);
createApp.mockImplementation(() => ({ db, lookup, keys: createKeys(db) }));

const repo = createRepo(db);
const forms = createSpecForms(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({
  id: "payco.com/payco-api",
  vendorId: "payco.com",
  name: "PayCo",
});

// Whitespace and key order a re-serialization would lose.
const jsonBytes = new TextEncoder().encode(
  '{\n  "openapi": "3.1.0",  "info": {"version":"1.0.0","title":"PayCo"},\n  "paths": {}\n}\n',
);
const yamlBytes = new TextEncoder().encode(
  "# PayCo\nopenapi: 3.0.3\ninfo:\n  title: PayCo   # note\n  version: '2.0'\npaths: {}\n",
);
function put(bytes: Uint8Array, format: "json" | "yaml"): string {
  return repo.putSpec("payco.com/payco-api", bytes, {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format,
  }).id;
}
const jsonId = put(jsonBytes, "json");
const yamlId = put(yamlBytes, "yaml");
const normalizedBytes = new TextEncoder().encode('{"openapi":"3.1.1"}');

let ipCount = 0;
/** A client IP no other test has used, so each starts with a full bucket. */
function freshIp(): string {
  ipCount += 1;
  return `10.0.0.${ipCount}`;
}

type Route = typeof PublishedRoute | typeof NormalizedRoute;

async function get(
  route: Route,
  specId: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const handlers = route.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.GET;
  if (typeof handler !== "function") throw new Error("no GET handler");
  const response = await handler({
    request: new Request(`http://localhost/api/specs/${specId}/x`, {
      headers: { "x-forwarded-for": freshIp(), ...headers },
    }),
    params: { specId },
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

async function postLookup(ip: string): Promise<Response> {
  const handlers = LookupRoute.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.POST;
  if (typeof handler !== "function") throw new Error("no POST handler");
  const response = await handler({
    request: new Request("http://localhost/api/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "payco" }),
    }),
  } as never);
  if (!(response instanceof Response)) throw new Error("not a Response");
  return response;
}

describe("GET /api/specs/{specId}/published", () => {
  it.each([
    ["JSON", () => jsonId, () => jsonBytes, "application/json", "json"],
    ["YAML", () => yamlId, () => yamlBytes, "application/yaml", "yaml"],
  ])("returns a %s Spec byte for byte", async (_, id, bytes, type, ext) => {
    const response = await get(PublishedRoute, id());

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes());
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="payco-api-${id().slice(0, 12)}.${ext}"`,
    );
    expect(response.headers.get("etag")).toBe(`"${id()}"`);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const response = await get(PublishedRoute, jsonId, {
      "if-none-match": `"other", "${jsonId}"`,
    });

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(`"${jsonId}"`);
    expect(await response.text()).toBe("");
  });

  it("answers 200 to an If-None-Match that doesn't match", async () => {
    const response = await get(PublishedRoute, jsonId, {
      "if-none-match": `"${yamlId}"`,
    });

    expect(response.status).toBe(200);
  });
});

describe("GET /api/specs/{specId}/normalized", () => {
  afterEach(() => {
    // Back to pending: a row that is building.
    forms.markBuilding(jsonId, "2026-09-23T10:00:00.000Z");
  });

  it("answers 409 with retry-after while pending", async () => {
    const response = await get(NormalizedRoute, jsonId);

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(await response.json()).toEqual({ status: "pending" });
  });

  it("returns the Normalized bytes when ready", async () => {
    forms.saveBuilt(
      jsonId,
      {
        normalized: normalizedBytes,
        normalizedSpecVersion: "3.1.1",
        validityIssues: [],
        validityFindingCount: 0,
        normalizedFindingCount: 0,
        outline: {
          title: "PayCo",
          apiVersion: "1.0.0",
          servers: [],
          securitySchemes: [],
          tags: [],
          operations: [],
        },
      },
      "2026-09-23T10:00:00.000Z",
    );

    const response = await get(NormalizedRoute, jsonId);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      normalizedBytes,
    );
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("etag")).toBe(`"${jsonId}-n"`);
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("answers 422 with the error when the build failed", async () => {
    forms.saveFailure(
      jsonId,
      new SpecFormsError("not-openapi", "not an OpenAPI document"),
      "2026-09-23T10:00:00.000Z",
    );

    const response = await get(NormalizedRoute, jsonId);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      status: "failed",
      error: "not an OpenAPI document",
    });
  });
});

describe.each([
  ["published", PublishedRoute],
  ["normalized", NormalizedRoute],
] as const)("GET /api/specs/{specId}/%s", (_, route) => {
  it.each(["abc", jsonId.toUpperCase(), `${jsonId}0`, "g".repeat(64)])(
    "answers 400 for the malformed id %s",
    async (id) => {
      expect((await get(route, id)).status).toBe(400);
    },
  );

  it("answers 404 for an unknown id", async () => {
    expect((await get(route, "0".repeat(64))).status).toBe(404);
  });
});

describe("the per-IP rate limit", () => {
  afterEach(() => vi.useRealTimers());

  it("answers the 61st request in a minute with 429, across lookup and downloads", async () => {
    // A frozen clock, so the bucket doesn't refill while the test runs.
    vi.useFakeTimers({ toFake: ["Date"] });
    const ip = "192.0.2.61";
    const ipHeader = { "x-forwarded-for": ip };
    for (let i = 0; i < 20; i++) {
      // Discovery without a key: 401, but past the rate limit.
      expect((await postLookup(ip)).status).toBe(401);
      expect((await get(PublishedRoute, jsonId, ipHeader)).status).toBe(200);
      expect((await get(NormalizedRoute, jsonId, ipHeader)).status).toBe(409);
    }

    for (const response of [
      await get(PublishedRoute, jsonId, ipHeader),
      await get(NormalizedRoute, jsonId, ipHeader),
      await postLookup(ip),
    ]) {
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    // Another IP is not limited.
    expect((await get(PublishedRoute, jsonId)).status).toBe(200);
  });
});
