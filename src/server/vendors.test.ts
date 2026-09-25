import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { BadVendorListError, listVendors, vendorsResponse } from "./vendors";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-vendors-list-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const repo = createRepo(db);
/** A Vendor with `apis` APIs in the Index. */
function vendor(id: string, name: string, apis: number): void {
  repo.upsertVendor({ id, name, domain: id });
  for (let i = 0; i < apis; i++)
    repo.upsertApi({
      id: `${id}/api-${i}`,
      vendorId: id,
      name: `${name} ${i}`,
    });
}
vendor("stripe.com", "Stripe", 2);
vendor("zeta.io", "alpha", 1);
vendor("alpha.dev", "Alpha", 1);
vendor("github.com", "GitHub", 3);
vendor("strava.com", "Strava", 1);
vendor("empty.com", "Empty", 0);

const ids = (list: { vendors: { id: string }[] }) =>
  list.vendors.map((v) => v.id);

describe("listVendors", () => {
  it("lists the Vendors with APIs by name ignoring case, then id, with their API counts", () => {
    const list = listVendors(db);
    expect(list.vendors).toEqual([
      { id: "alpha.dev", name: "Alpha", apiCount: 1 },
      { id: "zeta.io", name: "alpha", apiCount: 1 },
      { id: "github.com", name: "GitHub", apiCount: 3 },
      { id: "strava.com", name: "Strava", apiCount: 1 },
      { id: "stripe.com", name: "Stripe", apiCount: 2 },
    ]);
    expect(list.total).toBe(5);
    expect(list.nextCursor).toBeNull();
  });

  it("filters by a substring of the id or the name, ignoring case", () => {
    expect(ids(listVendors(db, { query: "STR" }))).toEqual([
      "strava.com",
      "stripe.com",
    ]);
    expect(ids(listVendors(db, { query: ".io" }))).toEqual(["zeta.io"]);
    expect(ids(listVendors(db, { query: "hub" }))).toEqual(["github.com"]);
    const none = listVendors(db, { query: "empty" });
    expect(none).toEqual({ vendors: [], total: 0, nextCursor: null });
  });

  it("pages across the end", () => {
    const first = listVendors(db, { limit: 2 });
    expect(ids(first)).toEqual(["alpha.dev", "zeta.io"]);
    expect(first).toMatchObject({ total: 5, nextCursor: "2" });
    const second = listVendors(db, { limit: 2, cursor: "2" });
    expect(ids(second)).toEqual(["github.com", "strava.com"]);
    expect(second.nextCursor).toBe("4");
    const last = listVendors(db, { limit: 2, cursor: "4" });
    expect(ids(last)).toEqual(["stripe.com"]);
    expect(last).toMatchObject({ total: 5, nextCursor: null });
    const past = listVendors(db, { limit: 2, cursor: "10" });
    expect(past).toEqual({ vendors: [], total: 5, nextCursor: null });
  });

  it.each(["-1", "abc", "01", "1.5", ""])("rejects the cursor %j", (cursor) => {
    expect(() => listVendors(db, { cursor })).toThrow(BadVendorListError);
  });

  it.each([0, 201, 1.5, Number.NaN])("rejects the limit %s", (limit) => {
    expect(() => listVendors(db, { limit })).toThrow(BadVendorListError);
  });
});

describe("vendorsResponse", () => {
  const get = (search: string) =>
    vendorsResponse(
      new Request(`http://localhost/api/vendors${search}`),
      () => db,
    );

  it("answers the page as JSON", async () => {
    const response = get("?query=str&limit=1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      vendors: [{ id: "strava.com", name: "Strava", apiCount: 1 }],
      total: 2,
      nextCursor: "1",
    });
  });

  it.each(["?limit=0", "?limit=201", "?limit=x", "?cursor=x"])(
    "answers 400 with the reason for %s",
    async (search) => {
      const response = get(search);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.any(String),
      });
    },
  );
});
