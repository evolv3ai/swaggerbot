import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SpecView } from "~/server/spec-view";
import { SpecHeader, SpecLabel } from "./spec-label";

const specId = "a".repeat(64);
const view: SpecView = {
  api: {
    id: "stripe.com/stripe-api",
    vendorId: "stripe.com",
    name: "Stripe API",
  },
  lookupName: "stripe",
  vendor: { id: "stripe.com", name: "Stripe", domain: "stripe.com" },
  spec: {
    id: specId,
    specVersion: "3.0.3",
    apiVersion: "v1",
    isPreview: false,
    superseded: false,
    current: true,
  },
  provenance: "Official",
  verifiedAt: "2026-09-24T10:00:00.000Z",
  sources: [
    {
      id: 1,
      url: "https://stripe.com/openapi.json",
      provenance: "Official",
      lastVerifiedAt: "2026-09-24T10:00:00.000Z",
    },
    {
      id: 2,
      url: "https://mirror.example/stripe.json",
      provenance: "Mirror",
      lastVerifiedAt: "2026-09-20T10:00:00.000Z",
    },
  ],
  stale: false,
  form: "published",
  forms: {
    published: {
      bytes: 1200,
      format: "json",
      url: `/api/specs/${specId}/published`,
    },
    normalized: {
      status: "ready",
      bytes: 1500,
      url: `/api/specs/${specId}/normalized`,
    },
  },
  validityIssues: [],
  validityFindingCount: 0,
  frame: "show",
  outlineUrl: `/api/apis/stripe.com/stripe-api/outline?specId=${specId}`,
  alternates: [],
};

const header = renderToStaticMarkup(createElement(SpecHeader, { view }));
const label = renderToStaticMarkup(createElement(SpecLabel, { view }));

describe("SpecHeader", () => {
  it("links the Vendor to its page", () => {
    expect(header).toMatch(
      /Spec viewer ·.*<a href="\/vendors\/stripe.com"[^>]*>Stripe<\/a>/,
    );
  });

  it("links to the Lookup, by a name the Index answers", () => {
    expect(header).toContain('<a href="/lookup?name=stripe">Look it up</a>');
  });
});

describe("SpecLabel", () => {
  it("lists each Source with its Provenance and when it was last verified", () => {
    expect(label).toContain('id="sources"');
    expect(label).toMatch(
      /Official<\/span>.*?https:\/\/stripe\.com\/openapi\.json.*?Last verified.*?24 Sept? 2026/,
    );
    expect(label).toMatch(
      /Mirror<\/span>.*?https:\/\/mirror\.example\/stripe\.json.*?Last verified.*?20 Sept? 2026/,
    );
  });

  it("sits the Sources on the print, not the bay", () => {
    expect(label).toContain("bg-print p-3");
    expect(label).not.toContain("bg-bay");
  });

  it("links both downloads", () => {
    expect(label).toContain(`href="/api/specs/${specId}/published"`);
    expect(label).toContain(`href="/api/specs/${specId}/normalized"`);
  });

  it("leaves the Sources out for a Spec with none", () => {
    const bare = renderToStaticMarkup(
      createElement(SpecLabel, { view: { ...view, sources: [] } }),
    );
    expect(bare).not.toContain('id="sources"');
  });
});
