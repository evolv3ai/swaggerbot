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
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FORMS_BUILDER_VERSION,
  type SpecForms,
  SpecFormsError,
} from "~/spec-forms/build";
import { type Db, MIGRATIONS_FOLDER, openDb } from "./db";
import { createRepo, type Repo } from "./repo";
import { specForms, specs } from "./schema";
import {
  createSpecForms,
  MAX_FORMS_ATTEMPTS,
  type SpecFormsRepo,
} from "./spec-forms";

const vendor = { id: "payco.com", name: "PayCo", domain: "payco.com" };
const api = { id: "payco.com/payco-api", vendorId: vendor.id, name: "PayCo" };

const AT = "2026-09-23T10:00:00.000Z";

const built: SpecForms = {
  normalized: new TextEncoder().encode('{"openapi":"3.1.1"}'),
  normalizedSpecVersion: "3.1.1",
  validityIssues: [{ message: "Bad thing", path: "/paths/~1a", count: 2 }],
  validityFindingCount: 2,
  normalizedFindingCount: 0,
  outline: {
    title: "PayCo",
    apiVersion: "1.0.0",
    servers: ["https://api.payco.com"],
    securitySchemes: [{ name: "key", type: "apiKey", in: "header" }],
    tags: [{ name: "payments", operationCount: 1 }],
    operations: [
      {
        method: "get",
        path: "/payments",
        tags: ["payments"],
        deprecated: true,
      },
    ],
  },
};

let dir: string;
let db: Db;
let repo: Repo;
let forms: SpecFormsRepo;

/** Stores a Spec with this body, created at `createdAt`; its id. */
function putSpec(body: string, createdAt: string): string {
  const spec = repo.putSpec(api.id, new TextEncoder().encode(body), {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format: "json",
  });
  db.update(specs).set({ createdAt }).where(eq(specs.id, spec.id)).run();
  return spec.id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-spec-forms-"));
  db = openDb(join(dir, "index.db"));
  repo = createRepo(db);
  forms = createSpecForms(db);
  repo.upsertVendor(vendor);
  repo.upsertApi(api);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("createSpecForms", () => {
  it("picks the oldest Spec with no row, and none when there is no Spec", () => {
    expect(forms.nextToBuild("local")).toBeUndefined();
    const newer = putSpec('{"n":2}', "2026-09-22T00:00:00.000Z");
    const older = putSpec('{"n":1}', "2026-09-21T00:00:00.000Z");

    expect(forms.nextToBuild("local")).toBe(older);
    expect(forms.getForms(older)).toEqual({ status: "pending" });
    forms.markBuilding(older, AT);
    forms.saveBuilt(older, built, AT);
    expect(forms.nextToBuild("local")).toBe(newer);
  });

  it("picks a Spec not yet tried before an older one being retried", () => {
    const older = putSpec('{"n":1}', "2026-09-21T00:00:00.000Z");
    forms.markBuilding(older, AT);
    forms.saveFailure(older, new Error("boom"), AT);
    const newer = putSpec('{"n":2}', "2026-09-22T00:00:00.000Z");

    expect(forms.nextToBuild("local")).toBe(newer);
    forms.markBuilding(newer, AT);
    forms.saveFailure(newer, new Error("boom"), AT);
    expect(forms.nextToBuild("local")).toBe(older);
  });

  it("is ready after saveBuilt, and getForms returns what was saved", () => {
    const id = putSpec("{}", AT);
    forms.markBuilding(id, AT);
    expect(forms.getForms(id)).toEqual({ status: "pending" });
    expect(forms.getNormalizedBytes(id)).toBeUndefined();

    forms.saveBuilt(id, built, AT);

    expect(forms.getForms(id)).toEqual({
      status: "ready",
      normalizedSpecVersion: "3.1.1",
      validityIssues: built.validityIssues,
      validityFindingCount: 2,
      normalizedFindingCount: 0,
      outline: built.outline,
    });
    expect(forms.getNormalizedBytes(id)).toEqual(built.normalized);
    expect(forms.nextToBuild("local")).toBeUndefined();
  });

  it(`is failed after ${MAX_FORMS_ATTEMPTS} failures, and no longer next`, () => {
    const id = putSpec("{}", AT);
    for (let i = 1; i < MAX_FORMS_ATTEMPTS; i++) {
      forms.markBuilding(id, AT);
      forms.saveFailure(id, new Error(`boom ${i}`), AT);
      expect(forms.getForms(id)).toEqual({ status: "pending" });
      expect(forms.nextToBuild("local")).toBe(id);
    }
    forms.markBuilding(id, AT);
    forms.saveFailure(id, new Error("boom 3"), AT);

    expect(forms.getForms(id)).toEqual({ status: "failed", error: "boom 3" });
    expect(forms.nextToBuild("local")).toBeUndefined();
  });

  it.each([
    ["too-large", "too large: 99 bytes is over MAX_FORMS_BYTES (1)"],
    ["not-openapi", "The Published Form is not an OpenAPI or Swagger document"],
  ] as const)("fails a %s build at once", (kind, message) => {
    const id = putSpec("{}", AT);
    forms.markBuilding(id, AT);
    forms.saveFailure(id, new SpecFormsError(kind, message), AT);

    expect(forms.getForms(id)).toEqual({ status: "failed", error: message });
    expect(forms.nextToBuild("local")).toBeUndefined();
  });

  it("picks a building row again: the process stopped mid-build", () => {
    const id = putSpec("{}", AT);
    forms.markBuilding(id, AT);

    expect(forms.nextToBuild("local")).toBe(id);
    expect(forms.getForms(id)).toEqual({ status: "pending" });
  });

  it("picks from each lane only its own Specs, in the same order", () => {
    const handed = putSpec('{"n":1}', "2026-09-20T00:00:00.000Z");
    const local = putSpec('{"n":2}', "2026-09-21T00:00:00.000Z");
    const unknown = putSpec('{"n":3}', "2026-09-22T00:00:00.000Z");
    forms.markBuilding(handed, AT);
    forms.handOver(handed);
    forms.markBuilding(local, AT);
    forms.saveFailure(local, new Error("boom"), AT);
    db.update(specForms)
      .set({ externalRefs: false })
      .where(eq(specForms.specId, local))
      .run();

    expect(forms.nextToBuild("external")).toBe(handed);
    // Not yet tried (`null`) first, then the retry known to be local.
    expect(forms.nextToBuild("local")).toBe(unknown);
    forms.markBuilding(unknown, AT);
    forms.saveBuilt(unknown, built, AT, false);
    expect(forms.nextToBuild("local")).toBe(local);
    forms.markBuilding(local, AT);
    forms.saveBuilt(local, built, AT, false);
    expect(forms.nextToBuild("local")).toBeUndefined();

    // Retried and newer in the external lane: the untried one goes first.
    const retried = putSpec('{"n":4}', "2026-09-19T00:00:00.000Z");
    forms.markBuilding(retried, AT);
    forms.handOver(retried);
    forms.saveFailure(retried, new Error("boom"), AT);
    const newer = putSpec('{"n":5}', "2026-09-23T00:00:00.000Z");
    forms.markBuilding(newer, AT);
    forms.handOver(newer);
    expect(forms.nextToBuild("external")).toBe(handed);
    forms.saveBuilt(handed, built, AT, true);
    expect(forms.nextToBuild("external")).toBe(newer);
    forms.saveBuilt(newer, built, AT, true);
    expect(forms.nextToBuild("external")).toBe(retried);
    expect(forms.nextToBuild("local")).toBeUndefined();
  });

  it("hands a Spec over pending, with no attempt counted and no build started", () => {
    const id = putSpec("{}", AT);
    forms.markBuilding(id, AT);
    forms.handOver(id);

    expect(forms.getForms(id)).toEqual({ status: "pending" });
    expect(
      db
        .select({
          externalRefs: specForms.externalRefs,
          attempts: specForms.attempts,
          startedAt: specForms.startedAt,
        })
        .from(specForms)
        .where(eq(specForms.specId, id))
        .get(),
    ).toEqual({ externalRefs: true, attempts: 0, startedAt: null });
  });

  it("picks a stopped build again in the lane its row names", () => {
    const id = putSpec("{}", AT);
    forms.markBuilding(id, AT);
    forms.handOver(id);
    forms.markBuilding(id, AT);

    expect(forms.nextToBuild("external")).toBe(id);
    expect(forms.nextToBuild("local")).toBeUndefined();
  });

  describe("a stale Spec: ready, built by an older builder", () => {
    const readyForms = {
      status: "ready",
      normalizedSpecVersion: "3.1.1",
      validityIssues: built.validityIssues,
      validityFindingCount: 2,
      normalizedFindingCount: 0,
      outline: built.outline,
    };
    const rebuilt: SpecForms = {
      ...built,
      normalized: new TextEncoder().encode('{"openapi":"3.1.1","x":1}'),
      validityIssues: [],
      validityFindingCount: 0,
    };

    /** Builds `id`'s forms, then makes them stale: `builder_version` null. */
    function makeStale(id: string, builtAt: string, externalRefs?: boolean) {
      forms.markBuilding(id, builtAt);
      forms.saveBuilt(id, built, builtAt, externalRefs);
      db.update(specForms)
        .set({ builderVersion: null })
        .where(eq(specForms.specId, id))
        .run();
    }

    function row(id: string) {
      return db
        .select({
          status: specForms.status,
          builderVersion: specForms.builderVersion,
          attempts: specForms.attempts,
          lastError: specForms.lastError,
          startedAt: specForms.startedAt,
          builtAt: specForms.builtAt,
        })
        .from(specForms)
        .where(eq(specForms.specId, id))
        .get();
    }

    it("stores the current builder version with the forms", () => {
      const id = putSpec("{}", AT);
      forms.markBuilding(id, AT);
      forms.saveBuilt(id, built, AT);
      expect(row(id)?.builderVersion).toBe(FORMS_BUILDER_VERSION);
      expect(forms.nextToBuild("local")).toBeUndefined();
    });

    it("picks a never-built Spec before a stale one", () => {
      const stale = putSpec('{"n":1}', "2026-09-20T00:00:00.000Z");
      makeStale(stale, AT);
      const fresh = putSpec('{"n":2}', "2026-09-22T00:00:00.000Z");

      expect(forms.nextToBuild("local")).toBe(fresh);
      forms.markBuilding(fresh, AT);
      forms.saveBuilt(fresh, built, AT);
      expect(forms.nextToBuild("local")).toBe(stale);
    });

    it("picks the oldest built first, older versions too, and never a failed one", () => {
      const newer = putSpec('{"n":1}', "2026-09-20T00:00:00.000Z");
      const older = putSpec('{"n":2}', "2026-09-21T00:00:00.000Z");
      makeStale(newer, "2026-09-23T12:00:00.000Z");
      makeStale(older, "2026-09-23T11:00:00.000Z");
      db.update(specForms)
        .set({ builderVersion: FORMS_BUILDER_VERSION - 1 })
        .where(eq(specForms.specId, older))
        .run();
      const failed = putSpec('{"n":3}', "2026-09-19T00:00:00.000Z");
      forms.markBuilding(failed, AT);
      forms.saveFailure(failed, new SpecFormsError("not-openapi", "no"), AT);

      expect(forms.nextToBuild("local")).toBe(older);
      forms.markBuilding(older, AT);
      forms.saveBuilt(older, rebuilt, AT);
      expect(forms.nextToBuild("local")).toBe(newer);
      forms.markBuilding(newer, AT);
      forms.saveBuilt(newer, rebuilt, AT);
      expect(forms.nextToBuild("local")).toBeUndefined();
    });

    it("rebuilds in the lane its row names", () => {
      const external = putSpec('{"n":1}', "2026-09-20T00:00:00.000Z");
      makeStale(external, AT, true);

      expect(forms.nextToBuild("local")).toBeUndefined();
      expect(forms.nextToBuild("external")).toBe(external);
    });

    it("stays ready with the old forms while it is rebuilt, then has the new ones", () => {
      const id = putSpec("{}", AT);
      makeStale(id, AT);

      expect(forms.nextToBuild("local")).toBe(id);
      forms.markBuilding(id, "2026-09-24T00:00:00.000Z");
      expect(forms.getForms(id)).toEqual(readyForms);
      expect(forms.getOutline(id)).toEqual({
        status: "ready",
        outline: built.outline,
      });
      expect(forms.getValidity(id).status).toBe("ready");
      expect(forms.getNormalizedBytes(id)).toEqual(built.normalized);
      expect(row(id)).toMatchObject({
        status: "ready",
        startedAt: "2026-09-24T00:00:00.000Z",
        builtAt: AT,
      });
      // A process stopped mid-rebuild picks it again.
      expect(forms.nextToBuild("local")).toBe(id);

      forms.saveBuilt(id, rebuilt, "2026-09-24T00:01:00.000Z");
      expect(forms.getNormalizedBytes(id)).toEqual(rebuilt.normalized);
      expect(row(id)).toMatchObject({
        status: "ready",
        builderVersion: FORMS_BUILDER_VERSION,
        builtAt: "2026-09-24T00:01:00.000Z",
      });
      expect(forms.nextToBuild("local")).toBeUndefined();
    });

    it("keeps the old forms when a rebuild fails, and stops after the last attempt", () => {
      const id = putSpec("{}", AT);
      makeStale(id, AT);

      forms.markBuilding(id, AT);
      forms.saveFailure(id, new Error("boom 1"), AT);
      expect(forms.getForms(id)).toEqual(readyForms);
      expect(forms.getNormalizedBytes(id)).toEqual(built.normalized);
      expect(row(id)).toMatchObject({
        status: "ready",
        builderVersion: null,
        attempts: 1,
        lastError: "boom 1",
        startedAt: null,
        builtAt: AT,
      });
      expect(forms.nextToBuild("local")).toBe(id);

      for (let i = 2; i <= MAX_FORMS_ATTEMPTS; i++) {
        forms.markBuilding(id, AT);
        forms.saveFailure(id, new Error(`boom ${i}`), AT);
      }
      expect(forms.getForms(id)).toEqual(readyForms);
      expect(row(id)).toMatchObject({
        status: "ready",
        builderVersion: FORMS_BUILDER_VERSION,
        attempts: MAX_FORMS_ATTEMPTS,
        lastError: `boom ${MAX_FORMS_ATTEMPTS}`,
      });
      expect(forms.nextToBuild("local")).toBeUndefined();
    });

    it("keeps the old forms and stops at once when a rebuild fails for good", () => {
      const id = putSpec("{}", AT);
      makeStale(id, AT);

      forms.markBuilding(id, AT);
      forms.saveFailure(id, new SpecFormsError("too-large", "too large"), AT);
      expect(forms.getForms(id)).toEqual(readyForms);
      expect(row(id)).toMatchObject({
        builderVersion: FORMS_BUILDER_VERSION,
        attempts: 1,
        lastError: "too large",
      });
      expect(forms.nextToBuild("local")).toBeUndefined();
    });

    it("counts only the rebuild's failures: saveBuilt clears earlier ones", () => {
      const id = putSpec("{}", AT);
      forms.markBuilding(id, AT);
      forms.saveFailure(id, new Error("boom"), AT);
      forms.markBuilding(id, AT);
      forms.saveBuilt(id, built, AT);
      expect(row(id)?.attempts).toBe(0);
    });
  });

  it("reads the bytes, the format and the best-Provenance Source to build from", () => {
    const id = putSpec('{"openapi":"3.1.0"}', AT);
    repo.addSource(id, "https://mirror.example/payco.json", "Mirror", AT);
    repo.addSource(id, "https://payco.com/old.json", "Official", AT);
    repo.addSource(
      id,
      "https://payco.com/openapi.json",
      "Official",
      "2026-09-23T11:00:00.000Z",
    );

    expect(forms.buildInput(id)).toEqual({
      bytes: new TextEncoder().encode('{"openapi":"3.1.0"}'),
      format: "json",
      sourceUrl: "https://payco.com/openapi.json",
    });
    expect(forms.buildInput("0".repeat(64))).toBeUndefined();
  });
});

describe("migration 0007", () => {
  it("applies on an existing Index, whose Specs are then pending", () => {
    // The migrations up to 0006 only, as an Index from before this one.
    const before = join(dir, "drizzle");
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 6,
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(dir, "old.db");
    const sqlite = new Database(path);
    migrate(drizzle({ client: sqlite }), { migrationsFolder: before });
    sqlite
      .prepare("INSERT INTO vendors (id, name, domain) VALUES (?, ?, ?)")
      .run(vendor.id, vendor.name, vendor.domain);
    sqlite
      .prepare("INSERT INTO apis (id, vendor_id, name) VALUES (?, ?, ?)")
      .run(api.id, vendor.id, api.name);
    sqlite
      .prepare(
        "INSERT INTO specs (id, api_id, spec_version, format, byte_length, published_bytes) VALUES (?, ?, '3.0.0', 'json', 1, x'00')",
      )
      .run("f".repeat(64), api.id);
    sqlite.close();

    const old = openDb(path);
    try {
      const oldForms = createSpecForms(old);
      expect(oldForms.nextToBuild("local")).toBe("f".repeat(64));
      expect(oldForms.getForms("f".repeat(64))).toEqual({ status: "pending" });
    } finally {
      old.$client.close();
    }
  });
});

describe("migration 0009", () => {
  it("applies on an existing Index, whose ready forms stay ready and are rebuilt", () => {
    // The migrations up to 0008 only, as an Index from before this one.
    const before = join(dir, "drizzle");
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 8,
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(dir, "old.db");
    const sqlite = new Database(path);
    migrate(drizzle({ client: sqlite }), { migrationsFolder: before });
    sqlite
      .prepare("INSERT INTO vendors (id, name, domain) VALUES (?, ?, ?)")
      .run(vendor.id, vendor.name, vendor.domain);
    sqlite
      .prepare("INSERT INTO apis (id, vendor_id, name) VALUES (?, ?, ?)")
      .run(api.id, vendor.id, api.name);
    sqlite
      .prepare(
        "INSERT INTO specs (id, api_id, spec_version, format, byte_length, published_bytes) VALUES (?, ?, '3.0.0', 'json', 1, x'00')",
      )
      .run("f".repeat(64), api.id);
    sqlite
      .prepare(
        "INSERT INTO spec_forms (spec_id, status, outline, built_at, external_refs) VALUES (?, 'ready', ?, ?, 0)",
      )
      .run("f".repeat(64), JSON.stringify(built.outline), AT);
    sqlite.close();

    const old = openDb(path);
    try {
      const oldForms = createSpecForms(old);
      expect(oldForms.getOutline("f".repeat(64))).toEqual({
        status: "ready",
        outline: built.outline,
      });
      expect(oldForms.nextToBuild("local")).toBe("f".repeat(64));
    } finally {
      old.$client.close();
    }
  });
});
