import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { FakeJudge } from "~/judge/fake";
import { createLookup } from "~/lookup/lookup";
import { vendorPage, vendorsPage } from "./index-browsing";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-index-browsing-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

/** A dependency the pages must never touch: any use of it throws. */
function unused<T>(name: string): T {
  return new Proxy({} as object, {
    get: () => {
      throw new Error(`${name} used`);
    },
  }) as T;
}

const judge = new FakeJudge();
const lookup = createLookup({
  db,
  judge,
  apisGuru: unused("APIs.guru"),
  webSearch: null,
  fetcher: unused("the fetcher"),
  publicBaseUrl: "https://swaggerbot.test",
});
const app = { db, lookup };
const repo = createRepo(db);

/** Stores an Official Spec of the API, confirmed at `verifiedAt` unless null. */
function spec(apiId: string, verifiedAt: string | null): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: apiId, version: "1.0.0" },
      paths: {},
    }),
  );
  const { id } = repo.putSpec(apiId, bytes, {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format: "json",
  });
  const at = verifiedAt ?? "2026-09-01T00:00:00.000Z";
  if (verifiedAt) repo.confirmSpec(id, verifiedAt);
  repo.addSource(id, `https://${apiId}.json`, "Official", at);
  return id;
}

// Five Vendors with APIs (Alpha to Echo), one without (not listed).
for (const [id, name, apiCount] of [
  ["echo.io", "Echo", 1],
  ["alpha.com", "Alpha", 2],
  ["delta.dev", "Delta", 1],
  ["bravo.com", "Bravo", 3],
  ["charlie.net", "Charlie", 1],
] as const) {
  repo.upsertVendor({ id, name, domain: id });
  for (let n = 1; n <= apiCount; n++)
    repo.upsertApi({ id: `${id}/api-${n}`, vendorId: id, name: `API ${n}` });
}
repo.upsertVendor({ id: "empty.org", name: "Empty", domain: "empty.org" });

const fresh = spec("bravo.com/api-1", "2026-09-24T10:00:00.000Z");
const old = spec("bravo.com/api-2", "2026-09-01T10:00:00.000Z");
spec("bravo.com/api-3", null);

// Two Vendors that share a name.
repo.upsertVendor({ id: "acme.com", name: "Acme", domain: "acme.com" });
repo.upsertVendor({ id: "acme.io", name: "ACME", domain: "acme.io" });

describe("vendorsPage", () => {
  it("lists the first page, ordered by name, with the link to the next", () => {
    const page = vendorsPage(db, {}, { limit: 2 });

    expect(page).toEqual({
      status: 200,
      query: "",
      vendors: [
        { id: "alpha.com", name: "Alpha", apiCount: 2 },
        { id: "bravo.com", name: "Bravo", apiCount: 3 },
      ],
      total: 5,
      from: 1,
      to: 2,
      previous: null,
      next: "/vendors?cursor=2",
    });
  });

  it("pages forward to the end and back, and links the first page without a cursor", () => {
    const second = vendorsPage(db, { cursor: "2" }, { limit: 2 });
    expect(second).toMatchObject({
      vendors: [{ id: "charlie.net" }, { id: "delta.dev" }],
      from: 3,
      to: 4,
      previous: "/vendors",
      next: "/vendors?cursor=4",
    });

    const last = vendorsPage(db, { cursor: "4" }, { limit: 2 });
    expect(last).toMatchObject({
      vendors: [{ id: "echo.io" }],
      from: 5,
      to: 5,
      previous: "/vendors?cursor=2",
      next: null,
    });

    const past = vendorsPage(db, { cursor: "9" }, { limit: 2 });
    expect(past).toMatchObject({
      vendors: [],
      total: 5,
      from: 0,
      previous: "/vendors?cursor=7",
      next: null,
    });
  });

  it("keeps the filter on every page link", () => {
    const page = vendorsPage(db, { query: " A " }, { limit: 1 });

    // Alpha, Bravo, Charlie and Delta have an "a"; Echo doesn't.
    expect(page).toMatchObject({
      query: "A",
      total: 4,
      vendors: [{ id: "alpha.com" }],
      next: "/vendors?query=A&cursor=1",
    });
    expect(
      vendorsPage(db, { query: "A", cursor: "1" }, { limit: 1 }),
    ).toMatchObject({
      vendors: [{ id: "bravo.com" }],
      previous: "/vendors?query=A",
    });
  });

  it("uses 50 a page by default", () => {
    const page = vendorsPage(db, {});
    expect(page).toMatchObject({ total: 5, from: 1, to: 5, next: null });
  });

  it("answers 400 for a cursor it didn't make, linking the first page", () => {
    expect(vendorsPage(db, { query: "a", cursor: "-1" })).toEqual({
      status: 400,
      query: "a",
      error: "That page link isn't one this list made.",
      first: "/vendors?query=a",
    });
  });

  it("treats a blank filter and cursor as none", () => {
    expect(vendorsPage(db, { query: "  ", cursor: "" })).toMatchObject({
      status: 200,
      query: "",
      total: 5,
    });
  });
});

describe("vendorPage", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");

  it("shows the Vendor and each API's Current Spec, Stale past the freshness window", () => {
    expect(vendorPage("bravo.com", app, { now, freshnessDays: 7 })).toEqual({
      status: 200,
      vendor: { id: "bravo.com", name: "Bravo", domain: "bravo.com" },
      apis: [
        {
          id: "bravo.com/api-1",
          name: "API 1",
          lookupName: "API 1",
          currentSpec: {
            id: fresh,
            provenance: "Official",
            verifiedAt: "2026-09-24T10:00:00.000Z",
            stale: false,
          },
        },
        {
          id: "bravo.com/api-2",
          name: "API 2",
          lookupName: "API 2",
          currentSpec: {
            id: old,
            provenance: "Official",
            verifiedAt: "2026-09-01T10:00:00.000Z",
            stale: true,
          },
        },
        // Its only Spec isn't confirmed.
        {
          id: "bravo.com/api-3",
          name: "API 3",
          lookupName: "API 3",
          currentSpec: null,
        },
      ],
    });
    expect(judge.calls).toEqual([]);
  });

  it("finds the Vendor as answerVendorApis does, by name too", () => {
    expect(vendorPage("Bravo", app, { now, freshnessDays: 7 })).toMatchObject({
      status: 200,
      vendor: { id: "bravo.com" },
    });
  });

  it("lists the matching Vendors when several match (300)", () => {
    expect(vendorPage("acme", app, { now, freshnessDays: 7 })).toEqual({
      status: 300,
      asked: "acme",
      vendors: [
        { id: "acme.com", name: "Acme" },
        { id: "acme.io", name: "ACME" },
      ],
    });
  });

  it("says a Vendor isn't in the Index (404)", () => {
    expect(
      vendorPage(" nowhere.test ", app, { now, freshnessDays: 7 }),
    ).toEqual({ status: 404, asked: "nowhere.test" });
  });
});
