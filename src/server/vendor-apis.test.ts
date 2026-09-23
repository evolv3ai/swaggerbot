import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { FakeJudge } from "~/judge/fake";
import { createLookup } from "~/lookup/lookup";
import { vendorApisResponse } from "./vendor-apis";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-vendor-apis-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

/** A dependency the listing must never touch: any use of it throws. */
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
const app = () => ({ db, lookup });

const VERIFIED_AT = "2026-09-20T10:00:00.000Z";
const repo = createRepo(db);

/**
 * Stores an Official Spec of the API, found at `VERIFIED_AT`; `confirmed`
 * when a Verification confirmed it describes the API.
 */
function spec(apiId: string, title: string, confirmed: boolean): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title, version: "1.0.0" },
      paths: {},
    }),
  );
  const { id } = repo.putSpec(apiId, bytes, {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format: "json",
  });
  if (confirmed) repo.confirmSpec(id, VERIFIED_AT);
  repo.addSource(
    id,
    `https://payco.com/${title}.json`,
    "Official",
    VERIFIED_AT,
  );
  return id;
}

const payco = { id: "payco.com", name: "PayCo", domain: "payco.com" };
repo.upsertVendor(payco);
// Stored out of order, so the listing must sort them.
repo.upsertApi({
  id: "payco.com/payments",
  vendorId: "payco.com",
  name: "Payments",
});
repo.upsertApi({
  id: "payco.com/billing",
  vendorId: "payco.com",
  name: "Billing",
});
repo.upsertApi({
  id: "payco.com/sandbox",
  vendorId: "payco.com",
  name: "Sandbox",
});
const paymentsSpec = spec("payco.com/payments", "payments", true);
const billingSpec = spec("payco.com/billing", "billing", true);
spec("payco.com/sandbox", "sandbox", false);

repo.upsertVendor({
  id: "otherco.com",
  name: "OtherCo",
  domain: "otherco.com",
});
repo.upsertApi({
  id: "otherco.com/other",
  vendorId: "otherco.com",
  name: "Other",
});
spec("otherco.com/other", "other", true);

// Two Vendors with one name.
repo.upsertVendor({ id: "acme.com", name: "Acme", domain: "acme.com" });
repo.upsertVendor({ id: "acme.io", name: "ACME", domain: "acme.io" });

async function list(vendor: string) {
  const response = vendorApisResponse(vendor, app);
  return { status: response.status, body: await response.json() };
}

describe("vendorApisResponse", () => {
  it.each([
    ["its id", "payco.com"],
    ["its domain", "www.PayCo.com"],
    ["a URL", "https://www.payco.com/docs/api"],
    ["its name", "PayCo"],
    ["its name in another case", "payco"],
    ["its name, padded", "  PAYCO "],
  ])("finds the Vendor by %s", async (_, vendor) => {
    const { status, body } = await list(vendor);

    expect(status).toBe(200);
    expect(body.vendor).toEqual(payco);
    expect(body.apis.map((a: { api: { id: string } }) => a.api.id)).toEqual([
      "payco.com/billing",
      "payco.com/payments",
      "payco.com/sandbox",
    ]);
  });

  it("lists each API with its Current Spec and download URLs, from the Index alone", async () => {
    const { body } = await list("payco.com");
    const [billing, payments] = body.apis;

    for (const [entry, specId] of [
      [billing, billingSpec],
      [payments, paymentsSpec],
    ] as const) {
      expect(entry).toMatchObject({
        currentSpec: {
          id: specId,
          normalized: "pending",
          downloads: {
            published: `https://swaggerbot.test/api/specs/${specId}/published`,
            normalized: `https://swaggerbot.test/api/specs/${specId}/normalized`,
          },
        },
        alternateSpecs: [],
        provenance: "Official",
        verifiedAt: VERIFIED_AT,
      });
      // As `currentFromIndex` gives them.
      const current = lookup.currentFromIndex(entry.api.id);
      expect(entry.currentSpec).toEqual(current?.currentSpec);
    }
    expect(judge.calls).toEqual([]);
  });

  it("lists an API with only an unconfirmed Spec without a Current Spec", async () => {
    const { body } = await list("payco.com");

    expect(body.apis[2]).toEqual({
      api: { id: "payco.com/sandbox", vendorId: "payco.com", name: "Sandbox" },
      currentSpec: null,
      alternateSpecs: [],
      provenance: null,
      verifiedAt: null,
    });
  });

  it("lists only that Vendor's APIs", async () => {
    const { body } = await list("otherco.com");

    expect(body.apis.map((a: { api: { id: string } }) => a.api.id)).toEqual([
      "otherco.com/other",
    ]);
  });

  it("answers 300 with the candidates when several Vendors have the name", async () => {
    const { status, body } = await list("acme");

    expect(status).toBe(300);
    expect(body).toEqual({
      vendors: [
        { id: "acme.com", name: "Acme" },
        { id: "acme.io", name: "ACME" },
      ],
    });
  });

  it("prefers the Vendor whose id or domain it is to one named alike", async () => {
    expect((await list("acme.io")).body.vendor.id).toBe("acme.io");
    expect((await list("https://acme.com/")).body.vendor.id).toBe("acme.com");
  });

  it.each(["unknown.com", "Unknown", "Pay", "   "])(
    "answers 404 with a Lookup hint for %j",
    async (vendor) => {
      const { status, body } = await list(vendor);

      expect(status).toBe(404);
      expect(body.error).toMatch(/No Vendor/);
      expect(body.hint).toMatch(/POST \/api\/lookup/);
    },
  );
});
