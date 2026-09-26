import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Outcome } from "~/domain/outcome";
import type { LookupPage } from "~/server/lookup-page";
import { HowAnswered } from "./how-answered";
import { absoluteUrl, LookupView, requestHref, titleOf } from "./views";

const specId = "a".repeat(64);
const altId = "b".repeat(64);
const base = "https://swaggerbot.dev";

const spec = (id: string, apiVersion: string) => ({
  id,
  apiId: "stripe.com/stripe-api",
  specVersion: "3.0.3",
  apiVersion,
  isPreview: false,
  supersededAt: null,
  format: "yaml" as const,
  byteLength: 6_600_000,
  downloads: {
    published: `/api/specs/${id}/published`,
    normalized: `/api/specs/${id}/normalized`,
  },
  normalized: "ready" as const,
});

const vendor = { id: "stripe.com", name: "stripe.com", domain: "stripe.com" };
const api = {
  id: "stripe.com/stripe-api",
  vendorId: "stripe.com",
  name: "Stripe API",
};
const source = {
  id: 1,
  specId,
  url: "https://raw.githubusercontent.com/stripe/openapi/master/spec3.yaml",
  provenance: "Official" as const,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastVerifiedAt: "2026-09-24T10:00:00.000Z",
};

const resolved: Outcome = {
  outcome: "Resolved",
  api,
  vendor,
  currentSpec: spec(specId, "v1"),
  alternateSpecs: [spec(altId, "v2")],
  provenance: "Official",
  sources: [source],
  validityIssues: [{ message: "Unused schema", path: "#/x", count: 3 }],
  validityIssueCount: 3,
  verifiedAt: "2026-09-24T10:00:00.000Z",
};

function outcomePage(outcome: Outcome, name = "stripe"): LookupPage {
  return {
    view: "outcome",
    request: { name },
    outcome,
    ms: 2.5,
    stale: false,
    baseUrl: base,
  };
}

const html = (page: LookupPage) =>
  renderToStaticMarkup(createElement(LookupView, { page }));

/** The text of the page, tags stripped. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .trim();

describe("the Resolved view", () => {
  const markup = html(outcomePage(resolved));

  it("heads the page with the Outcome, its badge and the name looked up", () => {
    expect(markup).toMatch(/<h1[^>]*>Resolved<\/h1>/);
    expect(text(markup)).toContain("1 of 5, from sure to not found");
    expect(text(markup)).toContain("Lookup · stripe");
  });

  it("leads with the three actions, with the right URLs", () => {
    expect(markup).toContain(`href="/specs/${specId}"`);
    expect(text(markup)).toContain("Open in the Spec viewer");
    expect(markup).toContain(`href="/api/specs/${specId}/published"`);
    expect(text(markup)).toContain("YAML · 6.6 MB");
    expect(text(markup)).toContain("Copy URL");
    expect(markup).toContain('aria-live="polite"');
    // The actions come before any section below the card.
    expect(markup.indexOf("Open in the Spec viewer")).toBeLessThan(
      markup.indexOf('id="spec-details"'),
    );
  });

  it("gives curl, MCP and the JSON with the answer's real values", () => {
    expect(text(markup)).toContain(
      `curl -o openapi.yaml ${base}/api/specs/${specId}/published`,
    );
    expect(text(markup)).toContain(`swaggerbot ${base}/mcp`);
    expect(text(markup)).toContain('lookup_api {"name":"stripe"}');
    expect(text(markup)).toContain('"outcome": "Resolved"');
  });

  it("repeats no fact of the card in the details list", () => {
    const details = markup.slice(
      markup.indexOf('id="spec-details"'),
      markup.indexOf('id="alternates"'),
    );
    for (const fact of ["Vendor", "Provenance", "Verified", "Stripe API"])
      expect(details).not.toContain(fact);
    expect(text(details)).toContain("API id stripe.com/stripe-api");
    expect(details).toContain(`href="/api/specs/${specId}/normalized"`);
    expect(text(details)).toContain("3 findings");
  });

  it("shows the Vendor once when its name is its domain, linked to its APIs", () => {
    expect(markup).toContain('href="/vendors/stripe.com"');
    expect(text(markup)).not.toContain("(stripe.com)");
  });

  it("lists the Alternate Specs and the Sources", () => {
    expect(markup).toContain(`href="/specs/${altId}"`);
    expect(text(markup)).toContain(source.url);
    expect(text(markup)).toContain("Last verified 24 Sept 2026");
  });

  it("folds the six steps away behind one line for an Index answer", () => {
    expect(text(markup)).toContain(
      "Answered from the Index in 2.5 ms; no later step was needed.",
    );
    expect(markup).toMatch(/<details[^>]*><summary[^>]*>.*The six steps/);
  });

  it("uses none of the Darkroom's pieces", () => {
    expect(markup).not.toMatch(/font-(pencil|segment|caps)|bg-strip|certainty/);
  });
});

describe("HowAnswered", () => {
  it("shows every step, open, when a later step answered", () => {
    const markup = renderToStaticMarkup(
      createElement(HowAnswered, {
        answered: { by: "step", step: "GitHub" },
      }),
    );
    expect(markup).not.toContain("<details");
    expect(text(markup)).toContain("answered at GitHub");
    expect(text(markup)).toMatch(/APIs\.guru.*Checked/);
    expect(text(markup)).toMatch(/GitHub.*Answered here.*Judged.*Not needed/);
  });

  it("says the steps past the Index need a key when it missed", () => {
    const markup = renderToStaticMarkup(
      createElement(HowAnswered, { answered: { by: "missed" } }),
    );
    expect(markup).not.toContain("<details");
    expect(text(markup)).toContain("Not here");
    expect(text(markup)).toContain("Needs a key");
  });
});

describe("the other views", () => {
  it("gives Unconfirmed its reasons and the Spec's actions", () => {
    const markup = html(
      outcomePage({
        outcome: "Unconfirmed",
        api,
        vendor,
        spec: spec(specId, "v1"),
        sources: [source],
        reasons: ["The Spec's title names another product."],
        validityIssues: [],
        validityIssueCount: 0,
        verifiedAt: "2026-09-10T00:00:00.000Z",
      }),
    );
    expect(markup).toMatch(/<h1[^>]*>Unconfirmed<\/h1>/);
    expect(text(markup)).toContain("The Spec's title names another product.");
    expect(markup).toContain(`href="/specs/${specId}"`);
    expect(text(markup)).toContain("No Provenance confirmed");
  });

  it("links each Ambiguous candidate to its own Lookup", () => {
    const markup = html(
      outcomePage(
        {
          outcome: "Ambiguous",
          candidates: [
            { name: "Jira Cloud", probability: 0.5 },
            { name: "Jira Server", vendor: "Atlassian", probability: 0.4 },
          ],
        },
        "jira",
      ),
    );
    expect(markup).toContain('href="/lookup?name=Jira+Cloud"');
    expect(text(markup)).toContain("Likelihood 40%");
  });

  it("offers No Spec's Community Lookup when one exists", () => {
    const markup = html(
      outcomePage({
        outcome: "NoSpec",
        api,
        vendor,
        communityAvailable: true,
      }),
    );
    expect(markup).toContain('href="/lookup?name=stripe&amp;allowCommunity=1"');
  });

  it("embeds Search on Unknown, prefilled", () => {
    const markup = html(
      outcomePage({ outcome: "Unknown", name: "frobnicator" }, "frobnicator"),
    );
    expect(markup).toContain('action="/lookup"');
    expect(markup).toContain('value="frobnicator"');
  });

  it("gives the Discovery calls and the way to a key when the Index misses", () => {
    const markup = html({
      view: "not-in-index",
      request: { name: "Val Town" },
      baseUrl: base,
    });
    expect(markup).toMatch(/<h1[^>]*>Not in the Index yet<\/h1>/);
    expect(markup).toContain(`curl -X POST ${base}/api/lookup`);
    expect(markup).toContain(`${base}/mcp --header`);
    expect(markup).toContain('href="/docs#keys"');
    expect(markup).toContain('action="/lookup"');
  });

  it("says when to retry, and links the same Lookup again", () => {
    const markup = html({
      view: "rate-limited",
      request: { name: "stripe" },
      retryAfterSeconds: 12,
    });
    expect(text(markup)).toContain("12 seconds");
    expect(markup).toContain('href="/lookup?name=stripe"');
  });

  it("asks for a name, with Search and no “another”", () => {
    const markup = html({ view: "name-required" });
    expect(markup).toMatch(/<h1[^>]*>Name an API<\/h1>/);
    expect(markup).toContain('action="/lookup"');
    expect(text(markup)).not.toContain("another");
  });
});

describe("helpers", () => {
  it("titles each view", () => {
    expect(titleOf(outcomePage(resolved))).toBe("Resolved: stripe");
    expect(titleOf({ view: "name-required" })).toBe("Name an API");
  });

  it("makes a download path absolute under the base URL", () => {
    expect(absoluteUrl("/api/specs/x/published", base)).toBe(
      `${base}/api/specs/x/published`,
    );
    expect(absoluteUrl(`${base}/y`, "http://other")).toBe(`${base}/y`);
  });

  it("links a Lookup with its options", () => {
    expect(requestHref({ name: "Stripe API" })).toBe("/lookup?name=Stripe+API");
    expect(requestHref({ name: "x", apiVersion: "v2" })).toBe(
      "/lookup?name=x&apiVersion=v2",
    );
  });
});
