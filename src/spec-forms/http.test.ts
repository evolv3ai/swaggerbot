import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SpecOutline } from "~/domain/spec-forms";
import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { FakeJudge } from "~/judge/fake";
import { createLookup } from "~/lookup/lookup";
import { SpecFormsError } from "./build";
import { type OutlineApp, outlineResponse } from "./http";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-outline-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const AT = "2026-09-23T10:00:00.000Z";
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());
const repo = createRepo(db);
const forms = createSpecForms(db);
const app: OutlineApp = {
  db,
  lookup: createLookup({
    db,
    judge: new FakeJudge(),
    apisGuru: {
      findCandidates: async () => [],
      findVendorApis: async () => [],
    },
    webSearch: null,
    fetcher: createFetcher(),
    now: () => new Date(AT),
  }),
};

/** A confirmed Spec of `apiId` at `apiVersion`, with an Official Source. */
function putSpec(apiId: string, apiVersion: string): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: apiId, version: apiVersion },
    }),
  );
  const { id } = repo.putSpec(apiId, bytes, {
    specVersion: "3.1.0",
    apiVersion,
    format: "json",
  });
  repo.confirmSpec(id, AT);
  repo.addSource(id, `https://${apiId}/${apiVersion}.json`, "Official", AT);
  return id;
}

function outlineOf(title: string): SpecOutline {
  return {
    title,
    apiVersion: "1.0",
    servers: ["https://api.payco.com"],
    securitySchemes: [{ name: "bearer", type: "http", scheme: "bearer" }],
    tags: [{ name: "charges", operationCount: 1 }],
    operations: [
      {
        method: "get",
        path: "/charges",
        summary: "List charges",
        tags: ["charges"],
      },
    ],
  };
}

function saveBuilt(specId: string, outline: SpecOutline): void {
  forms.saveBuilt(
    specId,
    {
      normalized: new TextEncoder().encode('{"openapi":"3.1.1"}'),
      normalizedSpecVersion: "3.1.1",
      validityIssues: [],
      validityFindingCount: 0,
      normalizedFindingCount: 0,
      outline,
    },
    AT,
  );
}

repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({
  id: "payco.com/payco-api",
  vendorId: "payco.com",
  name: "PayCo",
});
repo.upsertApi({
  id: "payco.com/other-api",
  vendorId: "payco.com",
  name: "Other",
});
repo.upsertApi({
  id: "payco.com/nospec-api",
  vendorId: "payco.com",
  name: "None",
});
const alternateId = putSpec("payco.com/payco-api", "1.0");
const currentId = putSpec("payco.com/payco-api", "2.0");
const otherId = putSpec("payco.com/other-api", "1.0");
saveBuilt(alternateId, outlineOf("PayCo v1"));
saveBuilt(currentId, outlineOf("PayCo v2"));

function get(
  apiId: string,
  query = "",
  getApp: () => OutlineApp = () => app,
  baseUrl?: string,
): Response {
  const request = new Request(
    `http://localhost/api/apis/${apiId}/outline${query}`,
  );
  return outlineResponse(request, apiId, getApp, baseUrl);
}

describe("outlineResponse", () => {
  it("returns the Current Spec's outline by apiId", async () => {
    const response = get("payco.com/payco-api");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apiId: "payco.com/payco-api",
      specId: currentId,
      specVersion: "3.1.0",
      normalized: "ready",
      outline: outlineOf("PayCo v2"),
      downloads: {
        published: `/api/specs/${currentId}/published`,
        normalized: `/api/specs/${currentId}/normalized`,
      },
    });
  });

  it("returns an Alternate's outline by specId, with download URLs under the base URL", async () => {
    const response = get(
      "payco.com/payco-api",
      `?specId=${alternateId}`,
      () => app,
      "https://swaggerbot.dev/",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      specId: alternateId,
      outline: outlineOf("PayCo v1"),
      downloads: {
        published: `https://swaggerbot.dev/api/specs/${alternateId}/published`,
        normalized: `https://swaggerbot.dev/api/specs/${alternateId}/normalized`,
      },
    });
  });

  it("answers 404 for a specId of another API", async () => {
    const response = get("payco.com/payco-api", `?specId=${otherId}`);

    expect(response.status).toBe(404);
  });

  it("answers 400 for a malformed specId", async () => {
    expect(get("payco.com/payco-api", "?specId=abc").status).toBe(400);
  });

  it("answers 409 with retry-after while the forms are pending", async () => {
    const response = get("payco.com/other-api");

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(await response.json()).toEqual({ status: "pending" });
  });

  it("answers 422 with the error when the forms failed", async () => {
    const failedId = putSpec("payco.com/other-api", "0.9");
    forms.saveFailure(
      failedId,
      new SpecFormsError("not-openapi", "not an OpenAPI document"),
      AT,
    );

    const response = get("payco.com/other-api", `?specId=${failedId}`);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      status: "failed",
      error: "not an OpenAPI document",
    });
  });

  it.each([
    ["an unknown", "payco.com/no-such-api"],
    ["a Spec-less", "payco.com/nospec-api"],
    ["a malformed", "payco-api"],
    ["an uppercase", "PayCo.com/payco-api"],
  ])("answers 404 with a Lookup hint for %s apiId", async (_, apiId) => {
    const response = get(apiId);

    expect(response.status).toBe(404);
    expect((await response.json()).hint).toContain("POST /api/lookup");
  });

  it("does not build the app for a malformed apiId", () => {
    const getApp = vi.fn(() => app);

    get("not an id", "", getApp);

    expect(getApp).not.toHaveBeenCalled();
  });

  it("never reads the Normalized Form", () => {
    const spy = vi.spyOn(db.$client, "prepare");

    get("payco.com/payco-api");

    const sql = spy.mock.calls.map(([s]) => s).join("\n");
    spy.mockRestore();
    expect(sql).toContain('"outline"');
    expect(sql).not.toContain("normalized_bytes");
    expect(sql).not.toContain("published_bytes");
  });
});
