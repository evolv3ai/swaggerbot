import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { SpecForms } from "./build";
import {
  createNormalizedCache,
  type NormalizedParser,
  type OperationDeps,
  operationResponse,
} from "./operation-http";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-operation-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const AT = "2026-09-23T00:00:00.000Z";
const API = "payco.com/payco-api";
const repo = createRepo(db);
const forms = createSpecForms(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({ id: API, vendorId: "payco.com", name: "PayCo" });
repo.upsertApi({
  id: "payco.com/other-api",
  vendorId: "payco.com",
  name: "Other",
});

const normalized = {
  openapi: "3.1.1",
  info: { title: "PayCo", version: "1.0.0" },
  paths: {
    "/v1/customers/{customer}": {
      get: {
        operationId: "getCustomer",
        responses: { "200": { $ref: "#/components/responses/Customer" } },
      },
    },
  },
  components: {
    responses: { Customer: { description: "A customer" } },
  },
};

function putSpec(label: string, apiId = API): string {
  return repo.putSpec(apiId, new TextEncoder().encode(`{"n":"${label}"}`), {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format: "json",
  }).id;
}
function build(specId: string): void {
  const built: SpecForms = {
    normalized: new TextEncoder().encode(JSON.stringify(normalized)),
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
  };
  forms.saveBuilt(specId, built, AT);
}

const current = putSpec("current");
build(current);
const alternate = putSpec("alternate");
build(alternate);
const pending = putSpec("pending");
const failed = putSpec("failed");
forms.saveFailure(failed, new Error("not OpenAPI"), AT);
forms.saveFailure(failed, new Error("not OpenAPI"), AT);
forms.saveFailure(failed, new Error("not OpenAPI"), AT);
const otherApis = putSpec("other", "payco.com/other-api");

/** An Index whose Current Spec of `API` is `currentId`. */
function deps(
  currentId = current,
  parse: NormalizedParser = (bytes) =>
    JSON.parse(new TextDecoder().decode(bytes)),
): OperationDeps {
  return {
    db,
    lookup: {
      currentFromIndex: (apiId) =>
        apiId === API ? ({ currentSpec: { id: currentId } } as never) : null,
    },
    cache: createNormalizedCache(parse),
  };
}

function url(query: Record<string, string>, apiId = API): URL {
  const u = new URL(`http://localhost/api/apis/${apiId}/operation`);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u;
}

const PATH = "/v1/customers/{customer}";

describe("operationResponse", () => {
  it("expands the Current Spec's operation, whatever the method's case", async () => {
    for (const method of ["get", "GET"]) {
      const response = await operationResponse(
        url({ method, path: PATH }),
        API,
        deps(),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        apiId: API,
        specId: current,
        method: "get",
        path: PATH,
        operation: {
          operationId: "getCustomer",
          responses: { "200": { description: "A customer" } },
        },
        circular: {},
        securitySchemes: {},
        truncated: false,
      });
    }
  });

  it("expands an Alternate's operation by specId", async () => {
    const response = await operationResponse(
      url({ method: "get", path: PATH, specId: alternate }),
      API,
      deps(),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).specId).toBe(alternate);
  });

  it("gets 404 with the outline route as a hint for an unknown path or method", async () => {
    for (const query of [
      { method: "post", path: PATH },
      { method: "get", path: "/v1/customers/{id}" },
      { method: "get", path: "/v1/customers/{customer}/" },
    ]) {
      const response = await operationResponse(url(query), API, deps());
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toEqual(expect.any(String));
      expect(body.hint).toContain(`GET /api/apis/${API}/outline`);
    }
  });

  it("gets 404 for an API not in the Index, or a Spec of another API", async () => {
    for (const [apiId, query] of [
      ["nope.com/nope-api", { method: "get", path: PATH }],
      ["not an id", { method: "get", path: PATH }],
      [API, { method: "get", path: PATH, specId: otherApis }],
      [API, { method: "get", path: PATH, specId: "abc" }],
    ] as const) {
      const response = await operationResponse(
        url(query, apiId),
        apiId,
        deps(),
      );
      expect(response.status).toBe(404);
      expect((await response.json()).error).toEqual(expect.any(String));
    }
  });

  it("gets 400 without method or path", async () => {
    for (const query of [{ method: "get" }, { path: PATH }, {}] as Record<
      string,
      string
    >[]) {
      const response = await operationResponse(url(query), API, deps());
      expect(response.status).toBe(400);
    }
  });

  it("gets 409 while the forms are pending, and 422 when they failed", async () => {
    const waiting = await operationResponse(
      url({ method: "get", path: PATH }),
      API,
      deps(pending),
    );
    expect(waiting.status).toBe(409);
    expect(waiting.headers.get("retry-after")).toBe("10");
    expect(await waiting.json()).toEqual({ status: "pending" });

    const broken = await operationResponse(
      url({ method: "get", path: PATH }),
      API,
      deps(failed),
    );
    expect(broken.status).toBe(422);
    expect(await broken.json()).toEqual({
      status: "failed",
      error: "not OpenAPI",
    });
  });

  it("parses a Spec once for concurrent requests, and again only after another Spec", async () => {
    const parse = vi.fn(async (bytes: Uint8Array) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return JSON.parse(new TextDecoder().decode(bytes));
    });
    const shared = deps(current, parse);
    const ask = (specId: string) =>
      operationResponse(
        url({ method: "get", path: PATH, specId }),
        API,
        shared,
      );

    const answers = await Promise.all([ask(current), ask(current)]);
    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    expect(parse).toHaveBeenCalledTimes(1);

    await ask(current);
    expect(parse).toHaveBeenCalledTimes(1);

    // Another Spec replaces the one held.
    await ask(alternate);
    await ask(current);
    expect(parse).toHaveBeenCalledTimes(3);
  });
});
