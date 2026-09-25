import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Outcome } from "~/domain/outcome";
import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { FakeJudge } from "~/judge/fake";
import type { LookupApp } from "~/lookup/http";
import { createLookup, type IndexedLookup } from "~/lookup/lookup";
import { createRateLimiter } from "~/lookup/rate-limit";
import { answerLookupPage, type LookupPageDeps } from "./lookup-page";
import { LookupSearch, lookupRequestOf, lookupSearchOf } from "./lookup-search";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-lookup-page-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

// A small Index: Stripe, with one Official Spec verified on 24 Sept.
const repo = createRepo(db);
repo.upsertVendor({ id: "stripe.com", name: "Stripe", domain: "stripe.com" });
repo.upsertApi({
  id: "stripe.com/stripe-api",
  vendorId: "stripe.com",
  name: "Stripe API",
});
const spec = repo.putSpec(
  "stripe.com/stripe-api",
  new TextEncoder().encode('{"openapi":"3.0.3","info":{"version":"v1"}}'),
  { specVersion: "3.0.3", format: "json", apiVersion: "v1" },
);
repo.confirmSpec(spec.id, "2026-09-24T10:00:00.000Z");
repo.addSource(
  spec.id,
  "https://stripe.com/openapi.json",
  "Official",
  "2026-09-24T10:00:00.000Z",
);
repo.rememberName("stripe", "stripe.com/stripe-api");

const now = new Date("2026-09-25T12:00:00.000Z");

/** The real Lookup over the Index, whose Discovery must never run. */
function realApp() {
  const lookup = createLookup({
    db,
    judge: new FakeJudge(),
    apisGuru: {
      findCandidates: async () => {
        throw new Error("Discovery ran");
      },
      findVendorApis: async () => {
        throw new Error("Discovery ran");
      },
    },
    webSearch: null,
    fetcher: createFetcher(),
    now: () => now,
  });
  const discovery = vi.fn(lookup);
  const keys = { findKey: vi.fn(), takeQuota: vi.fn() };
  const app: LookupApp = {
    lookup: Object.assign(discovery, {
      fromIndex: vi.fn(lookup.fromIndex),
      currentFromIndex: lookup.currentFromIndex,
    }),
    keys,
  };
  return { app, discovery, keys };
}

/** A fake Index that answers every name with `outcome`. */
function fakeApp(outcome: Outcome | null) {
  const discovery = vi.fn(async (): Promise<Outcome> => {
    throw new Error("Discovery ran");
  });
  const fromIndex = vi.fn((): Outcome | null => outcome);
  const keys = { findKey: vi.fn(), takeQuota: vi.fn() };
  const app: LookupApp = {
    lookup: Object.assign(discovery, {
      fromIndex,
      currentFromIndex: vi.fn(),
    }) as IndexedLookup,
    keys,
  };
  return { app, discovery, fromIndex, keys };
}

function deps(
  app: LookupApp,
  more: Partial<LookupPageDeps> & { headers?: Record<string, string> } = {},
): LookupPageDeps {
  const { headers, ...rest } = more;
  return {
    getApp: () => app,
    gate: {
      rateLimiter: createRateLimiter({ perMinute: 60 }),
      clientIpHeader: "x-forwarded-for",
      dailyQuota: 100,
      now: () => now,
    },
    request: new Request("http://localhost:3000/lookup?name=stripe", {
      headers: { "x-forwarded-for": "203.0.113.7", ...headers },
    }),
    freshnessDays: 7,
    ...rest,
  };
}

const vendor = { id: "acme.dev", name: "Acme", domain: "acme.dev" };
const api = { id: "acme.dev/acme-api", vendorId: "acme.dev", name: "Acme API" };
const specAnswer = {
  id: "a".repeat(64),
  apiId: api.id,
  specVersion: "3.1.0",
  apiVersion: "1",
  isPreview: false,
  supersededAt: null,
  format: "json" as const,
  byteLength: 1234,
  downloads: {
    published: `/api/specs/${"a".repeat(64)}/published`,
    normalized: `/api/specs/${"a".repeat(64)}/normalized`,
  },
  normalized: "ready" as const,
};
const source = {
  id: 1,
  specId: "a".repeat(64),
  url: "https://acme.dev/openapi.json",
  provenance: "Mirror" as const,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastVerifiedAt: "2026-09-10T00:00:00.000Z",
};
const OUTCOMES: Outcome[] = [
  {
    outcome: "Ambiguous",
    candidates: [
      {
        apiId: "atlassian.com/jira-cloud",
        name: "Jira Cloud",
        probability: 0.5,
      },
      { name: "Jira Server", vendor: "Atlassian", probability: 0.4 },
    ],
  },
  {
    outcome: "Unconfirmed",
    api,
    vendor,
    spec: specAnswer,
    sources: [source],
    reasons: ["The Spec's title names another product."],
    validityIssues: [],
    validityIssueCount: 0,
    verifiedAt: "2026-09-10T00:00:00.000Z",
  },
  { outcome: "NoSpec", api, vendor, communityAvailable: true },
  { outcome: "Unknown", name: "acme" },
];

describe("answerLookupPage", () => {
  it("shows Stripe from the Index as Resolved, with how long it took", async () => {
    const { app, discovery, keys } = realApp();
    const page = await answerLookupPage({ name: "Stripe" }, deps(app));

    expect(page).toMatchObject({
      view: "outcome",
      request: { name: "Stripe" },
      stale: false,
      outcome: {
        outcome: "Resolved",
        api: { name: "Stripe API" },
        vendor: { name: "Stripe" },
        provenance: "Official",
        verifiedAt: "2026-09-24T10:00:00.000Z",
        currentSpec: {
          id: spec.id,
          downloads: {
            published: `/api/specs/${spec.id}/published`,
            normalized: `/api/specs/${spec.id}/normalized`,
          },
        },
      },
    });
    expect(page.view === "outcome" && page.ms).toBeGreaterThanOrEqual(0);
    expect(discovery).not.toHaveBeenCalled();
    expect(keys.findKey).not.toHaveBeenCalled();
    expect(keys.takeQuota).not.toHaveBeenCalled();
  });

  it("marks an answer verified before the freshness window as Stale", async () => {
    const { app } = realApp();
    const page = await answerLookupPage(
      { name: "stripe" },
      deps(app, { freshnessDays: 0.5 }),
    );
    expect(page).toMatchObject({ view: "outcome", stale: true });
  });

  it("says a name the Index doesn't know isn't in it, without running Discovery", async () => {
    const { app, discovery, keys } = realApp();
    const page = await answerLookupPage({ name: "Val Town" }, deps(app));

    expect(page).toEqual({
      view: "not-in-index",
      request: { name: "Val Town" },
      baseUrl: "http://localhost:3000",
    });
    expect(discovery).not.toHaveBeenCalled();
    expect(keys.takeQuota).not.toHaveBeenCalled();
  });

  it("gives the Discovery calls under PUBLIC_BASE_URL when it is set", async () => {
    const { app } = fakeApp(null);
    const page = await answerLookupPage(
      { name: "nope" },
      deps(app, { publicBaseUrl: "https://swaggerbot.dev/" }),
    );
    expect(page).toMatchObject({ baseUrl: "https://swaggerbot.dev" });
  });

  it.each(OUTCOMES.map((o) => [o.outcome, o] as const))(
    "shows %s as the Index answers it",
    async (_, outcome) => {
      const { app, discovery } = fakeApp(outcome);
      const page = await answerLookupPage({ name: "acme" }, deps(app));
      expect(page).toMatchObject({ view: "outcome", outcome });
      expect(discovery).not.toHaveBeenCalled();
    },
  );

  it("never sends a key, even when the request carries one", async () => {
    const { app, discovery, fromIndex, keys } = fakeApp(null);
    const page = await answerLookupPage(
      { name: "nope" },
      deps(app, { headers: { authorization: "Bearer sb_live_secret" } }),
    );

    expect(page.view).toBe("not-in-index");
    expect(fromIndex).toHaveBeenCalledWith({ name: "nope" });
    expect(keys.findKey).not.toHaveBeenCalled();
    expect(keys.takeQuota).not.toHaveBeenCalled();
    expect(discovery).not.toHaveBeenCalled();
  });

  it.each([
    ["no name", {}],
    ["a blank name", { name: "   " }],
  ])("requires a name: %s runs nothing", async (_, search) => {
    const { app, fromIndex } = fakeApp(null);
    const take = vi.fn(() => ({ allowed: true as const }));
    const page = await answerLookupPage(
      search,
      deps(app, {
        gate: {
          rateLimiter: { take, size: () => 0 },
          clientIpHeader: "x-forwarded-for",
          dailyQuota: 100,
        },
      }),
    );

    expect(page).toEqual({ view: "name-required" });
    expect(fromIndex).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it("says when to retry once the client IP is over the per-IP limit", async () => {
    const { app, fromIndex } = fakeApp(null);
    const d = deps(app, {
      gate: {
        rateLimiter: createRateLimiter({ perMinute: 1 }),
        clientIpHeader: "x-forwarded-for",
        dailyQuota: 100,
      },
    });
    await answerLookupPage({ name: "stripe" }, d);
    const page = await answerLookupPage({ name: "stripe" }, d);

    expect(page).toEqual({
      view: "rate-limited",
      request: { name: "stripe" },
      retryAfterSeconds: 60,
    });
    expect(fromIndex).toHaveBeenCalledTimes(1);
  });

  it("passes a blank apiVersion as none, and allowCommunity=1 as on", async () => {
    const { app, fromIndex } = fakeApp(null);
    await answerLookupPage(
      { name: "stripe", apiVersion: " ", allowCommunity: "1" },
      deps(app),
    );
    await answerLookupPage(
      { name: "stripe", apiVersion: "2024-06-20" },
      deps(app),
    );

    expect(fromIndex).toHaveBeenNthCalledWith(1, {
      name: "stripe",
      allowCommunity: true,
    });
    expect(fromIndex).toHaveBeenNthCalledWith(2, {
      name: "stripe",
      apiVersion: "2024-06-20",
    });
  });
});

describe("LookupSearch", () => {
  it("reads the router's parsed values back as the text that was sent", () => {
    // `?name=3&apiVersion=2&allowCommunity=1`, as the router parses it.
    const search = LookupSearch.parse({
      name: 3,
      apiVersion: 2,
      allowCommunity: 1,
    });
    expect(lookupRequestOf(search)).toEqual({
      name: "3",
      apiVersion: "2",
      allowCommunity: true,
    });
  });

  it("keeps the values as parsed, so the router writes the same URL back", () => {
    expect(
      LookupSearch.parse({ name: "stripe", apiVersion: "", allowCommunity: 1 }),
    ).toEqual({ name: "stripe", apiVersion: "", allowCommunity: 1 });
    expect(
      lookupSearchOf({ name: "Jira Cloud", allowCommunity: true }),
    ).toEqual({ name: "Jira Cloud", allowCommunity: 1 });
  });

  it("drops what isn't text, and never asks for a fresh Lookup", () => {
    const search = LookupSearch.parse({
      name: "stripe",
      apiVersion: { x: 1 },
      fresh: true,
    });
    expect(lookupRequestOf(search)).toEqual({ name: "stripe" });
  });
});
