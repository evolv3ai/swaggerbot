import { describe, expect, it } from "vitest";
import { Outcome } from "./outcome";

const vendor = { id: "stripe.com", name: "Stripe", domain: "stripe.com" };
const api = {
  id: "stripe.com/stripe-api",
  vendorId: "stripe.com",
  name: "Stripe API",
};
const spec = {
  id: "0".repeat(64),
  apiId: api.id,
  specVersion: "3.0.0",
  apiVersion: "2024-06-20",
  isPreview: false,
  supersededAt: null,
  format: "json",
  byteLength: 1024,
  downloads: {
    published: `https://swaggerbot.dev/api/specs/${"0".repeat(64)}/published`,
    normalized: `https://swaggerbot.dev/api/specs/${"0".repeat(64)}/normalized`,
  },
  normalized: "ready",
};
const validityIssues = [
  {
    message: "Property allowReserved is not expected to be here",
    path: "/paths/~1zones/get/parameters/0",
    count: 3,
  },
];
const verifiedAt = "2026-09-22T10:00:00.000Z";
const source = {
  id: 1,
  specId: spec.id,
  url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  provenance: "Official",
  firstSeenAt: verifiedAt,
  lastVerifiedAt: verifiedAt,
};

const variants = {
  Resolved: {
    outcome: "Resolved",
    api,
    vendor,
    currentSpec: spec,
    alternateSpecs: [],
    provenance: "Official",
    sources: [source],
    validityIssues,
    validityIssueCount: 3,
    verifiedAt,
  },
  Ambiguous: {
    outcome: "Ambiguous",
    candidates: [
      {
        apiId: "atlassian.com/jira-cloud-platform",
        name: "Jira Cloud Platform",
        vendor: "Atlassian",
        probability: 0.6,
      },
      { name: "Jira Software", probability: 0.3 },
    ],
  },
  Unconfirmed: {
    outcome: "Unconfirmed",
    api,
    vendor,
    spec,
    sources: [source],
    reasons: ["looks like a test fixture"],
    validityIssues: [],
    validityIssueCount: 0,
    verifiedAt,
  },
  NoSpec: { outcome: "NoSpec", api, vendor, communityAvailable: false },
  Unknown: { outcome: "Unknown", name: "definitely not an api" },
};

describe("Outcome", () => {
  it.each(Object.entries(variants))("parses %s", (kind, value) => {
    const parsed = Outcome.parse(value);
    expect(parsed.outcome).toBe(kind);
    expect(parsed).toEqual(value);
  });

  it("accepts diagnostics on any Outcome", () => {
    const value = {
      ...variants.Unknown,
      diagnostics: ["Judge: whichApi failed (timeout)"],
    };
    expect(Outcome.parse(value)).toEqual(value);
    expect(
      Outcome.safeParse({ ...variants.NoSpec, diagnostics: [""] }).success,
    ).toBe(false);
  });

  it.each([
    ["an unknown outcome", { outcome: "NotFound", name: "x" }],
    ["Resolved without Sources", { ...variants.Resolved, sources: [] }],
    [
      "Resolved with a bad verifiedAt",
      { ...variants.Resolved, verifiedAt: "yesterday" },
    ],
    ["Unconfirmed without reasons", { ...variants.Unconfirmed, reasons: [] }],
    [
      "Resolved with a Spec without downloads",
      {
        ...variants.Resolved,
        currentSpec: { ...spec, downloads: undefined },
      },
    ],
    [
      "Resolved with an unknown Normalized Form status",
      {
        ...variants.Resolved,
        currentSpec: { ...spec, normalized: "building" },
      },
    ],
    [
      "Resolved with more than 50 Validity Issues",
      {
        ...variants.Resolved,
        validityIssues: Array.from({ length: 51 }, (_, i) => ({
          message: `finding ${i}`,
          path: "/",
          count: 1,
        })),
      },
    ],
    [
      "Unconfirmed without validityIssueCount",
      { ...variants.Unconfirmed, validityIssueCount: undefined },
    ],
    ["NoSpec without communityAvailable", { outcome: "NoSpec", api, vendor }],
    [
      "Ambiguous with a probability above 1",
      {
        outcome: "Ambiguous",
        candidates: [
          { name: "a", probability: 2 },
          { name: "b", probability: 0.1 },
        ],
      },
    ],
  ])("rejects %s", (_, value) => {
    expect(Outcome.safeParse(value).success).toBe(false);
  });
});
