import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "./db";
import { createRepo, normalizeName, type Repo, specIdOf } from "./repo";
import { apis, specs, vendors } from "./schema";

const stripe = { id: "stripe.com", name: "Stripe", domain: "stripe.com" };
const stripeApi = {
  id: "stripe.com/stripe-api",
  vendorId: "stripe.com",
  name: "Stripe API",
};
const specBytes = new TextEncoder().encode('{"openapi":"3.0.0"}');
const specMeta = {
  specVersion: "3.0.0",
  apiVersion: "2024-06-20",
  format: "json",
} as const;

describe("normalizeName", () => {
  it.each([
    ["Stripe API ", "stripe"],
    ["  Jira   Cloud\tPlatform  ", "jira cloud platform"],
    ["stripe api", "stripe"],
    ["Rapid", "rapid"],
    ["API", "api"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe("repo", () => {
  let dir: string;
  let db: Db;
  let repo: Repo;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-repo-"));
    db = openDb(join(dir, "test.db"));
    repo = createRepo(db);
    repo.upsertVendor(stripe);
    repo.upsertApi(stripeApi);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("upserts Vendors and APIs idempotently, updating their fields", () => {
    repo.upsertVendor(stripe);
    repo.upsertVendor({ ...stripe, name: "Stripe, Inc." });
    repo.upsertApi(stripeApi);

    expect(db.select().from(vendors).all()).toHaveLength(1);
    expect(db.select().from(vendors).get()?.name).toBe("Stripe, Inc.");
    expect(db.select().from(apis).all()).toHaveLength(1);
  });

  it("rejects ids that are not slugs", () => {
    expect(() => repo.upsertVendor({ ...stripe, id: "Stripe Inc" })).toThrow();
  });

  it("stores one Spec for the same bytes put twice, keyed by sha256", () => {
    const first = repo.putSpec(stripeApi.id, specBytes, specMeta);
    const second = repo.putSpec(stripeApi.id, specBytes, specMeta);

    expect(second).toEqual(first);
    expect(first.id).toBe(specIdOf(specBytes));
    expect(first.id).toMatch(/^[0-9a-f]{64}$/);
    expect(first.byteLength).toBe(specBytes.byteLength);
    expect(db.select().from(specs).all()).toHaveLength(1);
    expect(
      Buffer.compare(
        db.select().from(specs).get()?.publishedBytes ?? Buffer.alloc(0),
        Buffer.from(specBytes),
      ),
    ).toBe(0);
  });

  it("round-trips a Source's Provenance and is idempotent on its url", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, specMeta);
    const url = "https://raw.githubusercontent.com/stripe/openapi/spec3.json";
    const source = repo.addSource(spec.id, url, "Official");
    const again = repo.addSource(spec.id, url, "Official");
    repo.addSource(spec.id, "https://api.apis.guru/stripe.json", "Mirror");

    expect(again).toEqual(source);
    expect(source.provenance).toBe("Official");
    expect(source.firstSeenAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );

    const found = repo.getApiWithSpecs(stripeApi.id);
    expect(found?.vendor).toEqual(stripe);
    expect(found?.api).toEqual(stripeApi);
    expect(found?.specs).toHaveLength(1);
    expect(found?.specs[0]?.spec).toEqual(spec);
    expect(found?.specs[0]?.sources.map((s) => [s.url, s.provenance])).toEqual([
      [url, "Official"],
      ["https://api.apis.guru/stripe.json", "Mirror"],
    ]);
  });

  it("stamps a Source with the time it was verified", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, specMeta);
    const url = "https://raw.githubusercontent.com/stripe/openapi/spec3.json";
    const first = repo.addSource(
      spec.id,
      url,
      "Official",
      "2026-09-01T00:00:00.000Z",
    );
    const again = repo.addSource(
      spec.id,
      url,
      "Official",
      "2026-09-22T00:00:00.000Z",
    );

    expect(first.firstSeenAt).toBe("2026-09-01T00:00:00.000Z");
    expect(again).toEqual({
      ...first,
      lastVerifiedAt: "2026-09-22T00:00:00.000Z",
    });
  });

  it("re-tiers a Source verified again", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, specMeta);
    const url = "https://example.test/stripe.json";
    repo.addSource(spec.id, url, "Community", "2026-09-01T00:00:00.000Z");
    const again = repo.addSource(
      spec.id,
      url,
      "Mirror",
      "2026-09-22T00:00:00.000Z",
    );

    expect(again.provenance).toBe("Mirror");
  });

  it("keeps a Spec unconfirmed until it is confirmed, then keeps the first confirmation", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, specMeta);
    const confirmed = () =>
      repo.getApiWithSpecs(stripeApi.id)?.specs[0]?.confirmedAt;

    expect(confirmed()).toBeNull();
    repo.confirmSpec(spec.id, "2026-09-01T00:00:00.000Z");
    repo.confirmSpec(spec.id, "2026-09-22T00:00:00.000Z");
    expect(confirmed()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("finds an API by a remembered name, however it is written", () => {
    repo.rememberName("stripe", stripeApi.id);

    expect(repo.findApiByName("Stripe API ")).toEqual(stripeApi);
    expect(repo.findApiByName("stripe-js")).toBeUndefined();
  });

  it("returns undefined for an API that is not in the Index", () => {
    expect(repo.getApiWithSpecs("stripe.com/nope")).toBeUndefined();
  });
});
