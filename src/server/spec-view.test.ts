import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SpecAnswer } from "~/domain/outcome";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { SpecFormsError } from "~/spec-forms/build";
import { MAX_VIEW_BYTES, tooLargeToView } from "./spec-embed";
import { specView } from "./spec-view";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-spec-view-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const repo = createRepo(db);
const forms = createSpecForms(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
const api = { id: "payco.com/payco-api", vendorId: "payco.com", name: "PayCo" };
repo.upsertApi(api);

function put(text: string, apiVersion: string) {
  return repo.putSpec(api.id, new TextEncoder().encode(text), {
    specVersion: "3.1.0",
    apiVersion,
    format: "json",
  });
}
const v2 = put('{"openapi":"3.1.0","info":{"version":"2"}}', "2");
const v1 = put('{"openapi":"3.1.0","info":{"version":"1"}}', "1");
repo.addSource(
  v2.id,
  "https://payco.com/openapi.json",
  "Official",
  "2026-09-20T10:00:00.000Z",
);
repo.addSource(
  v2.id,
  "https://mirror.example/payco.json",
  "Mirror",
  "2026-09-24T10:00:00.000Z",
);
repo.addSource(
  v1.id,
  "https://payco.com/v1.json",
  "Official",
  "2026-08-01T10:00:00.000Z",
);
// Just over the limit.
const big = '{"openapi":"3.1.0","x":"';
const huge = put(
  `${big}${"a".repeat(MAX_VIEW_BYTES + 1 - big.length - 2)}"}`,
  "3",
);

const answer = (spec: { id: string }): SpecAnswer =>
  ({ ...spec, normalized: "ready" }) as unknown as SpecAnswer;
/** A default Lookup answers v2 as Current, v1 as its Alternate. */
const lookup = {
  currentFromIndex: (apiId: string) =>
    apiId === api.id
      ? ({ currentSpec: answer(v2), alternateSpecs: [answer(v1)] } as never)
      : null,
};

const now = new Date("2026-09-25T12:00:00.000Z");
const view = (id: string, form: "published" | "normalized" = "published") =>
  specView(db, lookup, id, form, { now, freshnessDays: 7 });

function build(id: string, normalized: string) {
  forms.saveBuilt(
    id,
    {
      normalized: new TextEncoder().encode(normalized),
      normalizedSpecVersion: "3.1.1",
      validityIssues: [
        { message: "<b>small</b>", path: "/paths/~1a", count: 1 },
        { message: "big", path: "/paths/~1b", count: 5 },
      ],
      validityFindingCount: 6,
      normalizedFindingCount: 0,
      outline: {
        title: "PayCo",
        apiVersion: "2",
        servers: [],
        securitySchemes: [],
        tags: [],
        operations: [],
      },
    },
    "2026-09-25T10:00:00.000Z",
  );
}

describe("tooLargeToView", () => {
  it("is 10 MB, decimal: 10,000,000 bytes are shown, one more isn't", () => {
    expect(MAX_VIEW_BYTES).toBe(10_000_000);
    expect(tooLargeToView(10_000_000)).toBe(false);
    expect(tooLargeToView(10_000_001)).toBe(true);
  });
});

describe("specView", () => {
  it("gives the Spec's own facts, its forms and the API's other Specs", () => {
    const facts = view(v2.id);

    expect(facts).toMatchObject({
      api,
      vendor: { id: "payco.com", name: "PayCo" },
      spec: { id: v2.id, apiVersion: "2", current: true, superseded: false },
      // The best tier, verified at that tier (not the later Mirror).
      provenance: "Official",
      verifiedAt: "2026-09-20T10:00:00.000Z",
      stale: false,
      form: "published",
      forms: {
        published: {
          bytes: v2.byteLength,
          format: "json",
          url: `/api/specs/${v2.id}/published`,
        },
        normalized: { status: "pending" },
      },
      frame: "show",
      outlineUrl: `/api/apis/${api.id}/outline?specId=${v2.id}`,
      alternates: [
        {
          specId: v1.id,
          apiVersion: "1",
          specVersion: "3.1.0",
          current: false,
        },
      ],
    });
  });

  it("gives the Spec's own Sources, and a name its Lookup answers by", () => {
    const facts = view(v2.id);

    expect(facts?.sources).toEqual([
      {
        id: expect.any(Number),
        url: "https://payco.com/openapi.json",
        provenance: "Official",
        lastVerifiedAt: "2026-09-20T10:00:00.000Z",
      },
      {
        id: expect.any(Number),
        url: "https://mirror.example/payco.json",
        provenance: "Mirror",
        lastVerifiedAt: "2026-09-24T10:00:00.000Z",
      },
    ]);
    expect(view(v1.id)?.sources.map((s) => s.url)).toEqual([
      "https://payco.com/v1.json",
    ]);
    // Nothing remembered for PayCo: its own name.
    expect(facts?.lookupName).toBe("PayCo");
  });

  it("links an Alternate back to the Current Spec, and marks it Stale", () => {
    const facts = view(v1.id);

    expect(facts?.spec.current).toBe(false);
    expect(facts?.stale).toBe(true);
    expect(facts?.alternates).toEqual([
      { specId: v2.id, apiVersion: "2", specVersion: "3.1.0", current: true },
    ]);
  });

  it("waits for a pending Normalized Form, and gives a failed one's reason", () => {
    expect(view(v1.id, "normalized")?.frame).toBe("pending");
    forms.saveFailure(
      v1.id,
      new SpecFormsError("not-openapi", "not an OpenAPI document"),
      "2026-09-25T10:00:00.000Z",
    );
    const failed = view(v1.id, "normalized");
    expect(failed?.frame).toBe("failed");
    expect(failed?.forms.normalized).toEqual({
      status: "failed",
      error: "not an OpenAPI document",
      url: `/api/specs/${v1.id}/normalized`,
    });
  });

  it("sizes a built Normalized Form and lists its Validity Issues, largest first", () => {
    build(v2.id, '{"openapi":"3.1.1"}');

    const facts = view(v2.id, "normalized");

    expect(facts?.frame).toBe("show");
    expect(facts?.forms.normalized).toEqual({
      status: "ready",
      bytes: 19,
      url: `/api/specs/${v2.id}/normalized`,
    });
    expect(facts?.validityFindingCount).toBe(6);
    expect(facts?.validityIssues.map((i) => i.message)).toEqual([
      "big",
      "<b>small</b>",
    ]);
  });

  it("doesn't show the frame for the form over 10 MB, only for that form", () => {
    build(huge.id, '{"openapi":"3.1.1"}');

    expect(view(huge.id, "published")?.frame).toBe("too-large");
    expect(view(huge.id, "normalized")?.frame).toBe("show");
  });

  it("is null for an unknown or malformed Spec id", () => {
    expect(view("0".repeat(64))).toBeNull();
    expect(view("../etc")).toBeNull();
  });
});
