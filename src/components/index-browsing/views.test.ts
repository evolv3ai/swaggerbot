import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VendorPage, VendorsPage } from "~/server/index-browsing";
import { VendorApisView } from "./vendor-apis";
import { VendorListView } from "./vendor-list";

const list = (page: VendorsPage) =>
  renderToStaticMarkup(createElement(VendorListView, { page }));
const vendor = (page: VendorPage) =>
  renderToStaticMarkup(createElement(VendorApisView, { page }));

describe("VendorListView", () => {
  const page: VendorsPage = {
    status: 200,
    query: "a",
    vendors: [
      { id: "alpha.com", name: "Alpha", apiCount: 2 },
      { id: "bravo.com", name: "Bravo", apiCount: 1 },
    ],
    total: 5,
    from: 3,
    to: 4,
    previous: "/vendors?query=a&cursor=1",
    next: "/vendors?query=a&cursor=5",
  };

  it("links each Vendor with its API count", () => {
    const html = list(page);
    expect(html).toContain('href="/vendors/alpha.com"');
    expect(html).toMatch(/>2<\/span>.*?>APIs</);
    expect(html).toMatch(/>1<\/span>.*?>API</);
    expect(html).toContain("3–4 of 5 Vendors matching “a”");
  });

  it("has a GET filter form holding the filter", () => {
    const html = list(page);
    expect(html).toContain('action="/vendors" method="get"');
    expect(html).toMatch(/name="query"[^>]*value="a"/);
    expect(html).toMatch(/href="\/vendors"[^>]*>Show every Vendor/);
  });

  it("links the previous and next pages, and neither when there's one page", () => {
    const html = list(page);
    expect(html).toMatch(
      /href="\/vendors\?query=a&amp;cursor=1" rel="prev"[^>]*>Previous page/,
    );
    expect(html).toMatch(
      /href="\/vendors\?query=a&amp;cursor=5" rel="next"[^>]*>Next page/,
    );
    const single = list({ ...page, previous: null, next: null });
    expect(single).not.toContain("Previous page");
    expect(single).not.toContain("Next page");
  });

  it("says when nothing matches, and links to Search", () => {
    const html = list({ ...page, vendors: [], total: 0, from: 0, to: 0 });
    expect(html).toContain("No Vendor in the Index has “a” in its name");
    expect(html).toContain('href="/"');
  });

  it("shows a Vendor's id only when it differs from its name", () => {
    const html = list({
      ...page,
      vendors: [
        { id: "stripe.com", name: "stripe.com", apiCount: 1 },
        { id: "alpha.com", name: "Alpha", apiCount: 2 },
      ],
    });
    expect(html.match(/>stripe\.com</g)).toHaveLength(1);
    expect(html).toContain('href="/vendors/stripe.com"');
    expect(html).toContain(">Alpha<");
    expect(html).toContain(">alpha.com<");
  });

  it("links a refused page back to the first", () => {
    const html = list({
      status: 400,
      query: "",
      error: "That page link isn't one this list made.",
      first: "/vendors",
    });
    expect(html).toContain("No such page");
    expect(html).toMatch(/href="\/vendors"[^>]*>Go to the first page/);
  });
});

describe("VendorApisView", () => {
  it("shows each API's Current Spec with its Provenance, verifiedAt and viewer link, and says when there's none", () => {
    const html = vendor({
      status: 200,
      vendor: { id: "stripe.com", name: "Stripe", domain: "stripe.com" },
      apis: [
        {
          id: "stripe.com/api",
          name: "Stripe API",
          currentSpec: {
            id: "abc123def456789",
            provenance: "Official",
            verifiedAt: "2026-09-24T10:00:00.000Z",
            stale: true,
          },
        },
        { id: "stripe.com/other", name: "Other", currentSpec: null },
      ],
    });
    expect(html).toContain("<h1");
    expect(html).toContain("Stripe API");
    expect(html).toContain(">Official<");
    expect(html).toContain('<time dateTime="2026-09-24T10:00:00.000Z">');
    expect(html).toContain(" · Stale");
    expect(html).toContain('href="/specs/abc123def456789"');
    expect(html).toContain("No Current Spec");
  });

  it("names a Vendor named by its domain once, and both when they differ", () => {
    const page = (name: string) =>
      vendor({
        status: 200,
        vendor: { id: "stripe.com", name, domain: "stripe.com" },
        apis: [],
      });
    const once = page("stripe.com");
    expect(once.match(/stripe\.com</g)).toHaveLength(1);
    expect(once).not.toContain("Domain");
    expect(once).not.toContain("Vendor id");
    const both = page("Stripe");
    expect(both).toContain(">Stripe<");
    expect(both).toMatch(/Domain<\/dt><dd[^>]*>stripe\.com</);
    expect(both).not.toContain("Vendor id");
  });

  it("lists the matching Vendors as links (300)", () => {
    const html = vendor({
      status: 300,
      asked: "acme",
      vendors: [
        { id: "acme.com", name: "Acme" },
        { id: "acme.io", name: "ACME" },
      ],
    });
    expect(html).toContain("Several Vendors");
    expect(html).toContain("“acme” matches 2 Vendors");
    expect(html).toContain('href="/vendors/acme.com"');
    expect(html).toContain('href="/vendors/acme.io"');
  });

  it("says the Vendor isn't in the Index and links to Search (404)", () => {
    const html = vendor({ status: 404, asked: "nowhere.test" });
    expect(html).toContain("Not in the Index");
    expect(html).toContain("No Vendor “nowhere.test” in the Index");
    expect(html).toMatch(/href="\/"[^>]*>Search for an API by name/);
  });
});
