import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "~/fetch/__fixtures__/server";
import { createFetcher, type Fetcher, type FetchResult } from "~/fetch/fetcher";
import { FakeJudge, type FakeJudgeScript } from "~/judge/fake";
import {
  type ApiRef,
  JudgeError,
  type SpecLink,
  type YesNoJudgment,
  yesNo,
} from "~/judge/judge";
import {
  crawlForSpecs,
  crawlForVendorApis,
  DOCS_PATHS,
  extractEmbeddedSpecUrls,
  extractLinks,
  isSpecCandidate,
} from "./crawl";

let server: FixtureServer;

beforeEach(async () => {
  server = await startFixtureServer();
});

afterEach(async () => {
  await server.close();
});

const api: ApiRef = { id: "acme", name: "Acme API", vendor: "Acme" };

const fetcher = (minIntervalMs = 0) =>
  createFetcher({ allowPrivate: true, lookup: fixtureLookup, minIntervalMs });

const spec = (title: string) =>
  JSON.stringify({
    openapi: "3.1.0",
    info: { title, version: "1" },
    paths: {},
  });

const html = (body: string) =>
  `<!doctype html><html><head><title>Docs</title></head><body>${body}</body></html>`;

const page = (host: string, path: string, body: string) =>
  server.send(host, path, html(body), "text/html; charset=utf-8");

const specAt = (host: string, path: string, title = "Acme") =>
  server.send(host, path, spec(title), "application/json");

/** Says yes to every link listed, no to anything else. */
const judgeSaying = (
  yes: Record<string, number>,
  script: FakeJudgeScript = {},
) =>
  new FakeJudge({
    ...script,
    isSpecLink: Object.fromEntries(
      Object.entries(yes).map(([url, p]) => [url, yesNo(p)]),
    ),
  });

const requested = (host: string, path: string) =>
  server.requests.some((r) => r.host === host && r.path === path);

describe("crawlForSpecs", () => {
  it("finds a Spec linked from the start page, with linkedFrom set", async () => {
    const start = `${server.origin("docs.acme.test")}/api`;
    const specUrl = `${server.origin("www.acme.test")}/api-spec.json`;
    page("docs.acme.test", "/api", `<a href="${specUrl}">OpenAPI spec</a>`);
    specAt("www.acme.test", "/api-spec.json");

    const { hits } = await crawlForSpecs({
      startUrl: start,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({ [specUrl]: 0.9 }),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      url: specUrl,
      linkedFrom: start,
      offHost: false,
      robotsDisallowed: false,
    });
    expect(hits[0]?.sniff.specVersion).toBe("3.1.0");
  });

  it("finds a Spec two hops away but not one three hops away", async () => {
    const o = server.origin("docs.acme.test");
    page("docs.acme.test", "/", `<a href="/reference">Reference</a>`);
    page(
      "docs.acme.test",
      "/reference",
      `<a href="/two.json">Spec</a> <a href="/deeper">More</a>`,
    );
    page("docs.acme.test", "/deeper", `<a href="/three.json">Spec</a>`);
    specAt("docs.acme.test", "/two.json", "Two");
    specAt("docs.acme.test", "/three.json", "Three");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({
        [`${o}/reference`]: 0.8,
        [`${o}/deeper`]: 0.8,
        [`${o}/two.json`]: 0.9,
        [`${o}/three.json`]: 0.9,
      }),
    });

    expect(hits.map((h) => h.url)).toEqual([`${o}/two.json`]);
    expect(hits[0]?.linkedFrom).toBe(`${o}/reference`);
    expect(requested("docs.acme.test", "/deeper")).toBe(false);
    expect(requested("docs.acme.test", "/three.json")).toBe(false);
  });

  it("follows an off-host Spec link once and flags it, but never crawls an off-host page", async () => {
    const start = `${server.origin("fly.test")}/docs/machines/api/`;
    const offSpec = `${server.origin("docs.machines.test")}/openapi.json`;
    const offPage = `${server.origin("community.other.test")}/guide`;
    page(
      "fly.test",
      "/docs/machines/api/",
      `<p>Machines API <a href="${offSpec}">OpenAPI</a></p><a href="${offPage}">Guide</a>`,
    );
    specAt("docs.machines.test", "/openapi.json", "Machines");
    page("community.other.test", "/guide", "<p>nothing</p>");

    const judge = judgeSaying({ [offSpec]: 0.9, [offPage]: 0.9 });
    const { hits } = await crawlForSpecs({
      startUrl: start,
      api,
      fetcher: fetcher(),
      judge,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      url: offSpec,
      linkedFrom: start,
      offHost: true,
    });
    expect(requested("community.other.test", "/guide")).toBe(false);
    // The off-host page was never even a candidate.
    const asked = judge.calls.flatMap((c) =>
      c.judgment === "isSpecLink" ? [c.link.url] : [],
    );
    expect(asked).not.toContain(offPage);
    expect(
      server.requests.filter(
        (r) => r.host === "docs.machines.test" && r.path === "/openapi.json",
      ),
    ).toHaveLength(1);
  });

  it("does not fetch a link the Judge scores below threshold", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/",
      `<a href="/low.json">Low</a> <a href="/high.json">High</a>`,
    );
    specAt("docs.acme.test", "/low.json", "Low");
    specAt("docs.acme.test", "/high.json", "High");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({
        [`${o}/low.json`]: 0.5,
        [`${o}/high.json`]: 0.6,
      }),
    });

    expect(hits.map((h) => h.url)).toEqual([`${o}/high.json`]);
    expect(requested("docs.acme.test", "/low.json")).toBe(false);
  });

  it("asks the Judge once per page, about its Spec candidates only", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/",
      `<a href="/guide">Guide</a> <a href="/spec.yaml">Spec</a>`,
    );
    let asked: SpecLink[][] = [];
    const judge = new FakeJudge();
    const areSpecLinks = judge.areSpecLinks.bind(judge);
    judge.areSpecLinks = async (a, links) => {
      asked = [...asked, links];
      return areSpecLinks(a, links);
    };

    await crawlForSpecs({ startUrl: `${o}/`, api, fetcher: fetcher(), judge });

    // `/guide` is a page: followed without a judgment, and it has no links.
    expect(asked.map((links) => links.map((l) => l.url))).toEqual([
      [`${o}/spec.yaml`],
    ]);
    expect(requested("docs.acme.test", "/guide")).toBe(true);
  });

  it("judges and finds a Spec linked past more than 60 navigation links", async () => {
    const o = server.origin("docs.acme.test");
    const nav = Array.from(
      { length: 300 },
      (_, i) => `<a href="/nav${i}">Nav ${i}</a>`,
    ).join("");
    page(
      "docs.acme.test",
      "/",
      `<nav>${nav}</nav><p><a href="/api-spec.json">API spec</a></p>`,
    );
    specAt("docs.acme.test", "/api-spec.json");
    let asked: SpecLink[][] = [];
    const judge = judgeSaying({ [`${o}/api-spec.json`]: 0.9 });
    const areSpecLinks = judge.areSpecLinks.bind(judge);
    judge.areSpecLinks = async (a, links) => {
      asked = [...asked, links];
      return areSpecLinks(a, links);
    };

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: fetcher(),
      judge,
    });

    expect(asked[0]?.map((l) => l.url)).toEqual([`${o}/api-spec.json`]);
    expect(hits.map((h) => h.url)).toEqual([`${o}/api-spec.json`]);
  });

  it("stops at maxPages; a fetched non-Spec does not count against it", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/start",
      `<a href="/not-a-spec.json">x</a> <a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a>`,
    );
    server.send("docs.acme.test", "/not-a-spec.json", "{}", "application/json");
    for (const p of ["/a", "/b", "/c"]) page("docs.acme.test", p, "");

    await crawlForSpecs({
      startUrl: `${o}/start`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({
        [`${o}/not-a-spec.json`]: 0.9,
        [`${o}/a`]: 0.9,
        [`${o}/b`]: 0.8,
        [`${o}/c`]: 0.7,
      }),
      maxPages: 3,
    });

    expect(requested("docs.acme.test", "/not-a-spec.json")).toBe(true);
    expect(requested("docs.acme.test", "/a")).toBe(true);
    expect(requested("docs.acme.test", "/b")).toBe(true);
    expect(requested("docs.acme.test", "/c")).toBe(false);
  });

  it("stops when the budget runs out", async () => {
    const o = server.origin("docs.acme.test");
    page("docs.acme.test", "/", `<a href="/slow">slow</a>`);
    server.route("docs.acme.test", "/slow", (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html(`<a href="/late.json">late</a>`));
      }, 1000);
    });
    specAt("docs.acme.test", "/late.json");

    const began = Date.now();
    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({ [`${o}/slow`]: 0.9, [`${o}/late.json`]: 0.9 }),
      budgetMs: 200,
    });

    expect(hits).toEqual([]);
    expect(Date.now() - began).toBeLessThan(900);
    expect(requested("docs.acme.test", "/late.json")).toBe(false);
  });

  it("keeps crawling past a page that 404s and a page the Judge fails on", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/",
      `<a href="/missing">gone</a> <a href="/broken">broken</a> <a href="/good">good</a>`,
    );
    page("docs.acme.test", "/broken", `<a href="/broken.json">x</a>`);
    page("docs.acme.test", "/good", `<a href="/good.json">Spec</a>`);
    specAt("docs.acme.test", "/broken.json", "Broken");
    specAt("docs.acme.test", "/good.json", "Good");

    const judge = judgeSaying({
      [`${o}/missing`]: 0.9,
      [`${o}/broken`]: 0.8,
      [`${o}/good`]: 0.7,
      [`${o}/broken.json`]: 0.9,
      [`${o}/good.json`]: 0.9,
    });
    const areSpecLinks = judge.areSpecLinks.bind(judge);
    judge.areSpecLinks = async (a, links): Promise<YesNoJudgment[]> => {
      if (links.some((l) => l.url === `${o}/broken.json`)) {
        throw new JudgeError("timeout", "no answer");
      }
      return areSpecLinks(a, links);
    };

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: fetcher(),
      judge,
    });

    expect(requested("docs.acme.test", "/missing")).toBe(true);
    expect(requested("docs.acme.test", "/broken.json")).toBe(false);
    expect(hits.map((h) => h.url)).toEqual([`${o}/good.json`]);
  });

  it("retries a Spec its host's robots.txt disallows and flags it; a disallowed page is never fetched", async () => {
    const start = `${server.origin("docs.val.test")}/openapi`;
    const specUrl = `${server.origin("api.val.test")}/openapi.json`;
    const blockedPage = `${server.origin("docs.val.test")}/private/guide`;
    page(
      "docs.val.test",
      "/openapi",
      `<a href="${specUrl}">openapi.json</a> <a href="/private/guide">Guide</a>`,
    );
    server.send(
      "docs.val.test",
      "/robots.txt",
      "User-agent: *\nDisallow: /private/\n",
      "text/plain",
    );
    server.send(
      "api.val.test",
      "/robots.txt",
      "User-agent: *\nDisallow: /\n",
      "text/plain",
    );
    specAt("api.val.test", "/openapi.json", "Val");
    page("docs.val.test", "/private/guide", "");

    const { hits } = await crawlForSpecs({
      startUrl: start,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({ [specUrl]: 0.9, [blockedPage]: 0.9 }),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ url: specUrl, robotsDisallowed: true });
    expect(requested("docs.val.test", "/private/guide")).toBe(false);
  });

  it("skips a disallowed Spec when the fetcher has no robots exception", async () => {
    const o = server.origin("docs.val.test");
    page("docs.val.test", "/", `<a href="/openapi.json">Spec</a>`);
    server.send(
      "docs.val.test",
      "/robots.txt",
      "User-agent: *\nDisallow: /openapi.json\n",
      "text/plain",
    );
    specAt("docs.val.test", "/openapi.json");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: withoutRobotsException(fetcher()),
      judge: judgeSaying({ [`${o}/openapi.json`]: 0.9 }),
    });

    expect(hits).toEqual([]);
    expect(requested("docs.val.test", "/openapi.json")).toBe(false);
  });

  it("returns a non-HTML start URL that is itself a Spec", async () => {
    const start = `${server.origin("api.acme.test")}/openapi.yaml`;
    server.send(
      "api.acme.test",
      "/openapi.yaml",
      "openapi: 3.0.0\ninfo:\n  title: Acme\n  version: '1'\npaths: {}\n",
      "application/yaml",
    );
    const judge = new FakeJudge();

    const { hits } = await crawlForSpecs({
      startUrl: start,
      api,
      fetcher: fetcher(),
      judge,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ url: start, offHost: false });
    expect(hits[0]?.sniff.format).toBe("yaml");
    expect(judge.calls).toEqual([]);
  });

  it("keeps a Spec reached as a page candidate at a path that doesn't look like one", async () => {
    const o = server.origin("app.acme.test");
    page(
      "app.acme.test",
      "/docs",
      `<a href="/api/docs/json">API reference</a>`,
    );
    specAt("app.acme.test", "/api/docs/json", "Acme");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/docs`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({ [`${o}/api/docs/json`]: 0.9 }),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      url: `${o}/api/docs/json`,
      linkedFrom: `${o}/docs`,
    });
  });

  it("reports the off-host domains it saw, deduplicated, first seen first, at most 3", async () => {
    const o = server.origin("fly.test");
    page(
      "fly.test",
      "/docs/",
      `<a href="${server.origin("docs.machines.test")}/#intro">Machines API</a>
       <a href="/docs/more">More</a>
       <a href="${server.origin("www.fly.test")}/pricing">Pricing</a>
       <a href="${server.origin("api.machines.test")}/other">Same domain again</a>
       <a href="${server.origin("github.test")}/superfly/docs">Edit</a>`,
    );
    page(
      "fly.test",
      "/docs/more",
      `<a href="${server.origin("chat.test")}/">Ask</a>
       <a href="${server.origin("fourth.test")}/">Fourth</a>`,
    );

    const { hits, offHostHosts } = await crawlForSpecs({
      startUrl: `${o}/docs/`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({ [`${o}/docs/more`]: 0.9 }),
    });

    expect(hits).toEqual([]);
    expect(offHostHosts).toEqual(["machines.test", "github.test", "chat.test"]);
    // Reported, never fetched.
    expect(requested("docs.machines.test", "/")).toBe(false);
  });

  describe("from a bare origin", () => {
    const probed = (host: string) =>
      server.requests
        .filter((r) => r.host === host && DOCS_PATHS.includes(r.path))
        .map((r) => r.path);

    it("starts at the documentation page and finds the Spec it links", async () => {
      const o = server.origin("www.acme.test");
      page("www.acme.test", "/", `<a href="/pricing">Pricing</a>`);
      page("www.acme.test", "/docs", `<a href="/api-spec.json">API spec</a>`);
      specAt("www.acme.test", "/api-spec.json");

      const { hits } = await crawlForSpecs({
        startUrl: `${o}/`,
        api,
        fetcher: fetcher(),
        judge: judgeSaying({ [`${o}/api-spec.json`]: 0.9 }),
      });

      expect(requested("www.acme.test", "/docs")).toBe(true);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        url: `${o}/api-spec.json`,
        linkedFrom: `${o}/docs`,
      });
    });

    it("stops probing at the first documentation page that answers", async () => {
      const o = server.origin("www.acme.test");
      page("www.acme.test", "/docs", "<p>Docs</p>");
      page("www.acme.test", "/developers", "<p>Developers</p>");

      await crawlForSpecs({
        startUrl: `${o}/`,
        api,
        fetcher: fetcher(),
        judge: new FakeJudge(),
      });

      expect(probed("www.acme.test")).toEqual(["/docs"]);
    });

    it("makes at most 4 probes, each counted against maxPages", async () => {
      const o = server.origin("www.acme.test");
      page("www.acme.test", "/", `<a href="/a">a</a> <a href="/b">b</a>`);
      for (const p of ["/a", "/b"]) page("www.acme.test", p, "");

      await crawlForSpecs({
        startUrl: `${o}/`,
        api,
        fetcher: fetcher(),
        judge: judgeSaying({ [`${o}/a`]: 0.9, [`${o}/b`]: 0.8 }),
        maxPages: 6,
      });

      expect(probed("www.acme.test")).toEqual(DOCS_PATHS.slice(0, 4));
      // 4 probes and the origin leave room for one page of the two.
      expect(requested("www.acme.test", "/a")).toBe(true);
      expect(requested("www.acme.test", "/b")).toBe(false);
    });

    it("does not count a probe robots.txt refused", async () => {
      const o = server.origin("www.acme.test");
      server.send(
        "www.acme.test",
        "/robots.txt",
        "User-agent: *\nDisallow: /docs\n",
        "text/plain",
      );
      page("www.acme.test", "/api", `<a href="/api-spec.json">API spec</a>`);
      specAt("www.acme.test", "/api-spec.json");

      const { hits } = await crawlForSpecs({
        startUrl: `${o}/`,
        api,
        fetcher: fetcher(),
        judge: judgeSaying({ [`${o}/api-spec.json`]: 0.9 }),
      });

      // `/docs` and `/docs/api` are disallowed, so never requested.
      expect(probed("www.acme.test")).toEqual([
        "/developers",
        "/developer",
        "/api",
      ]);
      expect(hits.map((h) => h.url)).toEqual([`${o}/api-spec.json`]);
    });

    it("makes no probe when the start URL has a path", async () => {
      const o = server.origin("www.acme.test");
      page("www.acme.test", "/start", "<p>Start</p>");

      await crawlForSpecs({
        startUrl: `${o}/start`,
        api,
        fetcher: fetcher(),
        judge: new FakeJudge(),
      });

      expect(probed("www.acme.test")).toEqual([]);
    });

    it("crawls from the origin when no documentation path answers", async () => {
      const o = server.origin("www.acme.test");
      page("www.acme.test", "/", `<a href="/openapi.yaml">Spec</a>`);
      server.send(
        "www.acme.test",
        "/openapi.yaml",
        "openapi: 3.0.0\ninfo:\n  title: Acme\n  version: '1'\npaths: {}\n",
        "application/yaml",
      );

      const { hits } = await crawlForSpecs({
        startUrl: `${o}/`,
        api,
        fetcher: fetcher(),
        judge: judgeSaying({ [`${o}/openapi.yaml`]: 0.9 }),
      });

      expect(probed("www.acme.test")).toEqual(DOCS_PATHS.slice(0, 4));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        url: `${o}/openapi.yaml`,
        linkedFrom: `${o}/`,
      });
    });

    it("still crawls the origin once the documentation runs dry", async () => {
      const o = server.origin("www.acme.test");
      page("www.acme.test", "/docs", "<p>Coming soon</p>");
      page("www.acme.test", "/", `<a href="/openapi.yaml">Spec</a>`);
      server.send(
        "www.acme.test",
        "/openapi.yaml",
        "openapi: 3.0.0\ninfo:\n  title: Acme\n  version: '1'\npaths: {}\n",
        "application/yaml",
      );

      const { hits } = await crawlForSpecs({
        startUrl: `${o}/`,
        api,
        fetcher: fetcher(),
        judge: judgeSaying({ [`${o}/openapi.yaml`]: 0.9 }),
      });

      expect(hits.map((h) => h.url)).toEqual([`${o}/openapi.yaml`]);
    });
  });

  it("follows documentation-looking pages first, unjudged, when they outrun the page budget", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/start",
      `<a href="/pricing">Pricing</a> <a href="/blog">Blog</a>
       <a href="/api/reference">API</a> <a href="/about">About</a>
       <a href="/docs/guide">Guide</a>`,
    );
    for (const p of [
      "/pricing",
      "/blog",
      "/api/reference",
      "/about",
      "/docs/guide",
    ]) {
      page("docs.acme.test", p, "");
    }
    const judge = new FakeJudge();

    await crawlForSpecs({
      startUrl: `${o}/start`,
      api,
      fetcher: fetcher(),
      judge,
      maxPages: 4,
    });

    const fetched = server.requests
      .filter((r) => r.host === "docs.acme.test" && r.path !== "/robots.txt")
      .map((r) => r.path);
    // Documentation first in document order, then the rest, to the budget.
    expect(fetched).toEqual([
      "/start",
      "/api/reference",
      "/docs/guide",
      "/pricing",
    ]);
    expect(judge.calls).toEqual([]);
  });

  it("finds a Spec named only in a script, resolved from the site root", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/api-reference/introduction",
      `<a href="/guide">Guide</a><script>self.__next_f.push([1,"{\\"openapi\\":\\"api-reference/v2-openapi.json\\"}"])</script>`,
    );
    specAt("docs.acme.test", "/api-reference/v2-openapi.json");
    let asked: SpecLink[][] = [];
    const judge = judgeSaying({ [`${o}/api-reference/v2-openapi.json`]: 0.9 });
    const areSpecLinks = judge.areSpecLinks.bind(judge);
    judge.areSpecLinks = async (a, links) => {
      asked = [...asked, links];
      return areSpecLinks(a, links);
    };

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/api-reference/introduction`,
      api,
      fetcher: fetcher(),
      judge,
    });

    expect(asked[0]?.map((l) => l.url)).toEqual([
      `${o}/api-reference/v2-openapi.json`,
    ]);
    expect(hits.map((h) => h.url)).toEqual([
      `${o}/api-reference/v2-openapi.json`,
    ]);
    expect(hits[0]?.linkedFrom).toBe(`${o}/api-reference/introduction`);
  });

  it("finds an absolute Spec URL in inline JSON, ranked ahead of an equal anchor", async () => {
    const o = server.origin("docs.acme.test");
    const specUrl = `${server.origin("app.acme.test")}/v2/openapi.yaml`;
    const escaped = specUrl.replaceAll("/", "\\/");
    page(
      "docs.acme.test",
      "/api",
      `<a href="/other-openapi.json">Other</a><script type="application/json">{"spec":{"url":"${escaped}"}}</script>`,
    );
    server.send(
      "app.acme.test",
      "/v2/openapi.yaml",
      "openapi: 3.1.0\ninfo:\n  title: Acme\n  version: '2'\npaths: {}\n",
      "application/yaml",
    );
    specAt("docs.acme.test", "/other-openapi.json", "Other");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/api`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({
        [specUrl]: 0.9,
        [`${o}/other-openapi.json`]: 0.9,
      }),
    });

    expect(hits.map((h) => h.url)).toEqual([
      specUrl,
      `${o}/other-openapi.json`,
    ]);
    expect(hits[0]).toMatchObject({ linkedFrom: `${o}/api`, offHost: false });
  });

  it("finds a Spec named only in a code block on the start page", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/docs/api",
      `<a href="/guide">Guide</a><pre><code><span class="token plain">${o}/openapi/public-api-1.json</span></code></pre>`,
    );
    specAt("docs.acme.test", "/openapi/public-api-1.json");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/docs/api`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({ [`${o}/openapi/public-api-1.json`]: 0.9 }),
    });

    expect(hits.map((h) => h.url)).toEqual([`${o}/openapi/public-api-1.json`]);
    expect(hits[0]?.linkedFrom).toBe(`${o}/docs/api`);
  });

  it("makes one candidate of a Spec URL that is both an anchor and in a script", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/api",
      `<a href="/openapi.json">OpenAPI</a><script>window.cfg={spec:"/openapi.json"}</script>`,
    );
    let asked: SpecLink[][] = [];
    const judge = new FakeJudge();
    const areSpecLinks = judge.areSpecLinks.bind(judge);
    judge.areSpecLinks = async (a, links) => {
      asked = [...asked, links];
      return areSpecLinks(a, links);
    };

    await crawlForSpecs({
      startUrl: `${o}/api`,
      api,
      fetcher: fetcher(),
      judge,
    });

    expect(asked).toEqual([[{ url: `${o}/openapi.json`, text: "OpenAPI" }]]);
  });

  it("never throws, even when the start URL is unreachable", async () => {
    await expect(
      crawlForSpecs({
        startUrl: "not a url",
        api,
        fetcher: fetcher(),
        judge: new FakeJudge(),
      }),
    ).resolves.toEqual({ hits: [], offHostHosts: [] });
  });
});

describe("crawlForVendorApis", () => {
  const vendor = { id: "acme.test", name: "Acme" };

  /** Says yes to every vendor API link listed, no to anything else. */
  const apiJudge = (yes: Record<string, number>) =>
    new FakeJudge({
      isVendorApiLink: Object.fromEntries(
        Object.entries(yes).map(([url, p]) => [url, yesNo(p)]),
      ),
    });

  it("returns the links the Judge takes for APIs, in score order", async () => {
    const o = server.origin("developer.acme.test");
    page(
      "developer.acme.test",
      "/",
      `<a href="/pricing">Pricing</a> <a href="/mail">Mail API</a>
       <a href="/crm">CRM API</a> <a href="/guides">Guides</a>
       <a href="/books">Books API</a>`,
    );
    for (const p of ["/mail", "/crm", "/books"])
      page("developer.acme.test", p, "");

    const judge = apiJudge({
      [`${o}/mail`]: 0.7,
      [`${o}/crm`]: 0.95,
      [`${o}/books`]: 0.8,
      [`${o}/guides`]: 0.5,
    });
    const hits = await crawlForVendorApis({
      startUrl: `${o}/`,
      vendor,
      fetcher: fetcher(),
      judge,
    });

    expect(hits).toEqual([
      { name: "CRM API", url: `${o}/crm` },
      { name: "Books API", url: `${o}/books` },
      { name: "Mail API", url: `${o}/mail` },
    ]);
    const asked = judge.calls.filter((c) => c.judgment === "isVendorApiLink");
    expect(asked[0]).toMatchObject({ vendor });
  });

  it("collapses links naming the same API, keeping the best-scored one", async () => {
    const o = server.origin("developer.acme.test");
    page(
      "developer.acme.test",
      "/",
      `<a href="/mail">Mail API</a> <a href="/mail/v2">mail  api</a>
       <a href="/mail-overview">Mail</a> <a href="/crm">CRM API</a>`,
    );

    const hits = await crawlForVendorApis({
      startUrl: `${o}/`,
      vendor,
      fetcher: fetcher(),
      judge: apiJudge({
        [`${o}/mail`]: 0.7,
        [`${o}/mail/v2`]: 0.9,
        [`${o}/mail-overview`]: 0.8,
        [`${o}/crm`]: 0.85,
      }),
    });

    expect(hits).toEqual([
      { name: "mail api", url: `${o}/mail/v2` },
      { name: "CRM API", url: `${o}/crm` },
    ]);
  });

  it("reads the API pages it finds, one link deep, for more APIs", async () => {
    const o = server.origin("developer.acme.test");
    page("developer.acme.test", "/", `<a href="/mail">Mail API</a>`);
    page(
      "developer.acme.test",
      "/mail",
      `<a href="/mail">Mail API</a> <a href="/sms">SMS API</a>`,
    );
    page("developer.acme.test", "/sms", `<a href="/fax">Fax API</a>`);

    const hits = await crawlForVendorApis({
      startUrl: `${o}/`,
      vendor,
      fetcher: fetcher(),
      judge: apiJudge({
        [`${o}/mail`]: 0.9,
        [`${o}/sms`]: 0.8,
        [`${o}/fax`]: 0.8,
      }),
    });

    expect(hits.map((h) => h.name)).toEqual(["Mail API", "SMS API"]);
    expect(requested("developer.acme.test", "/sms")).toBe(false);
  });

  it("never asks about links off the portal's registrable domain", async () => {
    const o = server.origin("developer.acme.test");
    const other = `${server.origin("elsewhere.test")}/api`;
    page(
      "developer.acme.test",
      "/",
      `<a href="${other}">Other API</a> <a href="/crm">CRM API</a>`,
    );
    const judge = apiJudge({ [other]: 0.9, [`${o}/crm`]: 0.9 });

    const hits = await crawlForVendorApis({
      startUrl: `${o}/`,
      vendor,
      fetcher: fetcher(),
      judge,
    });

    expect(hits).toEqual([{ name: "CRM API", url: `${o}/crm` }]);
    expect(
      judge.calls.some(
        (c) => c.judgment === "isVendorApiLink" && c.link.url === other,
      ),
    ).toBe(false);
  });

  it("returns at most 10 and reads at most maxPages pages", async () => {
    const o = server.origin("developer.acme.test");
    const paths = Array.from({ length: 12 }, (_, i) => `/api${i}`);
    page(
      "developer.acme.test",
      "/",
      paths.map((p, i) => `<a href="${p}">API number ${i}</a>`).join(" "),
    );
    for (const p of paths) page("developer.acme.test", p, "");

    const hits = await crawlForVendorApis({
      startUrl: `${o}/`,
      vendor,
      fetcher: fetcher(),
      judge: apiJudge(
        Object.fromEntries(paths.map((p, i) => [`${o}${p}`, 0.9 - i * 0.01])),
      ),
    });

    expect(hits).toHaveLength(10);
    expect(hits[0]?.name).toBe("API number 0");
    expect(hits[9]?.name).toBe("API number 9");
    const pagesRead = server.requests.filter(
      (r) => r.host === "developer.acme.test" && r.path !== "/robots.txt",
    );
    expect(pagesRead).toHaveLength(4);
  });

  it("stops when the budget runs out and keeps what it has", async () => {
    const o = server.origin("developer.acme.test");
    page("developer.acme.test", "/", `<a href="/slow">Slow API</a>`);
    server.route("developer.acme.test", "/slow", (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html(`<a href="/late">Late API</a>`));
      }, 1000);
    });

    const began = Date.now();
    const hits = await crawlForVendorApis({
      startUrl: `${o}/`,
      vendor,
      fetcher: fetcher(),
      judge: apiJudge({ [`${o}/slow`]: 0.9, [`${o}/late`]: 0.9 }),
      budgetMs: 200,
    });

    expect(hits).toEqual([{ name: "Slow API", url: `${o}/slow` }]);
    expect(Date.now() - began).toBeLessThan(900);
  });

  it("never throws: an unreachable portal or a failing Judge is nothing found", async () => {
    const o = server.origin("developer.acme.test");
    page("developer.acme.test", "/", `<a href="/crm">CRM API</a>`);
    const failing = new FakeJudge();
    failing.areVendorApiLinks = () =>
      Promise.reject(new JudgeError("timeout", "slow"));

    await expect(
      crawlForVendorApis({
        startUrl: `${o}/`,
        vendor,
        fetcher: fetcher(),
        judge: failing,
      }),
    ).resolves.toEqual([]);
    await expect(
      crawlForVendorApis({
        startUrl: "not a url",
        vendor,
        fetcher: fetcher(),
        judge: apiJudge({}),
      }),
    ).resolves.toEqual([]);
  });
});

describe("extractLinks", () => {
  const base = "https://docs.acme.test/guide/intro";

  it("resolves, dedupes and skips mailto, javascript and fragments", () => {
    const links = extractLinks(
      `<a href="../openapi.json">Spec</a>
       <a href='/openapi.json#x'>Again</a>
       <a href="mailto:a@b.test">Mail</a>
       <a href="javascript:void(0)">JS</a>
       <a href="#top">Top</a>
       <a href="intro#section">Self</a>
       <a href=https://other.test/x?a=1&amp;b=2>Other</a>
       <a name="anchor">No href</a>`,
      base,
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://docs.acme.test/openapi.json",
      "https://other.test/x?a=1&b=2",
    ]);
  });

  it("collapses anchor text and takes context from the paragraph or the heading", () => {
    const links = extractLinks(
      `<h2>Machines   API</h2>
       <a href="/a"> Download
         the <b>OpenAPI</b>&nbsp;spec </a>
       <p>Our spec is at <a href="/b">this link</a>, for tools.</p>
       <script>var s = '<a href="/hidden">x</a>';</script>`,
      base,
    );
    expect(links).toEqual([
      {
        url: "https://docs.acme.test/a",
        text: "Download the OpenAPI spec",
        context: "Machines API",
      },
      {
        url: "https://docs.acme.test/b",
        text: "this link",
        context: "Our spec is at this link, for tools.",
      },
    ]);
  });

  it("caps text, context and the number of links", () => {
    const long = "word ".repeat(100);
    const many = Array.from(
      { length: 70 },
      (_, i) => `<a href="/p${i}">${i}</a>`,
    ).join("");
    const [first] = extractLinks(
      `<p>${long}<a href="/x">${long}</a></p>`,
      base,
    );
    expect(first?.text.length).toBe(200);
    expect(first?.context?.length).toBe(300);
    const links = extractLinks(many, base);
    expect(links).toHaveLength(60);
    expect(links[59]?.url).toBe("https://docs.acme.test/p59");
  });

  it("keeps a Spec link that comes after more than 60 other links", () => {
    const nav = Array.from(
      { length: 300 },
      (_, i) => `<a href="/nav${i}">${i}</a>`,
    ).join("");
    const links = extractLinks(
      `${nav}<a href="/api-spec.json">API spec</a>`,
      base,
    );
    expect(links).toHaveLength(60);
    expect(links[59]?.url).toBe("https://docs.acme.test/api-spec.json");
    expect(links[58]?.url).toBe("https://docs.acme.test/nav58");
  });
});

describe("extractEmbeddedSpecUrls", () => {
  const base = "https://docs.acme.test/api-reference/introduction";

  it("reads scripts only, resolving a path with or without its leading slash from the site root", () => {
    const html = `<a href="/in-anchor/openapi.json">x</a><p>openapi.json in text</p>
      <script>a="api-reference/v2-openapi.json";b='/specs/swagger.yml';</script>
      <script type="application/json">{"u":"https:\\/\\/app.acme.test\\/api\\/docs\\/json","v":"https://x.test/openapi.js"}</script>`;
    expect(extractEmbeddedSpecUrls(html, base)).toEqual([
      "https://docs.acme.test/api-reference/v2-openapi.json",
      "https://docs.acme.test/specs/swagger.yml",
      "https://app.acme.test/api/docs/json",
    ]);
  });

  it("finds a Spec URL in a code block, its highlighting spans stripped", () => {
    const html = `<pre class="prism-code"><code><span class="token-line"><span class="token plain">https://api-docs.example.com/openapi/public-api-1.json</span></span></code></pre>`;
    expect(extractEmbeddedSpecUrls(html, base)).toEqual([
      "https://api-docs.example.com/openapi/public-api-1.json",
    ]);
  });

  it("finds a Spec whose directory, not file name, names openapi in a script's escaped JSON", () => {
    const html = `<script>self.__next_f.push([1,"curl https:\\/\\/api-docs.example.com\\/openapi\\/public-api-1.json\\n"])</script>`;
    expect(extractEmbeddedSpecUrls(html, base)).toEqual([
      "https://api-docs.example.com/openapi/public-api-1.json",
    ]);
  });

  it("finds a swagger directory path in code, decoding entities", () => {
    const html = `<code>GET /swagger/v1/api.yaml</code><pre>https:&#x2F;&#x2F;x.test&#47;openapi&#47;v2.yml?a=1&amp;b=2</pre>`;
    expect(extractEmbeddedSpecUrls(html, base)).toEqual([
      "https://docs.acme.test/swagger/v1/api.yaml",
      "https://x.test/openapi/v2.yml",
    ]);
  });

  it("ignores a .json URL with no openapi or swagger segment", () => {
    const html = `<script>a="/assets/app.json";b="https://openapi.x.test/app.json"</script><pre>https://x.test/assets/app.json</pre>`;
    expect(extractEmbeddedSpecUrls(html, base)).toEqual([]);
  });

  it("puts script matches ahead of code matches, deduplicated", () => {
    const html = `<pre>/openapi/a.json /openapi/b.json</pre><script>x="/openapi/b.json"</script>`;
    expect(extractEmbeddedSpecUrls(html, base)).toEqual([
      "https://docs.acme.test/openapi/b.json",
      "https://docs.acme.test/openapi/a.json",
    ]);
  });

  it("dedupes and caps at 10 per page", () => {
    const refs = Array.from({ length: 15 }, (_, i) => `"/v${i}/openapi.json"`);
    const html = `<script>${[refs[0], ...refs].join(",")}</script>`;
    const urls = extractEmbeddedSpecUrls(html, base);
    expect(urls).toHaveLength(10);
    expect(urls[0]).toBe("https://docs.acme.test/v0/openapi.json");
    expect(urls[9]).toBe("https://docs.acme.test/v9/openapi.json");
  });
});

describe("isSpecCandidate", () => {
  it.each([
    ["https://www.mux.com/api-spec.json", true],
    ["https://docs.firecrawl.dev/api-reference/v2-openapi.json", true],
    ["https://api-docs.render.com/openapi/render-public-api-1.json", true],
    ["https://neon.com/api_spec/release/v2.json", true],
    ["https://app.infisical.com/api/docs/json", false],
    ["https://acme.test/spec.yml", true],
    ["https://acme.test/swagger-ui/", true],
    ["https://acme.test/v1/api-docs", true],
    ["https://acme.test/docs/reference", false],
    ["https://openapi.acme.test/docs", false],
  ])("%s → %s", (url, expected) => {
    expect(isSpecCandidate(url)).toBe(expected);
  });
});

/**
 * The fixture fetcher plus the ADR 0003 exception WTR-44 adds to the real one:
 * under `ignoreRobots` the URL is fetched straight from the fixture server and
 * reported as disallowed.
 */
/**
 * A fetcher from before ADR 0003: it drops `ignoreRobots`, so a disallowed URL
 * throws `robots-disallowed` again and `crawlForSpecs` must skip the link.
 */
function withoutRobotsException(inner: Fetcher): Fetcher {
  return {
    fetchUrl: (url, opts) => inner.fetchUrl(url, { signal: opts?.signal }),
  };
}
