import { describe, expect, it } from "vitest";
import type { Outcome } from "~/domain/outcome";
import type { BenchmarkEntry } from "./entry";
import { runBenchmark } from "./run";
import { type BenchmarkAnswer, normalizeUrl, score } from "./score";

const at = "2026-09-22T10:00:00.000Z";
const specId = "0".repeat(64);

function resolvedTo(name: string, apiId: string, urls: string[]): Outcome {
  const vendorId = apiId.split("/")[0] as string;
  return {
    outcome: "Resolved",
    api: { id: apiId, vendorId, name },
    vendor: { id: vendorId, name: vendorId, domain: vendorId },
    currentSpec: {
      id: specId,
      apiId,
      specVersion: "3.0.0",
      apiVersion: null,
      isPreview: false,
      supersededAt: null,
      format: "json",
      byteLength: 1,
    },
    alternateSpecs: [],
    provenance: "Official",
    sources: urls.map((url, i) => ({
      id: i + 1,
      specId,
      url,
      provenance: "Official",
      firstSeenAt: at,
      lastVerifiedAt: at,
    })),
    validityIssues: [],
    verifiedAt: at,
  };
}

const unknown = (name: string): Outcome => ({ outcome: "Unknown", name });

function entry(over: Partial<BenchmarkEntry> & { name: string }) {
  return {
    group: "popular",
    expected: "Resolved",
    apiId: "stripe.com/stripe-api",
    specSources: ["https://stripe.com/openapi.json"],
    evidenceUrl: "https://stripe.com/docs",
    reviewed: true,
    ...over,
  } satisfies BenchmarkEntry;
}

const answer = (name: string, outcome: Outcome): BenchmarkAnswer => ({
  name,
  outcome,
});

describe("score", () => {
  it("counts a Resolved answer with another API slug but the same Vendor and a listed Source as correct", () => {
    const e = entry({ name: "Stripe" });
    const report = score(
      [e],
      [
        answer(
          "Stripe",
          resolvedTo("Stripe", "stripe.com/stripe", [
            "https://stripe.com/openapi.json",
          ]),
        ),
      ],
    );
    expect(report.falseResolutions).toBe(0);
    expect(report.outcomeAccuracy).toBe(1);
    expect(report.failures).toEqual([]);
  });

  it("counts a Resolved answer with the wrong Vendor as a False Resolution even when its Source is listed", () => {
    const e = entry({ name: "Stripe" });
    const report = score(
      [e],
      [
        answer(
          "Stripe",
          resolvedTo("Stripe", "stripe.net/other", [
            "https://stripe.com/openapi.json",
          ]),
        ),
      ],
    );
    expect(report.falseResolutions).toBe(1);
    expect(report.falseResolutionRate).toBe(1);
    expect(report.groups.popular.falseResolutions).toBe(1);
    expect(report.failures).toEqual([
      {
        name: "Stripe",
        expected: "Resolved",
        got: "Resolved",
        why: "wrong Vendor: got stripe.net, expected stripe.com",
      },
    ]);
  });

  it("counts a Resolved answer with the right Vendor but a Source outside specSources as a False Resolution", () => {
    const e = entry({ name: "Stripe" });
    const report = score(
      [e],
      [
        answer(
          "Stripe",
          resolvedTo("Stripe", "stripe.com/stripe-api", [
            "https://mirror.example.com/stripe.json",
          ]),
        ),
      ],
    );
    expect(report.falseResolutionRate).toBe(1);
    expect(report.failures[0]?.why).toContain("wrong Spec Source");
  });

  it("counts Resolved on an entry not expected Resolved as a False Resolution", () => {
    const e = entry({
      name: "Atlassian",
      group: "ambiguous",
      expected: "Ambiguous",
      apiId: undefined,
      specSources: undefined,
    });
    const report = score(
      [e],
      [
        answer(
          "Atlassian",
          resolvedTo("Jira", "atlassian.com/jira", [
            "https://atlassian.com/jira.json",
          ]),
        ),
      ],
    );
    expect(report.falseResolutions).toBe(1);
    expect(report.outcomeAccuracy).toBe(0);
  });

  it("counts an Alternate Source listed in specSources as correct", () => {
    const e = entry({
      name: "Stripe",
      group: "longtail",
      specSources: [
        "https://stripe.com/openapi.json",
        "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
      ],
    });
    const report = score(
      [e],
      [
        answer(
          "Stripe",
          resolvedTo("Stripe", "stripe.com/stripe-api", [
            "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
          ]),
        ),
      ],
    );
    expect(report.falseResolutions).toBe(0);
    expect(report.falseResolutionRate).toBe(0);
    expect(report.longtailCoverage).toBe(1);
    expect(report.outcomeAccuracy).toBe(1);
    expect(report.failures).toEqual([]);
  });

  it("gives a rate of 0 when there are no Resolved answers", () => {
    const report = score(
      [entry({ name: "Stripe" }), entry({ name: "Twilio", group: "longtail" })],
      [
        answer("Stripe", unknown("Stripe")),
        answer("Twilio", unknown("Twilio")),
      ],
    );
    expect(report.resolved).toBe(0);
    expect(report.falseResolutionRate).toBe(0);
    expect(report.longtailCoverage).toBe(0);
    expect(report.outcomeAccuracy).toBe(0);
    expect(report.failures.map((f) => f.why)).toEqual([
      "expected Resolved, got Unknown",
      "expected Resolved, got Unknown",
    ]);
  });

  it("computes long-tail coverage over long-tail entries expected Resolved", () => {
    const entries = [
      entry({ name: "A", group: "longtail" }),
      entry({ name: "B", group: "longtail" }),
      entry({
        name: "C",
        group: "longtail",
        expected: "NoSpec",
        specSources: undefined,
      }),
    ];
    const report = score(entries, [
      answer(
        "A",
        resolvedTo("A", "stripe.com/stripe-api", [
          "https://stripe.com/openapi.json",
        ]),
      ),
      answer("B", unknown("B")),
      answer("C", unknown("C")),
    ]);
    expect(report.longtailCoverage).toBe(0.5);
    expect(report.outcomeAccuracy).toBeCloseTo(1 / 3);
    expect(report.groups.longtail).toEqual({
      entries: 3,
      correctOutcome: 1,
      resolved: 1,
      falseResolutions: 0,
    });
  });

  it("matches Spec Sources after URL normalization", () => {
    const e = entry({
      name: "Stripe",
      specSources: ["https://Stripe.COM/openapi.json/"],
    });
    const report = score(
      [e],
      [
        answer(
          "Stripe",
          resolvedTo("Stripe", "stripe.com/stripe-api", [
            "http://stripe.com/openapi.json#top",
          ]),
        ),
      ],
    );
    expect(report.falseResolutions).toBe(0);
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["https://API.Example.COM/spec.json", "https://api.example.com/spec.json"],
    ["https://example.com/spec/", "https://example.com/spec"],
    ["https://example.com/", "https://example.com"],
    ["https://example.com/spec.json#/paths", "https://example.com/spec.json"],
    ["http://example.com/spec.json", "https://example.com/spec.json"],
    ["http://example.com:80/a", "https://example.com/a"],
    ["https://example.com/a?v=2", "https://example.com/a?v=2"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeUrl(raw)).toBe(expected);
  });

  it("keeps path case and query distinct", () => {
    expect(normalizeUrl("https://example.com/Spec")).not.toBe(
      normalizeUrl("https://example.com/spec"),
    );
    expect(normalizeUrl("https://example.com/a?v=1")).not.toBe(
      normalizeUrl("https://example.com/a?v=2"),
    );
  });
});

describe("runBenchmark", () => {
  const entries = [
    entry({ name: "Reviewed", reviewed: true }),
    entry({ name: "Unreviewed", reviewed: false }),
  ];

  it("scores only reviewed entries when onlyReviewed is set", async () => {
    const asked: string[] = [];
    const report = await runBenchmark({
      entries,
      onlyReviewed: true,
      lookup: async (name) => {
        asked.push(name);
        return unknown(name);
      },
    });
    expect(asked).toEqual(["Reviewed"]);
    expect(report.entries).toBe(1);
  });

  it("scores every entry by default", async () => {
    const report = await runBenchmark({
      entries,
      lookup: async (name) => unknown(name),
    });
    expect(report.entries).toBe(2);
  });

  it("counts a thrown Lookup as Unknown and lists it as an error", async () => {
    const report = await runBenchmark({
      entries: [
        entry({
          name: "Boom",
          expected: "Unknown",
          apiId: undefined,
          specSources: undefined,
        }),
      ],
      lookup: async () => {
        throw new Error("judge down");
      },
    });
    expect(report.errors).toEqual([{ name: "Boom", message: "judge down" }]);
    expect(report.outcomeAccuracy).toBe(1);
  });

  it("never runs more Lookups at once than concurrency", async () => {
    let running = 0;
    let peak = 0;
    const many = Array.from({ length: 10 }, (_, i) => entry({ name: `n${i}` }));
    await runBenchmark({
      entries: many,
      concurrency: 3,
      lookup: async (name) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return unknown(name);
      },
    });
    expect(peak).toBe(3);
  });
});
