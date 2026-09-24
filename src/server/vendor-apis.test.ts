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

// Stored as production stores them: name equal to id, found by the names
// Callers typed (`api_names`).
for (const [vendorId, apiName, remembered] of [
  ["stripe.com", "Stripe API", ["stripe"]],
  ["github.com", "GitHub REST", ["github rest", "github"]],
  ["slack.com", "Slack Web", ["slack web"]],
  ["hooli.io", "Hooli", ["hooli"]],
] as const) {
  repo.upsertVendor({ id: vendorId, name: vendorId, domain: vendorId });
  const apiId = `${vendorId}/api`;
  repo.upsertApi({ id: apiId, vendorId, name: apiName });
  for (const name of remembered) repo.rememberName(name, apiId);
}
// Remembered names whose first word is not a Vendor's label or name.
for (const [vendorId, vendorName, apiName, remembered] of [
  ["atlassian.com", "Atlassian", "Jira", "jira cloud platform rest"],
  ["globex.com", "Globex", "Widget Cloud", "widget cloud"],
  ["initech.com", "Initech", "Widget Server", "widget server v2"],
  ["umbrella.com", "Umbrella", "Twin Sync", "twin sync"],
] as const) {
  repo.upsertVendor({ id: vendorId, name: vendorName, domain: vendorId });
  const apiId = `${vendorId}/api`;
  repo.upsertApi({ id: apiId, vendorId, name: apiName });
  repo.rememberName(remembered, apiId);
}
// Two Vendors with one label, and one sharing a remembered name's label.
repo.upsertVendor({ id: "twin.com", name: "twin.com", domain: "twin.com" });
repo.upsertVendor({ id: "twin.io", name: "twin.io", domain: "twin.io" });
repo.upsertVendor({ id: "hooli.com", name: "hooli.com", domain: "hooli.com" });

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

  it.each([
    ["Stripe", "stripe.com"],
    ["stripe api", "stripe.com"],
    ["GitHub REST", "github.com"],
    ["  GitHub  Rest API ", "github.com"],
  ])(
    "finds the Vendor of the API the Index remembers %j for",
    async (vendor, id) => {
      const { status, body } = await list(vendor);

      expect(status).toBe(200);
      expect(body.vendor.id).toBe(id);
      expect(body.apis.map((a: { api: { id: string } }) => a.api.id)).toEqual([
        `${id}/api`,
      ]);
    },
  );

  it("prefers the API's Vendor to Vendors with the label", async () => {
    const { status, body } = await list("Hooli");

    expect(status).toBe(200);
    expect(body.vendor.id).toBe("hooli.io");
  });

  it.each([
    ["Slack", "slack.com"],
    ["SLACK api", "slack.com"],
  ])(
    "finds the Vendor by the first label of its id for %j",
    async (vendor, id) => {
      const { status, body } = await list(vendor);

      expect(status).toBe(200);
      expect(body.vendor.id).toBe(id);
    },
  );

  it("answers 300 with the candidates when several Vendors have the label", async () => {
    const { status, body } = await list("Twin");

    expect(status).toBe(300);
    expect(body).toEqual({
      vendors: [
        { id: "twin.com", name: "twin.com" },
        { id: "twin.io", name: "twin.io" },
      ],
    });
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

  it.each([
    ["Jira", "atlassian.com"],
    ["  JIRA API ", "atlassian.com"],
    ["Jira Cloud", "atlassian.com"],
  ])(
    "finds the Vendor by the first words of a remembered API name for %j",
    async (vendor, id) => {
      const { status, body } = await list(vendor);

      expect(status).toBe(200);
      expect(body.vendor.id).toBe(id);
      expect(body.apis.map((a: { api: { id: string } }) => a.api.id)).toEqual([
        `${id}/api`,
      ]);
    },
  );

  it("answers 300 with the candidates when remembered API names of several Vendors start with it", async () => {
    const { status, body } = await list("Widget");

    expect(status).toBe(300);
    expect(body).toEqual({
      vendors: [
        { id: "globex.com", name: "Globex" },
        { id: "initech.com", name: "Initech" },
      ],
    });
  });

  it("prefers Vendors with the label to a remembered API name starting with it", async () => {
    // "twin sync" is remembered for umbrella.com's API.
    const { status, body } = await list("Twin");

    expect(status).toBe(300);
    expect(body.vendors.map((v: { id: string }) => v.id)).toEqual([
      "twin.com",
      "twin.io",
    ]);
  });

  it("prefers the Vendor whose id or domain it is to one named alike", async () => {
    expect((await list("acme.io")).body.vendor.id).toBe("acme.io");
    expect((await list("https://acme.com/")).body.vendor.id).toBe("acme.com");
  });

  it.each([
    "unknown.com",
    "Unknown",
    "Pay",
    "Slack Mobile",
    "Jir",
    "Jira Cl",
    "   ",
  ])("answers 404 with a Lookup hint for %j", async (vendor) => {
    const { status, body } = await list(vendor);

    expect(status).toBe(404);
    expect(body.error).toMatch(/No Vendor/);
    expect(body.hint).toMatch(/POST \/api\/lookup/);
  });
});
