import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "~/fetch/__fixtures__/server";
import { createFetcher, type Fetcher, USER_AGENT } from "~/fetch/fetcher";
import { type Db, openDb } from "~/index-store/db";
import { createRepo, type Repo } from "~/index-store/repo";
import { specForms, specs } from "~/index-store/schema";
import { createSpecForms, MAX_FORMS_ATTEMPTS } from "~/index-store/spec-forms";
import { createFormsWorker } from "./worker";

const FIXTURES = join(import.meta.dirname, "__fixtures__");
const vendor = { id: "vendor.test", name: "Vendor", domain: "vendor.test" };
const api = { id: "vendor.test/vendor-api", vendorId: vendor.id, name: "V" };

let dir: string;
let db: Db;
let repo: Repo;
let server: FixtureServer;
let fetcher: Fetcher;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-forms-worker-"));
  db = openDb(join(dir, "index.db"));
  repo = createRepo(db);
  repo.upsertVendor(vendor);
  repo.upsertApi(api);
  server = await startFixtureServer();
  fetcher = createFetcher({
    allowPrivate: true,
    lookup: fixtureLookup,
    minIntervalMs: 0,
    env: {},
  });
});

afterEach(async () => {
  await server.close();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Stores a fixture (or raw bytes) as a Spec created at `createdAt`; its id. */
function putSpec(
  bytes: Uint8Array,
  format: "json" | "yaml",
  createdAt: string,
  sourceUrl?: string,
): string {
  const spec = repo.putSpec(api.id, bytes, {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format,
  });
  db.update(specs).set({ createdAt }).where(eq(specs.id, spec.id)).run();
  if (sourceUrl) repo.addSource(spec.id, sourceUrl, "Official");
  return spec.id;
}

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(FIXTURES, name)));

const status = (specId: string) =>
  db
    .select({ status: specForms.status })
    .from(specForms)
    .where(eq(specForms.specId, specId))
    .get()?.status;

describe("createFormsWorker", () => {
  it("builds the older Spec first, then the other, then has nothing to build", async () => {
    const newer = putSpec(
      fixture("openapi30.yaml"),
      "yaml",
      "2026-09-22T00:00:00.000Z",
    );
    const older = putSpec(
      fixture("swagger2.json"),
      "json",
      "2026-09-21T00:00:00.000Z",
    );
    const worker = createFormsWorker({ db, fetcher, env: {} });
    const forms = createSpecForms(db);

    expect(await worker.runOnce()).toBe(true);
    expect(forms.getForms(older).status).toBe("ready");
    expect(forms.getForms(newer).status).toBe("pending");

    expect(await worker.runOnce()).toBe(true);
    expect(forms.getForms(newer)).toMatchObject({
      status: "ready",
      normalizedSpecVersion: expect.stringMatching(/^3\.1\./),
    });
    expect(await worker.runOnce()).toBe(false);
  });

  it("fails a Spec whose bytes don't parse, and goes on to the next", async () => {
    const bad = putSpec(
      new TextEncoder().encode("{not json"),
      "json",
      "2026-09-21T00:00:00.000Z",
    );
    const good = putSpec(
      fixture("swagger2.json"),
      "json",
      "2026-09-22T00:00:00.000Z",
    );
    const worker = createFormsWorker({ db, fetcher, env: {} });

    let runs = 0;
    while (await worker.runOnce()) runs++;

    expect(runs).toBe(MAX_FORMS_ATTEMPTS + 1);
    expect(status(bad)).toBe("failed");
    expect(status(good)).toBe("ready");
  });

  it("fetches a same-origin external reference through the fetcher", async () => {
    const userAgents: (string | undefined)[] = [];
    server.route("vendor.test", "/specs/schemas/widget.json", (req, res) => {
      userAgents.push(req.headers["user-agent"]);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(readFileSync(join(FIXTURES, "widget.json")));
    });
    const id = putSpec(
      fixture("openapi31-same-origin.json"),
      "json",
      "2026-09-21T00:00:00.000Z",
      `${server.origin("vendor.test")}/specs/openapi.json`,
    );
    const fetchUrl = vi.spyOn(fetcher, "fetchUrl");
    const worker = createFormsWorker({ db, fetcher, env: {} });

    expect(await worker.runOnce()).toBe(true);

    expect(fetchUrl).toHaveBeenCalledWith(
      `${server.origin("vendor.test")}/specs/schemas/widget.json`,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        background: true,
      }),
    );
    expect(userAgents).toEqual([USER_AGENT]);
    const forms = createSpecForms(db).getForms(id);
    expect(forms).toMatchObject({ status: "ready", validityIssues: [] });
    const normalized = JSON.parse(
      new TextDecoder().decode(createSpecForms(db).getNormalizedBytes(id)),
    );
    expect(JSON.stringify(normalized)).toContain('"id"');
  });

  it("counts a build whose references outran the budget as a failed attempt", async () => {
    // WTR-116: DigitalOcean's 697 references didn't fit, and the build was
    // saved ready with our unresolved references as its Validity Issues.
    for (const name of ["a", "b", "c"]) {
      server.route(
        "vendor.test",
        `/specs/schemas/${name}.json`,
        (_req, res) => {
          setTimeout(() => {
            if (!res.destroyed)
              res
                .writeHead(200, { "content-type": "application/json" })
                .end('{"type":"object"}');
          }, 300).unref();
        },
      );
    }
    const spec = {
      openapi: "3.1.0",
      info: { title: "Split", version: "1.0.0" },
      paths: Object.fromEntries(
        ["a", "b", "c"].map((name) => [
          `/${name}`,
          {
            get: {
              responses: {
                "200": {
                  description: name,
                  content: {
                    "application/json": {
                      schema: { $ref: `schemas/${name}.json` },
                    },
                  },
                },
              },
            },
          },
        ]),
      ),
    };
    const id = putSpec(
      new TextEncoder().encode(JSON.stringify(spec)),
      "json",
      "2026-09-21T00:00:00.000Z",
      `${server.origin("vendor.test")}/specs/openapi.json`,
    );
    const worker = createFormsWorker({
      db,
      fetcher,
      env: {},
      refBudgetMs: 100,
    });
    const forms = createSpecForms(db);
    const row = () =>
      db
        .select({
          attempts: specForms.attempts,
          lastError: specForms.lastError,
        })
        .from(specForms)
        .where(eq(specForms.specId, id))
        .get();

    expect(await worker.runOnce()).toBe(true);
    expect(forms.getForms(id).status).toBe("pending");
    expect(row()).toMatchObject({
      attempts: 1,
      lastError: expect.stringContaining("external references not all fetched"),
    });
    expect(forms.nextToBuild()).toBe(id);

    while (await worker.runOnce());
    expect(status(id)).toBe("failed");
    expect(row()?.attempts).toBe(MAX_FORMS_ATTEMPTS);
  });

  it("saves a Spec whose same-origin reference answers 404, with the reference as a Validity Issue", async () => {
    const id = putSpec(
      fixture("openapi31-same-origin.json"),
      "json",
      "2026-09-21T00:00:00.000Z",
      `${server.origin("vendor.test")}/specs/openapi.json`,
    );
    const worker = createFormsWorker({ db, fetcher, env: {} });

    expect(await worker.runOnce()).toBe(true);

    const forms = createSpecForms(db).getForms(id);
    expect(forms.status).toBe("ready");
    expect(forms.validityIssues).toContainEqual(
      expect.objectContaining({
        message: `Unresolved external reference: ${server.origin("vendor.test")}/specs/schemas/widget.json`,
      }),
    );
  });

  it("start() builds in the background until stopped", async () => {
    const id = putSpec(
      fixture("swagger2.json"),
      "json",
      "2026-09-21T00:00:00.000Z",
    );
    const worker = createFormsWorker({ db, fetcher, env: {} });
    worker.start();
    try {
      await vi.waitFor(() => expect(status(id)).toBe("ready"));
    } finally {
      worker.stop();
    }
  });
});
