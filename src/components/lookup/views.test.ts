import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Outcome } from "~/domain/outcome";
import type { LookupPage } from "~/server/lookup-page";
import { LookupView } from "./views";

// The router's Link needs a router; a plain anchor is enough to read its href.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href: to, className }, children),
}));

const SPEC_ID = "a".repeat(64);
const ALT_ID = "b".repeat(64);

const resolved: Extract<Outcome, { outcome: "Resolved" }> = {
  outcome: "Resolved",
  api: {
    id: "stripe.com/stripe-api",
    vendorId: "stripe.com",
    name: "Stripe API",
  },
  vendor: { id: "stripe.com", name: "Stripe", domain: "stripe.com" },
  currentSpec: {
    id: SPEC_ID,
    apiId: "stripe.com/stripe-api",
    specVersion: "3.0.0",
    apiVersion: "2024-06-20",
    isPreview: false,
    supersededAt: null,
    format: "yaml",
    byteLength: 6_400_000,
    downloads: {
      published: `/api/specs/${SPEC_ID}/published`,
      normalized: `/api/specs/${SPEC_ID}/normalized`,
    },
    normalized: "ready",
  },
  alternateSpecs: [],
  provenance: "Official",
  sources: [
    {
      id: 1,
      specId: SPEC_ID,
      url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml",
      provenance: "Official",
      firstSeenAt: "2026-09-01T10:00:00.000Z",
      lastVerifiedAt: "2026-09-22T10:00:00.000Z",
    },
  ],
  validityIssues: [],
  validityIssueCount: 3,
  verifiedAt: "2026-09-22T10:00:00.000Z",
};

const outcomePage = (outcome: Outcome, stale = false): LookupPage => ({
  view: "outcome",
  request: { name: "stripe" },
  outcome,
  ms: 3.04,
  stale,
  baseUrl: "https://swaggerbot.dev",
});

const render = (page: LookupPage) =>
  renderToStaticMarkup(createElement(LookupView, { page }));

/** The print (the first `<article>`), and "The Current Spec" section. */
function parts(html: string) {
  const print = html.slice(
    html.indexOf("<article"),
    html.indexOf("</article>"),
  );
  const start = html.indexOf('aria-labelledby="current-spec"');
  const list = html.slice(start, html.indexOf("</section>", start));
  return { print, list };
}

describe("the Resolved view", () => {
  it("puts the three actions on the print, with the right URLs", () => {
    const { print } = parts(render(outcomePage(resolved)));
    expect(print).toMatch(
      new RegExp(`href="/specs/${SPEC_ID}"[^>]*>Open in the Spec viewer<`),
    );
    expect(print).toMatch(
      new RegExp(
        `href="/api/specs/${SPEC_ID}/published"[^>]*>Download<span class="sr-only"> the Published Form`,
      ),
    );
    expect(print).toContain("Published Form, YAML,");
    expect(print).toContain(">6.4</span>");
    // Copy URL: the Published Form's absolute URL, announced when copied.
    expect(print).toContain(
      `>https://swaggerbot.dev/api/specs/${SPEC_ID}/published</code>`,
    );
    expect(print).toMatch(/<button type="button"[^>]*>Copy URL<\/button>/);
    expect(print).toContain('aria-live="polite"');
  });

  it("keeps an absolute download URL as it is", () => {
    const page = outcomePage({
      ...resolved,
      currentSpec: {
        ...resolved.currentSpec,
        downloads: {
          published: `https://cdn.example/api/specs/${SPEC_ID}/published`,
          normalized: `https://cdn.example/api/specs/${SPEC_ID}/normalized`,
        },
      },
    });
    expect(parts(render(page)).print).toContain(
      `>https://cdn.example/api/specs/${SPEC_ID}/published</code>`,
    );
  });

  it("repeats no print fact in The Current Spec, and keeps the rest", () => {
    const { list } = parts(render(outcomePage(resolved)));
    const text = list.replace(/<[^>]+>/g, " ");
    for (const repeated of [
      "Vendor",
      "Provenance",
      "Verified",
      "Official",
      "Stripe API",
      SPEC_ID.slice(0, 12),
      "Open in the Spec viewer",
      "Copy URL",
    ])
      expect(text).not.toContain(repeated);
    expect(list).not.toContain("/published");
    expect(list).toContain(">stripe.com/stripe-api<");
    expect(list).toContain(">2024-06-20<");
    expect(list).toContain("OpenAPI 3.0.0, YAML");
    expect(list).toMatch(/>Validity Issues<.*?>3</);
    expect(list).toMatch(
      new RegExp(
        `href="/api/specs/${SPEC_ID}/normalized"[^>]*>Download<span class="sr-only"> the Normalized Form`,
      ),
    );
  });

  it("gives the actions on a Stale print too", () => {
    const { print } = parts(render(outcomePage(resolved, true)));
    expect(print).toContain("Open in the Spec viewer");
    expect(print).toContain("Copy URL");
  });

  it("still lists an Alternate Spec's own view and download", () => {
    const html = render(
      outcomePage({
        ...resolved,
        alternateSpecs: [
          {
            ...resolved.currentSpec,
            id: ALT_ID,
            apiVersion: "2023-10-16",
            downloads: {
              published: `/api/specs/${ALT_ID}/published`,
              normalized: `/api/specs/${ALT_ID}/normalized`,
            },
          },
        ],
      }),
    );
    expect(html).toContain(`href="/specs/${ALT_ID}"`);
  });
});

describe("How it was answered", () => {
  it("is one line for an Index answer, the stations behind a disclosure", () => {
    const html = render(outcomePage(resolved));
    expect(html).toContain(
      "Answered from the Index in 3.0 ms, no later station needed.",
    );
    expect(html).toMatch(
      /<details[^>]*><summary[^>]*>The six stations<\/summary><ol/,
    );
    expect(html.match(/Not needed/g)).toHaveLength(5);
  });

  it("shows every station, open, when the Index didn't answer", () => {
    const html = render({
      view: "not-in-index",
      request: { name: "val town" },
      baseUrl: "https://swaggerbot.dev",
    });
    const chain = html.slice(html.indexOf('aria-labelledby="chain"'));
    expect(chain).not.toContain("<details");
    expect(chain).not.toContain("no later station needed");
    expect(chain.match(/Needs a key/g)).toHaveLength(5);
  });
});
