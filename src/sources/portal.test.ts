import { describe, expect, it } from "vitest";
import { registrableDomain } from "./domain";
import { findPortalCandidates, NON_VENDOR_DOMAINS } from "./portal";
import { FakeWebSearch } from "./web-search/fake";
import type { SearchResult } from "./web-search/web-search";

const hit = (url: string): SearchResult => ({
  url,
  title: `title ${url}`,
  snippet: `snippet ${url}`,
});

describe("findPortalCandidates", () => {
  it("queries for the API reference with count 8", async () => {
    const search = new FakeWebSearch();
    await findPortalCandidates("Twilio", search);
    expect(search.calls).toEqual([
      {
        query: "Twilio API reference developer documentation",
        options: { count: 8 },
      },
    ]);
  });

  it("keeps the first result per registrable domain", async () => {
    const search = new FakeWebSearch([
      hit("https://www.twilio.com/docs/usage/api"),
      hit("https://twilio.com/docs/sms"),
      hit("https://api.twilio.com/2010-04-01"),
      hit("https://www.twilio.co.uk/"),
    ]);

    expect(await findPortalCandidates("twilio", search)).toEqual([
      {
        url: "https://www.twilio.com/docs/usage/api",
        domain: "twilio.com",
        title: "title https://www.twilio.com/docs/usage/api",
        snippet: "snippet https://www.twilio.com/docs/usage/api",
      },
      {
        url: "https://www.twilio.co.uk/",
        domain: "twilio.co.uk",
        title: "title https://www.twilio.co.uk/",
        snippet: "snippet https://www.twilio.co.uk/",
      },
    ]);
  });

  it("drops known non-Vendor hosts, including their subdomains", async () => {
    const search = new FakeWebSearch([
      hit("https://github.com/twilio/twilio-oai"),
      hit("https://stackoverflow.com/questions/1"),
      hit("https://medium.com/@someone/twilio"),
      hit("https://apis.guru/"),
      hit("https://rapidapi.com/twilio"),
      hit("https://www.postman.com/twilio"),
      hit("https://en.wikipedia.org/wiki/Twilio"),
      hit("https://www.twilio.com/docs"),
    ]);

    const candidates = await findPortalCandidates("twilio", search);
    expect(candidates.map((c) => c.domain)).toEqual(["twilio.com"]);
  });

  it("returns at most five Candidates", async () => {
    const search = new FakeWebSearch(
      Array.from({ length: 8 }, (_, i) => hit(`https://vendor${i}.com/docs`)),
    );

    const candidates = await findPortalCandidates("x", search);
    expect(candidates.map((c) => c.domain)).toEqual([
      "vendor0.com",
      "vendor1.com",
      "vendor2.com",
      "vendor3.com",
      "vendor4.com",
    ]);
  });

  it("skips results without a registrable domain", async () => {
    const search = new FakeWebSearch([
      hit("http://127.0.0.1/docs"),
      hit("https://stripe.com/docs/api"),
    ]);
    const candidates = await findPortalCandidates("stripe", search);
    expect(candidates.map((c) => c.domain)).toEqual(["stripe.com"]);
  });

  it("exports the exclusion list", () => {
    expect(NON_VENDOR_DOMAINS).toContain("github.com");
  });
});

describe("registrableDomain", () => {
  it("reduces URLs and hostnames to their registrable domain", () => {
    expect(registrableDomain("https://developer.atlassian.com/cloud")).toBe(
      "atlassian.com",
    );
    expect(registrableDomain("docs.example.co.uk")).toBe("example.co.uk");
  });

  it("keeps tenants of private suffixes apart", () => {
    expect(registrableDomain("https://acme.github.io/api")).toBe(
      "acme.github.io",
    );
  });

  it("is null for IPs", () => {
    expect(registrableDomain("http://10.0.0.1/")).toBeNull();
  });
});
