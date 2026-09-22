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
  DOCS_PATHS,
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
      `<a href="/low.json">Low</a> <a href="/high.json">High</a> <a href="/lowpage">Page</a>`,
    );
    specAt("docs.acme.test", "/low.json", "Low");
    specAt("docs.acme.test", "/high.json", "High");
    page("docs.acme.test", "/lowpage", "");

    const { hits } = await crawlForSpecs({
      startUrl: `${o}/`,
      api,
      fetcher: fetcher(),
      judge: judgeSaying({
        [`${o}/low.json`]: 0.5,
        [`${o}/high.json`]: 0.6,
        [`${o}/lowpage`]: 0.59,
      }),
    });

    expect(hits.map((h) => h.url)).toEqual([`${o}/high.json`]);
    expect(requested("docs.acme.test", "/low.json")).toBe(false);
    expect(requested("docs.acme.test", "/lowpage")).toBe(false);
  });

  it("asks the Judge once per page, with Spec candidates first", async () => {
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

    expect(asked.map((links) => links.map((l) => l.url))).toEqual([
      [`${o}/spec.yaml`, `${o}/guide`],
    ]);
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

    expect(asked[0]?.[0]?.url).toBe(`${o}/api-spec.json`);
    expect(asked[0]).toHaveLength(60);
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

  it("judges and follows documentation-looking pages first when they outrun the page budget", async () => {
    const o = server.origin("docs.acme.test");
    page(
      "docs.acme.test",
      "/start",
      `<a href="/pricing">Pricing</a> <a href="/blog">Blog</a>
       <a href="/about">About</a> <a href="/api/reference">API</a>`,
    );
    for (const p of ["/pricing", "/blog", "/about", "/api/reference"]) {
      page("docs.acme.test", p, "");
    }
    let asked: SpecLink[][] = [];
    const judge = judgeSaying({
      [`${o}/pricing`]: 0.9,
      [`${o}/blog`]: 0.9,
      [`${o}/about`]: 0.9,
      [`${o}/api/reference`]: 0.7,
    });
    const areSpecLinks = judge.areSpecLinks.bind(judge);
    judge.areSpecLinks = async (a, links) => {
      asked = [...asked, links];
      return areSpecLinks(a, links);
    };

    await crawlForSpecs({
      startUrl: `${o}/start`,
      api,
      fetcher: fetcher(),
      judge,
      maxPages: 2,
    });

    expect(asked[0]?.[0]?.url).toBe(`${o}/api/reference`);
    expect(requested("docs.acme.test", "/api/reference")).toBe(true);
    expect(requested("docs.acme.test", "/pricing")).toBe(false);
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
