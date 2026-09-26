import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, MIGRATIONS_FOLDER, openDb } from "./db";
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

  it("stores a Spec's API Version and Preview flag, not Superseded", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, {
      ...specMeta,
      apiVersion: "2025-01-01.preview",
      isPreview: true,
    });

    expect(spec).toMatchObject({
      apiVersion: "2025-01-01.preview",
      isPreview: true,
      supersededAt: null,
    });
  });

  it("defaults is_preview to 0 and superseded_at to null in the migrated table", () => {
    const columns = db.$client.pragma("table_info(specs)") as {
      name: string;
      type: string;
      notnull: number;
    }[];
    expect(columns.find((c) => c.name === "is_preview")).toMatchObject({
      type: "INTEGER",
      notnull: 1,
    });
    expect(columns.find((c) => c.name === "superseded_at")).toMatchObject({
      type: "TEXT",
      notnull: 0,
    });

    // A row written without them, as by code from before the migration.
    db.$client
      .prepare(
        "INSERT INTO specs (id, api_id, spec_version, format, byte_length, published_bytes) VALUES (?, ?, '3.0.0', 'json', 1, x'00')",
      )
      .run("f".repeat(64), stripeApi.id);
    expect(
      db.$client
        .prepare("SELECT is_preview, superseded_at FROM specs WHERE id = ?")
        .get("f".repeat(64)),
    ).toEqual({ is_preview: 0, superseded_at: null });
  });

  it("marks a Spec Superseded once, and clears it when its bytes are put again", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, specMeta);
    const stored = () => repo.getApiWithSpecs(stripeApi.id)?.specs[0]?.spec;

    repo.supersedeSpec(spec.id, "2026-09-01T00:00:00.000Z");
    repo.supersedeSpec(spec.id, "2026-09-22T00:00:00.000Z");
    expect(stored()?.supersededAt).toBe("2026-09-01T00:00:00.000Z");

    const again = repo.putSpec(stripeApi.id, specBytes, specMeta);
    expect(again.supersededAt).toBeNull();
    expect(stored()?.supersededAt).toBeNull();
  });

  it("stores a Spec's path count, deprecation and origin rank, outside the domain Spec", () => {
    const spec = repo.putSpec(stripeApi.id, specBytes, {
      ...specMeta,
      pathCount: 187,
      deprecated: true,
      originRank: 2,
    });

    expect(spec).not.toHaveProperty("pathCount");
    expect(repo.getApiWithSpecs(stripeApi.id)?.specs[0]).toMatchObject({
      spec,
      pathCount: 187,
      deprecated: true,
      originRank: 2,
    });
  });

  it("takes the path count, deprecation and origin rank as read now when the same bytes are put again", () => {
    repo.putSpec(stripeApi.id, specBytes, {
      ...specMeta,
      pathCount: 187,
      deprecated: true,
      originRank: 2,
    });
    repo.putSpec(stripeApi.id, specBytes, {
      ...specMeta,
      pathCount: 190,
      deprecated: false,
      originRank: 0,
    });

    expect(repo.getApiWithSpecs(stripeApi.id)?.specs[0]).toMatchObject({
      pathCount: 190,
      deprecated: false,
      originRank: 0,
    });
  });

  it("finds an API by a remembered name, however it is written", () => {
    repo.rememberName("stripe", stripeApi.id);

    expect(repo.findApiByName("Stripe API ")).toEqual(stripeApi);
    expect(repo.findApiByName("stripe-js")).toBeUndefined();
  });

  it("names an API for a link to its Lookup by a name the Index answers", () => {
    const api = {
      id: "acme.dev/widgets",
      vendorId: stripe.id,
      name: "Acme Widgets REST API",
    };
    repo.upsertApi(api);
    // Nothing remembered: its own name.
    expect(repo.lookupNameOf(api)).toBe("Acme Widgets REST API");
    repo.rememberName("acme widgets platform", api.id);
    repo.rememberName("widgets", api.id);
    // Its own name isn't remembered: the shortest name that is.
    expect(repo.lookupNameOf(api)).toBe("widgets");
    repo.rememberName("acme widgets rest", api.id);
    // Remembered (without " API", as normalizeName keeps it): its own name.
    expect(repo.lookupNameOf(api)).toBe("Acme Widgets REST API");
  });

  it("returns undefined for an API that is not in the Index", () => {
    expect(repo.getApiWithSpecs("stripe.com/nope")).toBeUndefined();
  });
});

describe("migration 0003", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swaggerbot-migrate-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a Spec stored before it with no path count, not deprecated and no origin rank", () => {
    // The migrations up to 0002 only, as a database from before this one.
    const before = join(dir, "drizzle");
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 2,
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(dir, "old.db");
    const sqlite = new Database(path);
    migrate(drizzle({ client: sqlite }), { migrationsFolder: before });
    sqlite
      .prepare("INSERT INTO vendors (id, name, domain) VALUES (?, ?, ?)")
      .run(stripe.id, stripe.name, stripe.domain);
    sqlite
      .prepare("INSERT INTO apis (id, vendor_id, name) VALUES (?, ?, ?)")
      .run(stripeApi.id, stripe.id, stripeApi.name);
    sqlite
      .prepare(
        "INSERT INTO specs (id, api_id, spec_version, format, byte_length, published_bytes) VALUES (?, ?, '3.0.0', 'json', 1, x'00')",
      )
      .run("f".repeat(64), stripeApi.id);
    sqlite.close();

    const db = openDb(path);
    try {
      expect(createRepo(db).getApiWithSpecs(stripeApi.id)?.specs).toEqual([
        expect.objectContaining({
          pathCount: null,
          deprecated: false,
          originRank: null,
        }),
      ]);
    } finally {
      db.$client.close();
    }
  });
});
