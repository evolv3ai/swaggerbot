import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SpecView } from "~/server/spec-view";
import { Sources } from "./sources";
import { SpecHeader, SpecSummary } from "./spec-label";

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
const summary = renderToStaticMarkup(createElement(SpecSummary, { view }));
const sources = renderToStaticMarkup(
  createElement(Sources, { sources: view.sources }),
);

describe("SpecHeader", () => {
  it("links the Vendor to its page in the meta line, with no kicker", () => {
    expect(header).not.toContain("Spec viewer");
    expect(header).toMatch(
      /<\/h1><p[^>]*>.*By <a href="\/vendors\/stripe.com"[^>]*>Stripe<\/a>.*Look it up/,
    );
  });

  it("links to the Lookup, by a name the Index answers", () => {
    expect(header).toMatch(/<a href="\/lookup\?name=stripe"[^>]*>Look it up/);
  });
});

describe("Sources", () => {
  it("lists each Source with its Provenance and when it was last verified", () => {
    expect(sources).toContain('id="sources"');
    // A URL may wrap after a slash, never inside a word.
    expect(sources).toContain(
      "<span>https://</span><span><wbr/>stripe.com/</span>",
    );
    const plain = sources.replace(/<[^>]*>/g, "");
    expect(plain).toMatch(
      /Official.*?https:\/\/stripe\.com\/openapi\.json.*?Last verified.*?24 Sept? 2026/,
    );
    expect(plain).toMatch(
      /Mirror.*?https:\/\/mirror\.example\/stripe\.json.*?Last verified.*?20 Sept? 2026/,
    );
  });
});

describe("SpecSummary", () => {
  it("shows the Provenance, verifiedAt and the Spec id", () => {
    expect(summary).toMatch(/Provenance: <\/span>Official/);
    expect(summary).toMatch(
      /<time dateTime="2026-09-24T10:00:00.000Z">24 Sept? 2026/,
    );
    expect(summary).toContain(specId);
  });

  it("is on the design system, not the Darkroom", () => {
    for (const html of [header, summary, sources])
      expect(html).not.toMatch(
        /\b(bg-print|bg-bay|print-ink|font-caps|font-segment|text-ink-2)\b/,
      );
  });

  it("links both downloads, with their sizes", () => {
    expect(summary).toMatch(
      new RegExp(
        `href="/api/specs/${specId}/published"[^>]*>.*?1 kB</span></a>`,
      ),
    );
    expect(summary).toContain(`href="/api/specs/${specId}/normalized"`);
  });

  it("says a Normalized Form being built can't be downloaded yet", () => {
    const pending = renderToStaticMarkup(
      createElement(SpecSummary, {
        view: {
          ...view,
          forms: {
            ...view.forms,
            normalized: { status: "pending", url: view.forms.normalized.url },
          },
        },
      }),
    );
    expect(pending).not.toContain(`href="/api/specs/${specId}/normalized"`);
    expect(pending).toContain("being built");
  });
});
