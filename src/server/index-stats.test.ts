import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import type { CurrentFromIndex } from "~/lookup/lookup";
import { indexStats } from "./index-stats";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-index-stats-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const repo = createRepo(db);
const specIds: Record<string, string> = {};
/** An API with one confirmed Spec, verified at `verifiedAt`. */
function api(vendor: string, name: string, verifiedAt: string, n = 0): string {
  repo.upsertVendor({ id: vendor, name: vendor, domain: vendor });
  const id = `${vendor}/${name.toLowerCase().replaceAll(" ", "-")}`;
  repo.upsertApi({ id, vendorId: vendor, name });
  const spec = repo.putSpec(
    id,
    new TextEncoder().encode(`{"openapi":"3.0.3","n":"${id}${n}"}`),
    { specVersion: "3.0.3", format: "json", apiVersion: "1" },
  );
  repo.confirmSpec(spec.id, verifiedAt);
  repo.addSource(
    spec.id,
    `https://${vendor}/openapi.json`,
    "Official",
    verifiedAt,
  );
  specIds[id] = spec.id;
  return id;
}
const stripe = api("stripe.com", "Stripe API", "2026-09-24T10:00:00.000Z");
const github = api("github.com", "GitHub REST", "2026-09-10T10:00:00.000Z");
const valtown = api("val.town", "Val Town", "2026-09-23T10:00:00.000Z");
api("gone.io", "Gone", "2026-09-25T00:00:00.000Z");
repo.supersedeSpec(
  specIds["gone.io/gone"] as string,
  "2026-09-25T01:00:00.000Z",
);
repo.upsertVendor({ id: "empty.com", name: "empty.com", domain: "empty.com" });

const current = (id: string): CurrentFromIndex =>
  ({
    api: { id, name: `name of ${id}` },
    vendor: { name: id.split("/")[0] },
    currentSpec: { id: specIds[id] },
    alternateSpecs: [],
    provenance: "Official",
    sources: [],
    verifiedAt: repo.getApiWithSpecs(id) ? verified[id] : undefined,
  }) as unknown as CurrentFromIndex;
const verified: Record<string, string> = {
  [stripe]: "2026-09-24T10:00:00.000Z",
  [github]: "2026-09-10T10:00:00.000Z",
  [valtown]: "2026-09-23T10:00:00.000Z",
};
const lookup = {
  currentFromIndex: vi.fn((id: string) =>
    id in verified ? current(id) : null,
  ),
};
const now = new Date("2026-09-25T12:00:00.000Z");

describe("indexStats", () => {
  it("counts Vendors with APIs, APIs, and confirmed Specs that aren't Superseded", () => {
    const stats = indexStats(db, lookup, { now, freshnessDays: 7 });
    expect(stats).toMatchObject({ vendors: 4, apis: 4, specs: 3 });
  });

  it("lists the most recently verified APIs first, as the Index answers them", () => {
    const { recent } = indexStats(db, lookup, { now, freshnessDays: 7 });
    expect(recent.map((p) => p.apiId)).toEqual([stripe, valtown, github]);
    expect(recent[0]).toMatchObject({
      apiName: `name of ${stripe}`,
      vendorName: "stripe.com",
      specId: specIds[stripe],
      provenance: "Official",
      verifiedAt: "2026-09-24T10:00:00.000Z",
      stale: false,
    });
    expect(recent[0]?.ms).toBeGreaterThanOrEqual(0);
  });

  it("carries the Current Spec's version, form, size and downloads when the answer has them", () => {
    const withSpec = {
      currentFromIndex: (id: string) => {
        const answer = current(id);
        return {
          ...answer,
          vendor: { id: "stripe.com", name: "Stripe", domain: "stripe.com" },
          currentSpec: {
            ...answer.currentSpec,
            specVersion: "3.0.0",
            format: "yaml",
            byteLength: 6_600_000,
            downloads: {
              published: `https://swaggerbot.dev/api/specs/${specIds[id]}/published`,
              normalized: `https://swaggerbot.dev/api/specs/${specIds[id]}/normalized`,
            },
          },
        } as unknown as CurrentFromIndex;
      },
    };
    const { recent } = indexStats(db, withSpec, { now, freshnessDays: 7 });
    expect(recent[0]).toMatchObject({
      vendorDomain: "stripe.com",
      spec: {
        specVersion: "3.0.0",
        format: "yaml",
        byteLength: 6_600_000,
        downloads: {
          published: `https://swaggerbot.dev/api/specs/${specIds[stripe]}/published`,
        },
      },
    });
  });

  it("gives no Spec details when the answer carries none", () => {
    const { recent } = indexStats(db, lookup, { now, freshnessDays: 7 });
    expect(recent[0]?.spec).toBeNull();
  });

  it("marks an answer older than the freshness window Stale", () => {
    const { recent } = indexStats(db, lookup, { now, freshnessDays: 7 });
    expect(recent.find((p) => p.apiId === github)?.stale).toBe(true);
    expect(recent.find((p) => p.apiId === valtown)?.stale).toBe(false);
  });

  it("honours the limit and skips APIs the Index can't answer", () => {
    const { recent } = indexStats(db, lookup, {
      now,
      freshnessDays: 7,
      limit: 2,
    });
    expect(recent.map((p) => p.apiId)).toEqual([stripe, valtown]);
  });
});
