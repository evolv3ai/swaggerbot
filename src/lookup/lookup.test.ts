import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { slugify } from "~/domain/catalog";
import { Outcome } from "~/domain/outcome";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "~/fetch/__fixtures__/server";
import { createFetcher, FetchError, type Fetcher } from "~/fetch/fetcher";
import { type KnownPathHit, probeKnownPaths } from "~/fetch/known-paths";
import { sniffSpec } from "~/fetch/sniff";
import { openDb } from "~/index-store/db";
import { FakeJudge, type FakeJudgeScript } from "~/judge/fake";
import { JudgeError, yesNo } from "~/judge/judge";
import { type ApiCandidate, createApisGuru } from "~/sources/apis-guru";
import type { CrawlHit, CrawlResult, VendorApiHit } from "~/sources/crawl";
import type {
  GitHubCodeSearch,
  GitHubRepos,
  RepoInfo,
  SpecHit,
} from "~/sources/github";
import { FakeWebSearch } from "~/sources/web-search/fake";
import { SearchError, type WebSearch } from "~/sources/web-search/web-search";
import { apisGuruList } from "./__fixtures__/apis-guru";
import {
  createLookup,
  type LookupDeps,
  type LookupRequest,
  provenanceOf,
} from "./lookup";

const NOW = "2026-09-22T10:00:00.000Z";

let server: FixtureServer;
let dir: string;

beforeEach(async () => {
  server = await startFixtureServer();
  dir = mkdtempSync(join(tmpdir(), "swaggerbot-lookup-"));
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const spec = (title: string) =>
  JSON.stringify({
    openapi: "3.0.3",
    info: { title, version: "1" },
    paths: { "/things": { get: { tags: ["things"] } } },
  });

/**
 * A fake crawl answering `result` (or throwing it, for an Error), recording
 * each start URL.
 */
function fakeCrawl(result: Partial<CrawlResult> | Error = {}): {
  crawl: NonNullable<LookupDeps["crawl"]>;
  starts: string[];
} {
  const starts: string[] = [];
  return {
    starts,
    async crawl({ startUrl }) {
      starts.push(startUrl);
      if (result instanceof Error) throw result;
      return { hits: [], offHostHosts: [], ...result };
    },
  };
}

/**
 * A fake Vendor API crawl answering `hits` (or throwing, for an Error),
 * recording each start URL.
 */
function fakeVendorCrawl(hits: VendorApiHit[] | Error = []): {
  vendorCrawl: NonNullable<LookupDeps["vendorCrawl"]>;
  starts: string[];
} {
  const starts: string[] = [];
  return {
    starts,
    async vendorCrawl({ startUrl }) {
      starts.push(startUrl);
      if (hits instanceof Error) throw hits;
      return hits;
    },
  };
}

/**
 * A fetcher that answers the `apexes` URLs itself (redirecting to the given
 * final URL, or throwing the given error) and hands every other URL to
 * `fetcher`, recording each apex asked for.
 */
function fakeApexes(apexes: Record<string, string | Error>) {
  const asked: string[] = [];
  const wrap = (fetcher: Fetcher): Fetcher => ({
    async fetchUrl(url, opts) {
      const apex = apexes[url];
      if (apex === undefined) return fetcher.fetchUrl(url, opts);
      asked.push(url);
      if (apex instanceof Error) throw apex;
      return {
        url,
        finalUrl: apex,
        status: 200,
        contentType: "text/html",
        bytes: new TextEncoder().encode("<html></html>"),
        robotsDisallowed: false,
      };
    },
  });
  return { wrap, asked };
}

function setup(
  script: FakeJudgeScript,
  webSearch: WebSearch | null = new FakeWebSearch(),
  github?: GitHubRepos,
  /** `null` runs the real crawl with this Lookup's fetcher and Judge. */
  crawl: ReturnType<typeof fakeCrawl> | null = fakeCrawl(),
  githubSearch?: GitHubCodeSearch,
  vendorCrawl = fakeVendorCrawl(),
  /** Wraps the fixture fetcher, e.g. to fake answers for `https://` URLs. */
  wrapFetcher: (fetcher: Fetcher) => Fetcher = (f) => f,
) {
  const judge = new FakeJudge(script);
  const fetcher = wrapFetcher(
    createFetcher({
      allowPrivate: true,
      lookup: fixtureLookup,
      minIntervalMs: 0,
    }),
  );
  const probed: string[] = [];
  const lookup = createLookup({
    db: openDb(join(dir, "index.db")),
    judge,
    apisGuru: createApisGuru({
      fetchJson: async () => apisGuruList(server.origin),
      cachePath: join(dir, "apis-guru-list.json"),
    }),
    webSearch,
    fetcher,
    now: () => new Date(NOW),
    probe: (domain, opts) => {
      probed.push(domain);
      return probeKnownPaths(`${domain}:${server.port}`, fetcher, {
        ...opts,
        scheme: "http",
      });
    },
    ...(crawl ? { crawl: crawl.crawl } : {}),
    vendorCrawl: vendorCrawl.vendorCrawl,
    ...(github ? { github } : {}),
    ...(githubSearch ? { githubSearch } : {}),
  });
  return {
    judge,
    lookup,
    probed,
    crawls: crawl?.starts ?? [],
    vendorCrawls: vendorCrawl.starts,
  };
}

/** Parses against the Outcome schema, so every answer is a valid Outcome. */
async function ask(
  lookup: ReturnType<typeof setup>["lookup"],
  name: string,
  request: Omit<LookupRequest, "name"> = {},
) {
  return Outcome.parse(await lookup({ name, ...request }));
}

const yes = yesNo(0.95);

describe("lookup", () => {
  it("answers Resolved from an Official APIs.guru origin", async () => {
    server.send(
      "developer.payco.test",
      "/openapi.json",
      spec("PayCo API"),
      "application/json",
    );
    const { lookup, judge } = setup({
      whichApi: {
        payco: {
          probabilities: { "payco.test/payco-api": 0.9, none: 0.1 },
          confidence: 0.9,
        },
      },
      specDescribesApi: { "PayCo API": yes },
    });

    const outcome = await ask(lookup, "payco");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      api: { id: "payco.test/payco-api", name: "PayCo API" },
      vendor: { id: "payco.test", domain: "payco.test" },
      provenance: "Official",
      currentSpec: { specVersion: "3.0.3", format: "json" },
      verifiedAt: NOW,
      sources: [
        {
          url: `${server.origin("developer.payco.test")}/openapi.json`,
          provenance: "Official",
          lastVerifiedAt: NOW,
        },
      ],
    });
    expect(outcome.diagnostics).toBeUndefined();
    // Settled by the origin: no known paths, no mirror.
    expect(server.requests.map((r) => r.host)).not.toContain("apis-guru.test");
    expect(server.requests.map((r) => r.host)).not.toContain("api.payco.test");
    expect(judge.calls.map((c) => c.judgment)).toEqual([
      "whichApi",
      "specDescribesApi",
    ]);
  });

  it("answers a second Lookup of the same name from the Index without the Judge", async () => {
    server.send(
      "developer.payco.test",
      "/openapi.json",
      spec("PayCo API"),
      "application/json",
    );
    const { lookup, judge } = setup({
      whichApi: {
        payco: {
          probabilities: { "payco.test/payco-api": 0.9, none: 0.1 },
          confidence: 0.9,
        },
      },
      specDescribesApi: { "PayCo API": yes },
    });

    const first = await ask(lookup, "payco");
    const calls = judge.calls.length;
    const requests = server.requests.length;
    const second = await ask(lookup, "PayCo API ");

    expect(second).toEqual(first);
    expect(judge.calls).toHaveLength(calls);
    expect(server.requests).toHaveLength(requests);
  });

  it("answers Resolved from a Developer Portal and a known path", async () => {
    server.send(
      "api.acme.test",
      "/openapi.json",
      spec("Acme API"),
      "application/json",
    );
    const search = new FakeWebSearch([
      {
        url: "https://github.com/acme/sdk",
        title: "acme/sdk",
        snippet: "Not the Vendor",
      },
      {
        url: `${server.origin("www.acme.test")}/docs`,
        title: "Acme API Reference",
        snippet: "Build with Acme.",
      },
    ]);
    const { lookup, judge } = setup(
      {
        whichApi: {
          acme: {
            probabilities: { "acme.test/api": 0.9, none: 0.1 },
            confidence: 0.9,
          },
        },
        specDescribesApi: { "Acme API": yes },
      },
      search,
    );

    const outcome = await ask(lookup, "acme");

    expect(search.calls).toHaveLength(1);
    expect(outcome).toMatchObject({
      outcome: "Resolved",
      api: { id: "acme.test/api", name: "Acme API" },
      vendor: { id: "acme.test", domain: "acme.test" },
      provenance: "Official",
      sources: [
        {
          url: `${server.origin("api.acme.test")}/openapi.json`,
          provenance: "Official",
        },
      ],
    });
    const asked = judge.calls.find((c) => c.judgment === "whichApi");
    expect(asked).toMatchObject({
      candidates: [
        { id: "acme.test/api", name: "Acme API", vendor: "acme.test" },
      ],
    });
  });

  it("answers Resolved from a known path on a host whose robots.txt shuts it (ADR 0003)", async () => {
    // api.val.town: `Disallow: /` for the whole app host, Spec at /openapi.json.
    server.send(
      "api.acme.test",
      "/robots.txt",
      "User-agent: *\nDisallow: /\n",
      "",
    );
    server.send(
      "api.acme.test",
      "/openapi.json",
      spec("Acme API"),
      "application/json",
    );
    const search = new FakeWebSearch([
      {
        url: `${server.origin("www.acme.test")}/docs`,
        title: "Acme API Reference",
        snippet: "Build with Acme.",
      },
    ]);
    const { lookup } = setup(
      {
        whichApi: {
          acme: {
            probabilities: { "acme.test/api": 0.9, none: 0.1 },
            confidence: 0.9,
          },
        },
        specDescribesApi: { "Acme API": yes },
      },
      search,
    );

    const outcome = await ask(lookup, "acme");

    const url = `${server.origin("api.acme.test")}/openapi.json`;
    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Official",
      sources: [{ url, provenance: "Official" }],
    });
    expect(outcome.diagnostics).toEqual([
      `robots.txt on api.acme.test:${server.port} disallowed ${url}; ADR 0003 allowed the single fetch`,
    ]);
  });

  it("merges portal Candidates whose pages end on one domain", async () => {
    // neon-tech.test redirects to neon.test, as neon.tech does to neon.com.
    server.route("www.neon-tech.test", "/neon-api-reference", (_req, res) => {
      res
        .writeHead(301, {
          location: `${server.origin("neon.test")}/docs/reference/api-reference`,
        })
        .end();
    });
    server.send(
      "neon.test",
      "/docs/reference/api-reference",
      "<html>Neon API</html>",
      "text/html",
    );
    server.send(
      "neon.test",
      "/docs/neon-api",
      "<html>Neon</html>",
      "text/html",
    );
    const search = new FakeWebSearch([
      {
        url: `${server.origin("www.neon-tech.test")}/neon-api-reference`,
        title: "Neon API Reference",
        snippet: "The Neon API.",
      },
      {
        url: `${server.origin("neon.test")}/docs/neon-api`,
        title: "Neon API | Neon Docs",
        snippet: "Manage Neon.",
      },
    ]);
    const { lookup, judge } = setup(
      {
        whichApi: {
          neon: {
            probabilities: { "neon.test/api": 0.9, none: 0.1 },
            confidence: 0.9,
          },
        },
      },
      search,
    );

    const outcome = await ask(lookup, "neon");

    expect(judge.calls[0]).toEqual({
      judgment: "whichApi",
      name: "neon",
      candidates: [
        {
          id: "neon.test/api",
          name: "Neon API",
          vendor: "neon.test",
          description: "The Neon API.",
        },
      ],
    });
    expect(outcome).toMatchObject({
      outcome: "NoSpec",
      api: { id: "neon.test/api", name: "Neon API" },
      vendor: { id: "neon.test", domain: "neon.test" },
    });
    expect(outcome.diagnostics).toBeUndefined();
    // Each Candidate's own page fetched, and no origin.
    expect(
      server.requests.filter((r) => r.path === "/").map((r) => r.host),
    ).toEqual([]);
    expect(
      server.requests
        .filter(
          (r) => r.path.startsWith("/neon-api") || r.path === "/docs/neon-api",
        )
        .map((r) => `${r.host}${r.path}`),
    ).toEqual([
      "www.neon-tech.test/neon-api-reference",
      "neon.test/docs/neon-api",
    ]);
  });

  it("re-homes a portal Candidate from its origin when its page can't be fetched", async () => {
    // The page drops the connection; the origin redirects to neon.test.
    server.route("www.neon-tech.test", "/neon-api-reference", (req) => {
      req.socket.destroy();
    });
    server.route("www.neon-tech.test", "/", (_req, res) => {
      res.writeHead(301, { location: `${server.origin("neon.test")}/` }).end();
    });
    server.send("neon.test", "/", "<html>Neon</html>", "text/html");
    const search = new FakeWebSearch([
      {
        url: `${server.origin("www.neon-tech.test")}/neon-api-reference`,
        title: "Neon API Reference",
        snippet: "The Neon API.",
      },
    ]);
    const { lookup, judge } = setup({}, search);

    const outcome = await ask(lookup, "neon");

    expect(
      judge.calls[0]?.judgment === "whichApi" &&
        judge.calls[0].candidates.map((c) => c.id),
    ).toEqual(["neon.test/api"]);
    expect(outcome.diagnostics ?? []).not.toContainEqual(
      expect.stringContaining("Developer Portal"),
    );
  });

  it("keeps a portal Candidate's search domain when neither page nor origin answers", async () => {
    const drop = (req: { socket: { destroy(): void } }) => req.socket.destroy();
    server.route("www.neon-tech.test", "/neon-api-reference", drop);
    server.route("www.neon-tech.test", "/", drop);
    const url = `${server.origin("www.neon-tech.test")}/neon-api-reference`;
    const search = new FakeWebSearch([
      { url, title: "Neon API Reference", snippet: "The Neon API." },
    ]);
    const { lookup, judge } = setup({}, search);

    const outcome = await ask(lookup, "neon");

    expect(
      judge.calls[0]?.judgment === "whichApi" &&
        judge.calls[0].candidates.map((c) => c.id),
    ).toEqual(["neon-tech.test/api"]);
    expect(outcome.diagnostics).toContain(
      `Developer Portal: could not follow ${url}; kept its domain neon-tech.test`,
    );
  });

  describe("Vendor identity from a portal domain's apex", () => {
    /** The three portal Candidates web search finds for "Neon API". */
    function neonSearch() {
      server.send(
        "neon.com",
        "/docs/reference/api-reference",
        "<html>Neon API</html>",
        "text/html",
      );
      server.send(
        "api-docs.neon.tech",
        "/reference/getting-started-with-neon-api",
        "<html>Neon API</html>",
        "text/html",
      );
      server.send(
        "developer.neoncrm.com",
        "/api-v2/",
        "<html>Neon CRM API</html>",
        "text/html",
      );
      return new FakeWebSearch([
        {
          url: `${server.origin("neon.com")}/docs/reference/api-reference`,
          title: "Neon API reference",
          snippet: "The Neon API.",
        },
        {
          url: `${server.origin("api-docs.neon.tech")}/reference/getting-started-with-neon-api`,
          title: "Getting started with Neon API",
          snippet: "Neon API docs.",
        },
        {
          url: `${server.origin("developer.neoncrm.com")}/api-v2/`,
          title: "Neon CRM API v2",
          snippet: "The Neon CRM API.",
        },
      ]);
    }

    async function askedIds(apexes: Record<string, string | Error>) {
      const fake = fakeApexes(apexes);
      const { lookup, judge } = setup(
        {},
        neonSearch(),
        undefined,
        fakeCrawl(),
        undefined,
        fakeVendorCrawl(),
        fake.wrap,
      );
      const outcome = await ask(lookup, "Neon API");
      const asked = judge.calls.find((c) => c.judgment === "whichApi");
      return {
        ids:
          asked?.judgment === "whichApi" && asked.candidates.map((c) => c.id),
        apexes: fake.asked,
        outcome,
      };
    }

    it("moves a domain's Candidates to the Candidate domain its apex redirects to", async () => {
      const { ids, apexes } = await askedIds({
        "https://neon.tech/": "https://neon.com/",
        "https://neoncrm.com/": "https://neonone.com/",
        "https://neon.com/": "https://neon.com/",
      });

      expect(ids).toEqual(["neon.com/api", "neoncrm.com/api"]);
      // One apex fetch per domain.
      expect([...apexes].sort()).toEqual([
        "https://neon.com/",
        "https://neon.tech/",
        "https://neoncrm.com/",
      ]);
    });

    it("moves nothing when an apex can't be fetched", async () => {
      const failed = (url: string) =>
        new FetchError("network", url, "connection reset");
      const { ids, outcome } = await askedIds({
        "https://neon.tech/": failed("https://neon.tech/"),
        "https://neoncrm.com/": failed("https://neoncrm.com/"),
        "https://neon.com/": failed("https://neon.com/"),
      });

      expect(ids).toEqual(["neon.com/api", "neon.tech/api", "neoncrm.com/api"]);
      expect(outcome.diagnostics ?? []).not.toContainEqual(
        expect.stringContaining("Developer Portal"),
      );
    });

    it("moves nothing when an apex redirects to a domain no Candidate has", async () => {
      const { ids } = await askedIds({
        "https://neon.tech/": "https://neon-elsewhere.com/",
        "https://neoncrm.com/": "https://neonone.com/",
        "https://neon.com/": "https://neon.com/",
      });

      expect(ids).toEqual(["neon.com/api", "neon.tech/api", "neoncrm.com/api"]);
    });
  });

  it("drops a portal Candidate for a Vendor APIs.guru already has", async () => {
    const search = new FakeWebSearch([
      {
        url: `${server.origin("docs.payco.test")}/api`,
        title: "PayCo API docs",
        snippet: "",
      },
      {
        url: `${server.origin("www.payco-rival.test")}/developers`,
        title: "PayCo Rival developers",
        snippet: "",
      },
    ]);
    const { lookup, judge } = setup({}, search);

    expect(await ask(lookup, "payco")).toMatchObject({ outcome: "Unknown" });

    const asked = judge.calls.filter((c) => c.judgment === "whichApi");
    expect(asked).toHaveLength(2);
    expect(
      asked[1]?.judgment === "whichApi" && asked[1].candidates.map((c) => c.id),
    ).toEqual(["payco.test/payco-api", "payco-rival.test/api"]);
  });

  it("answers Ambiguous when the top Candidate's margin is too small", async () => {
    const { lookup } = setup({
      whichApi: {
        messaging: {
          probabilities: {
            "chatly.test/chatly-messaging": 0.5,
            "talkr.test/talkr-messaging": 0.42,
            none: 0.08,
          },
          confidence: 0.5,
        },
      },
    });

    expect(await ask(lookup, "messaging")).toEqual({
      outcome: "Ambiguous",
      candidates: [
        {
          apiId: "chatly.test/chatly-messaging",
          name: "Chatly Messaging",
          vendor: "chatly.test",
          probability: 0.5,
        },
        {
          apiId: "talkr.test/talkr-messaging",
          name: "Talkr Messaging",
          vendor: "talkr.test",
          probability: 0.42,
        },
      ],
    });
  });

  it("answers Ambiguous for an umbrella name without asking whichApi", async () => {
    const { lookup, judge } = setup({});

    expect(await ask(lookup, "Umbra")).toEqual({
      outcome: "Ambiguous",
      candidates: [
        {
          apiId: "umbra.test/alpha",
          name: "Umbra Alpha",
          vendor: "umbra.test",
          probability: 0.5,
        },
        {
          apiId: "umbra.test/beta",
          name: "Umbra Beta",
          vendor: "umbra.test",
          probability: 0.5,
        },
      ],
    });
    expect(judge.calls).toEqual([]);
  });

  it("answers Ambiguous for a name that prefixes an `apis` Vendor label", async () => {
    const { lookup, judge } = setup({});

    expect(await ask(lookup, "google")).toEqual({
      outcome: "Ambiguous",
      candidates: [
        {
          apiId: "googleapis.com/drive",
          name: "Drive API",
          vendor: "googleapis.com",
          probability: 0.5,
        },
        {
          apiId: "googleapis.com/gmail",
          name: "Gmail API",
          vendor: "googleapis.com",
          probability: 0.5,
        },
      ],
    });
    expect(judge.calls).toEqual([]);
  });

  it("answers Ambiguous over the Vendor's APIs for a name judged the Vendor's", async () => {
    const { lookup, judge } = setup({ isVendorName: { Zenith: yesNo(0.9) } });

    expect(await ask(lookup, "Zenith")).toEqual({
      outcome: "Ambiguous",
      candidates: ["Nova", "Orbit", "Pulse"].map((service) => ({
        apiId: `zenithcorp.test/${service.toLowerCase()}`,
        name: `Zenith ${service}`,
        vendor: "zenithcorp.test",
        probability: 1 / 3,
      })),
    });
    expect(judge.calls.map((c) => c.judgment)).toEqual([
      "whichApi",
      "isVendorName",
    ]);
    expect(judge.calls[1]).toEqual({
      judgment: "isVendorName",
      name: "Zenith",
      vendor: { id: "zenithcorp.test", name: "zenithcorp.test" },
    });
  });

  it("keeps Unknown for a Vendor name when the Vendor has one API", async () => {
    const { lookup } = setup({ isVendorName: { payco: yesNo(0.9) } });

    expect(await ask(lookup, "payco")).toEqual({
      outcome: "Unknown",
      name: "payco",
    });
  });

  it("keeps Unknown when the name is unlikely to be the Vendor's", async () => {
    const { lookup, judge } = setup({ isVendorName: { Zenith: yesNo(0.3) } });

    expect(await ask(lookup, "Zenith")).toEqual({
      outcome: "Unknown",
      name: "Zenith",
    });
    expect(judge.calls.map((c) => c.judgment)).toContain("isVendorName");
  });

  it("answers Unknown when whichApi says none", async () => {
    const search = new FakeWebSearch([]);
    const { lookup, judge, vendorCrawls } = setup({}, search);

    expect(await ask(lookup, "payco billing")).toEqual({
      outcome: "Unknown",
      name: "payco billing",
    });
    // PayCo has one APIs.guru API, so the Judge is asked whether the name
    // means PayCo as a whole before its portal is crawled; it says no.
    expect(judge.calls.map((c) => c.judgment)).toEqual([
      "whichApi",
      "isVendorName",
    ]);
    expect(vendorCrawls).toEqual([]);
    expect(search.calls).toHaveLength(1);
  });

  it("answers Unconfirmed when the Spec only probably describes the API", async () => {
    server.send(
      "developer.docsy.test",
      "/openapi.yaml",
      "openapi: 3.1.0\ninfo:\n  title: Docsy Test Fixtures\n  version: '1'\npaths: {}\n",
      "application/yaml",
    );
    const { lookup, judge } = setup({
      whichApi: {
        docsy: {
          probabilities: { "docsy.test/docsy-api": 0.95, none: 0.05 },
          confidence: 0.95,
        },
      },
      specDescribesApi: { "Docsy Test Fixtures": yesNo(0.55) },
    });

    const outcome = await ask(lookup, "docsy");

    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      api: { id: "docsy.test/docsy-api" },
      spec: { specVersion: "3.1.0", format: "yaml" },
      sources: [{ provenance: "Official" }],
      verifiedAt: NOW,
    });
    if (outcome.outcome !== "Unconfirmed") throw new Error("unreachable");
    expect(outcome.reasons.join("\n")).toMatch(/0\.55/);
    expect(outcome.reasons.join("\n")).toMatch(/known paths on docsy\.test/);
    expect(outcome.reasons).not.toContain("only a third-party copy found");

    // An Unconfirmed Spec is stored but never answered Resolved from the Index.
    const calls = judge.calls.length;
    expect((await ask(lookup, "docsy")).outcome).toBe("Unconfirmed");
    expect(judge.calls.length).toBeGreaterThan(calls);
  });

  it("answers Unconfirmed when only the APIs.guru mirror describes the API", async () => {
    server.send(
      "apis-guru.test",
      "/copyco.test/openapi.json",
      spec("CopyCo API"),
      "application/json",
    );
    const { lookup } = setup({
      whichApi: {
        copyco: {
          probabilities: { "copyco.test/copyco-api": 0.95, none: 0.05 },
          confidence: 0.95,
        },
      },
      specDescribesApi: { "CopyCo API": yes },
    });

    const outcome = await ask(lookup, "copyco");

    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      api: { id: "copyco.test/copyco-api" },
      sources: [
        {
          url: `${server.origin("apis-guru.test")}/copyco.test/openapi.json`,
          provenance: "Mirror",
        },
      ],
    });
    if (outcome.outcome !== "Unconfirmed") throw new Error("unreachable");
    expect(outcome.reasons[0]).toBe("only a third-party copy found");
    // The origin 404 is reported, not thrown.
    expect(outcome.diagnostics?.join("\n")).toMatch(/gone\.json/);
  });

  it("answers No Spec when no Spec found describes the API", async () => {
    server.send(
      "apis-guru.test",
      "/nospec.test/openapi.json",
      spec("Something Else Entirely"),
      "application/json",
    );
    const { lookup } = setup({
      whichApi: {
        nospec: {
          probabilities: { "nospec.test/nospec-api": 0.95, none: 0.05 },
          confidence: 0.95,
        },
      },
      specDescribesApi: { "Something Else Entirely": yesNo(0.1) },
    });

    expect(await ask(lookup, "nospec")).toMatchObject({
      outcome: "NoSpec",
      api: { id: "nospec.test/nospec-api" },
      vendor: { id: "nospec.test" },
      communityAvailable: false,
    });
  });

  it("answers Unknown with diagnostics when the Judge throws", async () => {
    class BrokenJudge extends FakeJudge {
      override async whichApi(): Promise<never> {
        throw new JudgeError("timeout", "Jev did not answer within 10 s");
      }
    }
    const judge = new BrokenJudge();
    const lookup = createLookup({
      db: openDb(join(dir, "index.db")),
      judge,
      apisGuru: createApisGuru({
        fetchJson: async () => apisGuruList(server.origin),
        cachePath: join(dir, "apis-guru-list.json"),
      }),
      webSearch: new FakeWebSearch([
        { url: "https://payco.example/docs", title: "PayCo docs", snippet: "" },
      ]),
      fetcher: createFetcher({ allowPrivate: true, lookup: fixtureLookup }),
    });

    const outcome = Outcome.parse(await lookup({ name: "payco" }));

    expect(outcome).toEqual({
      outcome: "Unknown",
      name: "payco",
      diagnostics: [
        "Judge whichApi: Jev did not answer within 10 s",
        "Developer Portal: could not follow https://payco.example/docs; kept its domain payco.example",
        "Judge whichApi: Jev did not answer within 10 s",
      ],
    });
  });

  it("reports a search error and still answers", async () => {
    const failing: WebSearch = {
      search: async () => {
        throw new SearchError(
          "Brave search failed with HTTP 503",
          "brave",
          503,
        );
      },
    };
    const { lookup } = setup({}, failing);

    expect(await ask(lookup, "nothing like it")).toEqual({
      outcome: "Unknown",
      name: "nothing like it",
      diagnostics: ["web search: Brave search failed with HTTP 503"],
    });
  });
});

describe("lookup with a Vendor's APIs from its Developer Portal", () => {
  const vendorName = { mailco: yesNo(0.9) };
  const portalSearch = () => {
    server.send(
      "docs.mailco.test",
      "/developer",
      "<html>MailCo developers</html>",
      "text/html",
    );
    return new FakeWebSearch([
      {
        url: `${server.origin("docs.mailco.test")}/developer`,
        title: "MailCo Developer",
        snippet: "Build with MailCo.",
      },
    ]);
  };
  const hit = (name: string) => ({
    name,
    url: `${server.origin("docs.mailco.test")}/${slugify(name)}`,
  });

  it("answers Ambiguous over the APIs the portal names when APIs.guru has none", async () => {
    const hits = ["Marketing API", "Transactional API", "Mobile SDK API"].map(
      hit,
    );
    const { lookup, judge, vendorCrawls } = setup(
      { isVendorName: vendorName },
      portalSearch(),
      undefined,
      fakeCrawl(),
      undefined,
      fakeVendorCrawl(hits),
    );

    expect(await ask(lookup, "mailco")).toEqual({
      outcome: "Ambiguous",
      candidates: hits.map(({ name }) => ({
        apiId: `mailco.test/${slugify(name)}`,
        name,
        vendor: "mailco.test",
        probability: 1 / 3,
      })),
    });
    expect(vendorCrawls).toEqual([
      `${server.origin("docs.mailco.test")}/developer`,
    ]);
    expect(judge.calls.map((c) => c.judgment)).toEqual([
      "whichApi",
      "isVendorName",
    ]);
  });

  it("merges the portal's APIs with the Vendor's one APIs.guru API by id", async () => {
    const vendorCrawl = fakeVendorCrawl([
      { name: "PayCo API", url: "https://payco.test/api" },
      { name: "PayCo Payouts", url: "https://payco.test/payouts" },
    ]);
    const { lookup, vendorCrawls } = setup(
      {
        whichApi: {
          payco: {
            probabilities: { "payco.test/payco-api": 0.05, none: 0.95 },
            confidence: 0.95,
          },
        },
        isVendorName: { payco: yesNo(0.9) },
      },
      null,
      undefined,
      fakeCrawl(),
      undefined,
      vendorCrawl,
    );

    const outcome = await ask(lookup, "payco");

    expect(outcome).toMatchObject({
      outcome: "Ambiguous",
      candidates: [
        { apiId: "payco.test/payco-api", probability: 0.5 },
        { apiId: "payco.test/payco-payouts", probability: 0.5 },
      ],
    });
    // No portal page: the crawl starts from the Vendor's domain.
    expect(vendorCrawls).toEqual(["https://payco.test"]);
  });

  it("does not crawl for a Vendor with two APIs.guru APIs", async () => {
    const { lookup, vendorCrawls } = setup(
      {
        whichApi: {
          "Umbra Alpha": {
            probabilities: { "umbra.test/alpha": 0.05, none: 0.95 },
            confidence: 0.95,
          },
        },
        isVendorName: { "Umbra Alpha": yesNo(0.9) },
      },
      null,
    );

    expect(await ask(lookup, "Umbra Alpha")).toMatchObject({
      outcome: "Ambiguous",
      candidates: [{ apiId: "umbra.test/alpha" }, { apiId: "umbra.test/beta" }],
    });
    expect(vendorCrawls).toEqual([]);
  });

  it("keeps today's answer when the portal names only one API", async () => {
    const { lookup, vendorCrawls } = setup(
      { isVendorName: vendorName },
      portalSearch(),
      undefined,
      fakeCrawl(),
      undefined,
      fakeVendorCrawl([hit("Marketing API")]),
    );

    expect(await ask(lookup, "mailco")).toEqual({
      outcome: "Unknown",
      name: "mailco",
    });
    expect(vendorCrawls).toHaveLength(1);
  });

  it("does not crawl when the name is unlikely to be the Vendor's", async () => {
    const { lookup, vendorCrawls } = setup(
      { isVendorName: { mailco: yesNo(0.3) } },
      portalSearch(),
      undefined,
      fakeCrawl(),
      undefined,
      fakeVendorCrawl([hit("Marketing API"), hit("Transactional API")]),
    );

    expect(await ask(lookup, "mailco")).toMatchObject({ outcome: "Unknown" });
    expect(vendorCrawls).toEqual([]);
  });

  it("diagnoses a failed crawl and keeps today's answer", async () => {
    const { lookup } = setup(
      { isVendorName: vendorName },
      portalSearch(),
      undefined,
      fakeCrawl(),
      undefined,
      fakeVendorCrawl(new Error("portal exploded")),
    );

    const outcome = await ask(lookup, "mailco");

    expect(outcome).toMatchObject({ outcome: "Unknown", name: "mailco" });
    expect(outcome.diagnostics).toContain("Vendor API crawl: portal exploded");
  });
});

describe("lookup with APIs.guru duplicates", () => {
  const TITLE = "GHub v3 REST API";

  /** An APIs.guru Candidate of Vendor `ghub.test` keyed `key`. */
  function candidate(key: string, name: string, i: number): ApiCandidate {
    const service = key.split(":")[1];
    return {
      key,
      apiId: `ghub.test/${slugify(service ?? name)}`,
      name,
      vendor: { id: "ghub.test", name: "ghub.test", domain: "ghub.test" },
      description: `Entry ${key}.`,
      preferredVersion: "1.0.0",
      mirrorUrl: `${server.origin("apis-guru.test")}/${key}/openapi.json`,
      originUrls: [`${server.origin("api.ghub.test")}/v${i}.json`],
      possiblyOfficialUrls: [],
      updated: "2024-01-01T00:00:00.000Z",
    };
  }

  function setupGuru(candidates: ApiCandidate[], script: FakeJudgeScript) {
    const judge = new FakeJudge(script);
    const lookup = createLookup({
      db: openDb(join(dir, "index.db")),
      judge,
      apisGuru: {
        findCandidates: async () => candidates,
        findVendorApis: async () => candidates,
      },
      webSearch: null,
      fetcher: createFetcher({
        allowPrivate: true,
        lookup: fixtureLookup,
        minIntervalMs: 0,
      }),
      probe: async () => [],
      crawl: fakeCrawl().crawl,
    });
    return { judge, lookup };
  }

  it("collapses one Vendor's entries with one title to a single choice", async () => {
    // Twenty variants, the unsuffixed key fourth, as APIs.guru lists GitHub.
    const keys = [
      "ghub.test:api.ghub.test",
      "ghub.test:ghec",
      "ghub.test:ghub.ae",
      "ghub.test",
      ...Array.from({ length: 16 }, (_, i) => `ghub.test:ghes-3.${i}`),
    ];
    const { lookup, judge } = setupGuru(
      keys.map((key, i) => candidate(key, TITLE, i)),
      {
        whichApi: {
          ghub: {
            probabilities: { "ghub.test/ghub-v3-rest-api": 0.9, none: 0.1 },
            confidence: 0.9,
          },
        },
      },
    );

    const outcome = await ask(lookup, "ghub");

    expect(judge.calls[0]).toEqual({
      judgment: "whichApi",
      name: "ghub",
      candidates: [
        {
          id: "ghub.test/ghub-v3-rest-api",
          name: TITLE,
          vendor: "ghub.test",
          description: "Entry ghub.test.",
        },
      ],
    });
    expect(outcome).toMatchObject({
      outcome: "NoSpec",
      api: { id: "ghub.test/ghub-v3-rest-api", name: TITLE },
    });
    // The representative's origin URL, then the group's, at most eight.
    expect(
      server.requests
        .filter((r) => r.host === "api.ghub.test" && r.path !== "/robots.txt")
        .map((r) => r.path),
    ).toEqual([3, 0, 1, 2, 4, 5, 6, 7].map((i) => `/v${i}.json`));
  });

  /** `key`'s Candidate with these origin paths on `api.ghub.test`. */
  function withOrigins(key: string, paths: string[]): ApiCandidate {
    return {
      ...candidate(key, TITLE, 0),
      originUrls: paths.map((p) => `${server.origin("api.ghub.test")}${p}`),
    };
  }

  const picksGhub: FakeJudgeScript["whichApi"] = {
    ghub: {
      probabilities: { "ghub.test/ghub-v3-rest-api": 0.9, none: 0.1 },
      confidence: 0.9,
    },
  };

  /** The paths fetched on `api.ghub.test`, in order. */
  const originsFetched = () =>
    server.requests
      .filter((r) => r.host === "api.ghub.test" && r.path !== "/robots.txt")
      .map((r) => r.path);

  const DOTCOM = "/descriptions/api.ghub.test/api.ghub.test.json";
  const DOTCOM_DATED =
    "/descriptions/api.ghub.test/api.ghub.test.2022-11-28.json";

  it("merges only the group's origin URLs in the representative's directory", async () => {
    const { lookup } = setupGuru(
      [
        withOrigins("ghub.test:ghec", ["/descriptions/ghec/ghec.json"]),
        withOrigins("ghub.test:api.ghub.test", [DOTCOM_DATED]),
        withOrigins("ghub.test:ghes-3.8", [
          "/descriptions/ghes-3.8/ghes-3.8.json",
        ]),
        withOrigins("ghub.test", [DOTCOM]),
      ],
      { whichApi: picksGhub },
    );

    expect(await ask(lookup, "ghub")).toMatchObject({ outcome: "NoSpec" });
    expect(originsFetched()).toEqual([DOTCOM, DOTCOM_DATED]);
  });

  it("merges only the representative's origin URLs when no member shares its directory", async () => {
    const { lookup } = setupGuru(
      [
        withOrigins("ghub.test:ghec", ["/descriptions/ghec/ghec.json"]),
        withOrigins("ghub.test", [DOTCOM]),
      ],
      { whichApi: picksGhub },
    );

    await ask(lookup, "ghub");

    expect(originsFetched()).toEqual([DOTCOM]);
  });

  it("makes the earliest origin URL's Spec Current among Specs of one API Version", async () => {
    const versioned = (title: string) =>
      JSON.stringify({
        openapi: "3.0.3",
        info: { title, version: "1.1.4" },
        paths: { "/things": { get: { tags: ["things"] } } },
      });
    server.send("api.ghub.test", DOTCOM, versioned("GHub"), "application/json");
    server.send(
      "api.ghub.test",
      DOTCOM_DATED,
      versioned("GHub 2022-11-28"),
      "application/json",
    );
    const { lookup } = setupGuru(
      [
        withOrigins("ghub.test:api.ghub.test", [DOTCOM_DATED]),
        withOrigins("ghub.test", [DOTCOM]),
      ],
      {
        whichApi: picksGhub,
        // The Judge likes the second origin's Spec better.
        specDescribesApi: { GHub: yesNo(0.9), "GHub 2022-11-28": yesNo(0.99) },
      },
    );

    const outcome = await ask(lookup, "ghub");

    expect(originsFetched()).toEqual([DOTCOM, DOTCOM_DATED]);
    expect(outcome).toMatchObject({
      outcome: "Resolved",
      currentSpec: { apiVersion: "1.1.4" },
      sources: [{ url: `${server.origin("api.ghub.test")}${DOTCOM}` }],
      alternateSpecs: [],
    });
  });

  it("keeps one Vendor's entries with different titles apart", async () => {
    const { lookup, judge } = setupGuru(
      [
        candidate("ghub.test", TITLE, 0),
        candidate("ghub.test:graphql", "GHub GraphQL API", 1),
      ],
      {},
    );

    // Not "ghub": that names the Vendor, Ambiguous without `whichApi`.
    await ask(lookup, "ghub rest");

    expect(
      judge.calls[0]?.judgment === "whichApi" &&
        judge.calls[0].candidates.map((c) => c.id),
    ).toEqual(["ghub.test/ghub-v3-rest-api", "ghub.test/graphql"]);
  });
});

describe("lookup with the Developer Portal crawl", () => {
  const script: FakeJudgeScript = {
    whichApi: {
      nospec: {
        probabilities: { "nospec.test/nospec-api": 0.95, none: 0.05 },
        confidence: 0.95,
      },
    },
    specDescribesApi: { "NoSpec API": yes, "NoSpec API (draft)": yesNo(0.55) },
  };

  /** A crawl hit for a Spec titled `title`, on the start URL's domain. */
  function crawlHit(
    url: string,
    title = "NoSpec API",
    extra: Partial<CrawlHit> = {},
  ): CrawlHit {
    const bytes = new TextEncoder().encode(spec(title));
    const sniff = sniffSpec(bytes, "application/json");
    if (!sniff) throw new Error("fixture is not a Spec");
    return {
      url,
      bytes,
      sniff,
      linkedFrom: "https://nospec.test/docs",
      offHost: false,
      robotsDisallowed: false,
      ...extra,
    };
  }

  it("answers Resolved from a Spec only the crawl found, starting at the Vendor's domain", async () => {
    const url = `${server.origin("docs.nospec.test")}/reference/openapi.json`;
    const { lookup, crawls } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({ hits: [crawlHit(url)] }),
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      api: { id: "nospec.test/nospec-api" },
      provenance: "Official",
      sources: [{ url, provenance: "Official" }],
    });
    expect(outcome.diagnostics?.join("\n")).not.toMatch(/crawl/);
    expect(crawls).toEqual(["https://nospec.test"]);
    // Settled by the crawl: the mirror is never fetched.
    expect(server.requests.map((r) => r.host)).not.toContain("apis-guru.test");
  });

  it("does not crawl once the known-path probe has settled the answer", async () => {
    server.send(
      "api.nospec.test",
      "/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { lookup, crawls } = setup(script);

    expect(await ask(lookup, "nospec")).toMatchObject({
      outcome: "Resolved",
      sources: [{ url: `${server.origin("api.nospec.test")}/openapi.json` }],
    });
    expect(crawls).toEqual([]);
  });

  it("starts the crawl at a portal Candidate's page", async () => {
    const portal = `${server.origin("www.acme.test")}/docs`;
    const search = new FakeWebSearch([
      { url: portal, title: "Acme API Reference", snippet: "" },
    ]);
    const { lookup, crawls } = setup(
      {
        whichApi: {
          acme: {
            probabilities: { "acme.test/api": 0.9, none: 0.1 },
            confidence: 0.9,
          },
        },
      },
      search,
    );

    const outcome = await ask(lookup, "acme");

    expect(outcome).toMatchObject({ outcome: "NoSpec" });
    expect(crawls).toEqual([portal]);
  });

  it("crawls a portal Candidate's bare origin from its documentation", async () => {
    const o = server.origin("www.acme.test");
    const html = (body: string) =>
      `<!doctype html><html><body>${body}</body></html>`;
    server.send(
      "www.acme.test",
      "/",
      html(`<a href="/pricing">Pricing</a>`),
      "text/html",
    );
    server.send(
      "www.acme.test",
      "/docs",
      html(`<a href="/api-spec.json">API spec</a>`),
      "text/html",
    );
    server.send(
      "www.acme.test",
      "/api-spec.json",
      spec("Acme API"),
      "application/json",
    );
    const search = new FakeWebSearch([
      { url: `${o}/`, title: "Acme", snippet: "The Acme platform." },
    ]);
    const { lookup } = setup(
      {
        whichApi: {
          acme: {
            probabilities: { "acme.test/api": 0.9, none: 0.1 },
            confidence: 0.9,
          },
        },
        isSpecLink: { [`${o}/api-spec.json`]: yes },
        specDescribesApi: { "Acme API": yes },
      },
      search,
      undefined,
      null,
    );

    const outcome = await ask(lookup, "acme");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Official",
      sources: [{ url: `${o}/api-spec.json`, provenance: "Official" }],
    });
    expect(
      server.requests.some(
        (r) => r.host === "www.acme.test" && r.path === "/docs",
      ),
    ).toBe(true);
  });

  it("resolves from a robots-disallowed hit and says ADR 0003 allowed it", async () => {
    const url = `${server.origin("api.nospec.test")}/openapi.json`;
    const { lookup } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({
        hits: [crawlHit(url, "NoSpec API", { robotsDisallowed: true })],
      }),
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [{ url, provenance: "Official" }],
    });
    expect(outcome.diagnostics).toContain(
      `robots.txt on ${new URL(url).host} disallowed ${url}; ADR 0003 allowed the single fetch`,
    );
  });

  it("keeps the previous answer when the crawl throws", async () => {
    server.send(
      "developer.nospec.test",
      "/openapi.json",
      spec("NoSpec API (draft)"),
      "application/json",
    );
    const { lookup } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl(new Error("portal exploded")),
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      sources: [
        {
          url: `${server.origin("developer.nospec.test")}/openapi.json`,
          provenance: "Official",
        },
      ],
    });
    if (outcome.outcome !== "Unconfirmed") throw new Error("unreachable");
    expect(outcome.diagnostics).toContain("crawl: portal exploded");
    expect(outcome.reasons.join("\n")).toMatch(
      /crawl from https:\/\/nospec\.test \(0 found\)/,
    );
  });

  it("answers Resolved from an off-host Spec linked from the Vendor's page, as Endorsed", async () => {
    const url = `${server.origin("docs.nospec-cdn.test")}/openapi.json`;
    const { lookup, judge } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({ hits: [crawlHit(url, "NoSpec API", { offHost: true })] }),
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Endorsed",
      sources: [{ url, provenance: "Endorsed" }],
      verifiedAt: NOW,
    });
    // An Endorsed Spec answers from the Index too.
    const calls = judge.calls.length;
    expect(await ask(lookup, "nospec")).toMatchObject({
      outcome: "Resolved",
      provenance: "Endorsed",
    });
    expect(judge.calls.length).toBe(calls);
  });

  it("prefers an Official Source to an Endorsed one when both describe the API", async () => {
    const endorsed = `${server.origin("docs.nospec-cdn.test")}/openapi.json`;
    const official = `${server.origin("docs.nospec.test")}/openapi.json`;
    const { lookup } = setup(
      {
        ...script,
        specDescribesApi: { "NoSpec API": yes, "NoSpec API v2": yes },
      },
      undefined,
      undefined,
      fakeCrawl({
        hits: [
          crawlHit(endorsed, "NoSpec API", { offHost: true }),
          crawlHit(official, "NoSpec API v2"),
        ],
      }),
    );

    expect(await ask(lookup, "nospec")).toMatchObject({
      outcome: "Resolved",
      provenance: "Official",
      sources: [{ url: official, provenance: "Official" }],
    });
  });

  it("probes known paths on the off-host domains the crawl reports", async () => {
    // As fly.io links docs.machines.dev, a Scalar page, never the Spec.
    const url = `${server.origin("docs.machines.test")}/openapi.json`;
    server.send(
      "docs.machines.test",
      "/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { lookup, probed } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({
        offHostHosts: ["nospec.test", "machines.test", "later.test"],
      }),
    );

    const outcome = await ask(lookup, "nospec");

    // A host the Vendor's pages link to: Endorsed, and so Resolved.
    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Endorsed",
      currentSpec: { specVersion: "3.0.3" },
      sources: [{ url, provenance: "Endorsed" }],
    });
    // The Vendor's own domain was already probed; settled on machines.test.
    expect(probed).toEqual(["nospec.test", "machines.test"]);
  });

  it("skips the off-host probe once the crawl has settled the answer", async () => {
    const url = `${server.origin("docs.nospec.test")}/openapi.json`;
    const { lookup, probed } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({ hits: [crawlHit(url)], offHostHosts: ["machines.test"] }),
    );

    expect(await ask(lookup, "nospec")).toMatchObject({ outcome: "Resolved" });
    expect(probed).toEqual(["nospec.test"]);
  });
});

describe("lookup with a GitHub origin", () => {
  const RAW = "raw.githubusercontent.com";
  const MASTER = "/ghco/openapi/master/openapi.json";
  const MAIN = "/ghco/openapi/main/openapi.json";

  /** A fake GitHubRepos answering `info` for every repo. */
  function fakeGitHub(info: RepoInfo | null) {
    const calls: string[] = [];
    const github: GitHubRepos = {
      async repoInfo(owner, repo) {
        calls.push(`${owner}/${repo}`);
        return info;
      },
    };
    return { github, calls };
  }

  const script: FakeJudgeScript = {
    whichApi: {
      ghco: {
        probabilities: { "ghco.test/ghco-api": 0.95, none: 0.05 },
        confidence: 0.95,
      },
    },
    specDescribesApi: { "GhCo API": yes, "GhCo API (stale)": yes },
  };
  const rawPaths = () =>
    server.requests.filter((r) => r.host === RAW).map((r) => r.path);

  it("skips an archived repo's Spec with a diagnostic", async () => {
    server.send(RAW, MASTER, spec("GhCo API"), "application/json");
    const { github, calls } = fakeGitHub({
      fullName: "GhCoArchive/openapi",
      defaultBranch: "master",
      archived: true,
    });
    const { lookup } = setup(script, new FakeWebSearch(), github);

    const outcome = await ask(lookup, "ghco");

    expect(calls).toEqual(["ghco/openapi"]);
    expect(outcome.outcome).not.toBe("Resolved");
    expect(outcome.diagnostics).toContain("archived repo GhCoArchive/openapi");
    expect(rawPaths()).toEqual([]);
  });

  it("fetches a master URL from main when main is the default branch", async () => {
    server.send(RAW, MASTER, spec("GhCo API (stale)"), "application/json");
    server.send(RAW, MAIN, spec("GhCo API"), "application/json");
    const { github } = fakeGitHub({
      fullName: "ghco/openapi",
      defaultBranch: "main",
      archived: false,
    });
    const { lookup } = setup(script, new FakeWebSearch(), github);

    const outcome = await ask(lookup, "ghco");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      currentSpec: { specVersion: "3.0.3" },
      sources: [
        { url: `${server.origin(RAW)}${MAIN}`, provenance: "Official" },
      ],
    });
    expect(rawPaths()).not.toContain(MASTER);
  });

  it("falls back to the original URL when the default branch has no Spec there", async () => {
    server.send(RAW, MASTER, spec("GhCo API"), "application/json");
    const { github } = fakeGitHub({
      fullName: "ghco/openapi",
      defaultBranch: "main",
      archived: false,
    });
    const { lookup } = setup(script, new FakeWebSearch(), github);

    const outcome = await ask(lookup, "ghco");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [
        { url: `${server.origin(RAW)}${MASTER}`, provenance: "Official" },
      ],
    });
    expect(rawPaths().filter((p) => p !== "/robots.txt")).toEqual([
      MAIN,
      MASTER,
    ]);
  });

  it("fetches the URL as it is when GitHub can't say", async () => {
    server.send(RAW, MASTER, spec("GhCo API"), "application/json");
    const { github, calls } = fakeGitHub(null);
    const { lookup } = setup(script, new FakeWebSearch(), github);

    const outcome = await ask(lookup, "ghco");

    expect(calls).toEqual(["ghco/openapi"]);
    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [
        { url: `${server.origin(RAW)}${MASTER}`, provenance: "Official" },
      ],
    });
    expect(outcome.diagnostics).toBeUndefined();
    expect(rawPaths().filter((p) => p !== "/robots.txt")).toEqual([MASTER]);
  });

  it("judges the GitHub org after a move by the repo's new owner", async () => {
    server.send(RAW, MASTER, spec("GhCo API"), "application/json");
    const { github } = fakeGitHub({
      fullName: "someone-else/openapi",
      defaultBranch: "master",
      archived: false,
    });
    const { lookup } = setup(script, new FakeWebSearch(), github);

    // A third party's own Spec: Community, answered only when allowed.
    expect(await ask(lookup, "ghco")).toMatchObject({
      outcome: "NoSpec",
      communityAvailable: true,
    });
    expect(await ask(lookup, "ghco", { allowCommunity: true })).toMatchObject({
      outcome: "Resolved",
      provenance: "Community",
      sources: [
        { url: `${server.origin(RAW)}${MASTER}`, provenance: "Community" },
      ],
    });
  });
});

describe("lookup with GitHub code search", () => {
  const RAW = "raw.githubusercontent.com";

  const script: FakeJudgeScript = {
    whichApi: {
      nospec: {
        probabilities: { "nospec.test/nospec-api": 0.95, none: 0.05 },
        confidence: 0.95,
      },
    },
    specDescribesApi: { "NoSpec API": yes, "NoSpec API (draft)": yesNo(0.55) },
    defaults: { isSpecLink: yes },
  };

  /** A hit in `fullName` on `HEAD`, as `searchSpecs` gives it, on the fixture server. */
  const hit = (fullName: string, path = "openapi.json"): SpecHit => ({
    fullName,
    path,
    url: `${server.origin(RAW)}/${fullName}/HEAD/${path}`,
  });

  /**
   * A fake GitHubCodeSearch answering `org` for an org search and `global`
   * for a search across GitHub, `repos` for a repo search and `trees[repo]`
   * for a repo's tree, recording each `[org, name]` and each repo listed.
   */
  function fakeSearch(
    org: SpecHit[] | null,
    global: SpecHit[] | null = [],
    repos: string[] | null = [],
    trees: Record<string, SpecHit[] | null> = {},
  ) {
    const calls: [string | null, string][] = [];
    const listed: string[] = [];
    const search: GitHubCodeSearch = {
      async searchSpecs(o, name) {
        calls.push([o, name]);
        return o === null ? global : org;
      },
      async searchSpecRepos() {
        return repos;
      },
      async specsInRepo(fullName) {
        listed.push(fullName);
        return fullName in trees ? (trees[fullName] ?? null) : [];
      },
    };
    return { search, calls, listed };
  }

  const rawPaths = () =>
    server.requests
      .filter((r) => r.host === RAW && r.path !== "/robots.txt")
      .map((r) => r.path);

  it("resolves from a hit in the org named after the Vendor id", async () => {
    const found = hit("nospec/openapi");
    server.send(
      RAW,
      "/nospec/openapi/HEAD/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search, calls } = fakeSearch([found]);
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Official",
      sources: [{ url: found.url, provenance: "Official" }],
    });
    // `nospec.test` → org `nospec`; the org had a hit, so no global search.
    expect(calls).toEqual([["nospec", "NoSpec API"]]);
    // Settled by the search: the mirror is never fetched.
    expect(server.requests.map((r) => r.host)).not.toContain("apis-guru.test");
  });

  it("searches across GitHub by the API's name only when the org has nothing", async () => {
    const found = hit("fans/nospec-specs");
    server.send(
      RAW,
      "/fans/nospec-specs/HEAD/openapi.json",
      spec("NoSpec API (draft)"),
      "application/json",
    );
    const { search, calls } = fakeSearch([], [found]);
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    const outcome = await ask(lookup, "nospec", { allowCommunity: true });

    expect(calls).toEqual([
      ["nospec", "NoSpec API"],
      [null, "NoSpec API"],
    ]);
    // Outside the Vendor's org, with no original: Community.
    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      sources: [{ url: found.url, provenance: "Community" }],
    });
    if (outcome.outcome !== "Unconfirmed") throw new Error("unreachable");
    const reasons = outcome.reasons.join("\n");
    expect(reasons).toMatch(/GitHub code search in org nospec \(0 hits\)/);
    expect(reasons).toMatch(/GitHub code search for "NoSpec API" \(1 hits\)/);
  });

  it("answers No Spec for a Community-only Spec unless the Caller allows Community", async () => {
    const found = hit("fans/nospec-specs");
    server.send(
      RAW,
      "/fans/nospec-specs/HEAD/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search } = fakeSearch([], [found]);
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    expect(await ask(lookup, "nospec")).toMatchObject({
      outcome: "NoSpec",
      api: { id: "nospec.test/nospec-api" },
      communityAvailable: true,
    });
    expect(await ask(lookup, "nospec", { allowCommunity: true })).toMatchObject(
      {
        outcome: "Resolved",
        provenance: "Community",
        sources: [{ url: found.url, provenance: "Community" }],
      },
    );
    // The Index never gives a Community Spec to a Caller who didn't allow it.
    expect(await ask(lookup, "nospec")).toMatchObject({
      outcome: "NoSpec",
      communityAvailable: true,
    });
  });

  it("keeps a third party's copy of an Endorsed Spec a Mirror", async () => {
    const endorsed = `${server.origin("docs.nospec-cdn.test")}/openapi.json`;
    const found = hit("fans/nospec-specs");
    const bytes = spec("NoSpec API (draft)");
    server.send(
      RAW,
      "/fans/nospec-specs/HEAD/openapi.json",
      bytes,
      "application/json",
    );
    const crawlBytes = new TextEncoder().encode(bytes);
    const sniff = sniffSpec(crawlBytes, "application/json");
    if (!sniff) throw new Error("fixture is not a Spec");
    const { search } = fakeSearch([], [found]);
    const { lookup } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({
        hits: [
          {
            url: endorsed,
            bytes: crawlBytes,
            sniff,
            linkedFrom: "https://nospec.test/docs",
            offHost: true,
            robotsDisallowed: false,
          },
        ],
      }),
      search,
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      sources: [
        { url: endorsed, provenance: "Endorsed" },
        { url: found.url, provenance: "Mirror" },
      ],
    });
    if (outcome.outcome !== "Unconfirmed") throw new Error("unreachable");
    expect(outcome.reasons).not.toContain("only a third-party copy found");
  });

  it("never fetches a hit the Judge ranks below specLink", async () => {
    const weak = hit("nospec/sdk", "src/openapi-client.json");
    const strong = hit("nospec/openapi");
    server.send(
      RAW,
      "/nospec/sdk/HEAD/src/openapi-client.json",
      spec("NoSpec API"),
      "application/json",
    );
    server.send(
      RAW,
      "/nospec/openapi/HEAD/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search } = fakeSearch([weak, strong]);
    const { lookup, judge } = setup(
      { ...script, isSpecLink: { [weak.url]: yesNo(0.3) } },
      undefined,
      undefined,
      undefined,
      search,
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [{ url: strong.url }],
    });
    expect(rawPaths()).toEqual(["/nospec/openapi/HEAD/openapi.json"]);
    // Each hit judged as a link: its path, in its repo.
    expect(
      judge.calls.filter((c) => c.judgment === "isSpecLink"),
    ).toMatchObject([
      { link: { url: weak.url, text: weak.path, context: "nospec/sdk" } },
      {
        link: { url: strong.url, text: strong.path, context: "nospec/openapi" },
      },
    ]);
  });

  it("skips an archived repo among the hits and reads the rest from their default branch", async () => {
    const archived = hit("nospec/old-specs");
    const live = hit("nospec/openapi");
    server.send(
      RAW,
      "/nospec/old-specs/HEAD/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    server.send(
      RAW,
      "/nospec/openapi/main/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const github: GitHubRepos = {
      async repoInfo(owner, repo) {
        return {
          fullName: `${owner}/${repo}`,
          defaultBranch: "main",
          archived: repo === "old-specs",
        };
      },
    };
    const { search } = fakeSearch([archived, live]);
    const { lookup } = setup(script, undefined, github, undefined, search);

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [
        {
          url: `${server.origin(RAW)}/nospec/openapi/main/openapi.json`,
          provenance: "Official",
        },
      ],
    });
    expect(outcome.diagnostics).toContain("archived repo nospec/old-specs");
    expect(rawPaths()).toEqual(["/nospec/openapi/main/openapi.json"]);
  });

  it("keeps the previous answer with a diagnostic when the search can't run", async () => {
    server.send(
      "developer.nospec.test",
      "/openapi.json",
      spec("NoSpec API (draft)"),
      "application/json",
    );
    const { search, calls } = fakeSearch(null);
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    const outcome = await ask(lookup, "nospec");

    expect(calls).toEqual([["nospec", "NoSpec API"]]);
    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      sources: [
        {
          url: `${server.origin("developer.nospec.test")}/openapi.json`,
          provenance: "Official",
        },
      ],
    });
    expect(
      outcome.diagnostics?.filter((d) => d.startsWith("GitHub code search")),
    ).toEqual([
      "GitHub code search: skipped (no GITHUB_TOKEN, rate-limited or failed)",
    ]);
  });

  it("judges a file from the repo tree that code search missed, and it can win", async () => {
    const small1 = hit("nospec/api-schema", "reference/events-v1/openapi.json");
    const small2 = hit("nospec/api-schema", "reference/events-v2/openapi.json");
    const big = hit("nospec/api-schema", "reference/REST/openapi.json");
    server.send(
      RAW,
      "/nospec/api-schema/HEAD/reference/REST/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search, calls, listed } = fakeSearch([small1, small2], [], [], {
      "nospec/api-schema": [small1, small2, big],
    });
    const { lookup, judge } = setup(
      {
        ...script,
        isSpecLink: { [small1.url]: yesNo(0.3), [small2.url]: yesNo(0.3) },
      },
      undefined,
      undefined,
      undefined,
      search,
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Official",
      sources: [{ url: big.url, provenance: "Official" }],
    });
    // The repo is listed once, though two hits are in it; no global search.
    expect(listed).toEqual(["nospec/api-schema"]);
    expect(calls).toEqual([["nospec", "NoSpec API"]]);
    // Duplicates between the hits and the tree are judged once.
    expect(
      judge.calls
        .filter((c) => c.judgment === "isSpecLink")
        .map((c) => (c.judgment === "isSpecLink" ? c.link.url : "")),
    ).toEqual([small1.url, small2.url, big.url]);
    expect(rawPaths()).toEqual([
      "/nospec/api-schema/HEAD/reference/REST/openapi.json",
    ]);
  });

  it("lists the trees of the org's Spec repos when code search finds nothing there", async () => {
    const found = hit("nospec/api-schema", "reference/REST/openapi.json");
    server.send(
      RAW,
      "/nospec/api-schema/HEAD/reference/REST/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search, calls, listed } = fakeSearch(
      [],
      [],
      ["nospec/api-schema", "nospec/b", "nospec/c", "nospec/d"],
      { "nospec/api-schema": [found] },
    );
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Official",
      sources: [{ url: found.url, provenance: "Official" }],
    });
    // At most three repos; the org's tree had a file, so no global search.
    expect(listed).toEqual(["nospec/api-schema", "nospec/b", "nospec/c"]);
    expect(calls).toEqual([["nospec", "NoSpec API"]]);
  });

  it("fetches the likeliest hit first, so a tree file can settle ahead of code search's hits", async () => {
    // PagerDuty: code search finds the Events Spec, the tree adds the REST
    // Spec; both pass the link threshold, and whichever is fetched first
    // settles the Lookup.
    const events = hit("nospec/api-schema", "reference/events/openapi.json");
    const rest = hit("nospec/api-schema", "reference/REST/openapi.json");
    for (const h of [events, rest]) {
      server.send(
        RAW,
        `/nospec/api-schema/HEAD/${h.path}`,
        spec("NoSpec API"),
        "application/json",
      );
    }
    const { search } = fakeSearch([events], [], [], {
      "nospec/api-schema": [events, rest],
    });
    const { lookup } = setup(
      {
        ...script,
        isSpecLink: { [events.url]: yesNo(0.7), [rest.url]: yesNo(0.95) },
      },
      undefined,
      undefined,
      undefined,
      search,
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [{ url: rest.url, provenance: "Official" }],
    });
    expect(rawPaths()).toEqual([
      "/nospec/api-schema/HEAD/reference/REST/openapi.json",
    ]);
  });

  it("carries on with the hits after a diagnostic when a repo tree can't be read", async () => {
    const found = hit("nospec/openapi");
    server.send(
      RAW,
      "/nospec/openapi/HEAD/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search } = fakeSearch([found], [], [], { "nospec/openapi": null });
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      sources: [{ url: found.url, provenance: "Official" }],
    });
    expect(
      outcome.diagnostics?.filter((d) => d.startsWith("GitHub repo tree")),
    ).toEqual(["GitHub repo tree nospec/openapi: skipped (failed)"]);
  });

  it("searches across GitHub after a diagnostic when the repo search can't run", async () => {
    const found = hit("fans/nospec-specs");
    server.send(
      RAW,
      "/fans/nospec-specs/HEAD/openapi.json",
      spec("NoSpec API"),
      "application/json",
    );
    const { search, calls, listed } = fakeSearch([], [found], null);
    const { lookup } = setup(script, undefined, undefined, undefined, search);

    const outcome = await ask(lookup, "nospec", { allowCommunity: true });

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      provenance: "Community",
    });
    expect(listed).toEqual([]);
    expect(calls).toEqual([
      ["nospec", "NoSpec API"],
      [null, "NoSpec API"],
    ]);
    expect(outcome.diagnostics).toContain(
      "GitHub repo search: skipped (no GITHUB_TOKEN, rate-limited or failed)",
    );
  });

  it("does not search once the crawl has settled the answer", async () => {
    const url = `${server.origin("docs.nospec.test")}/openapi.json`;
    const bytes = new TextEncoder().encode(spec("NoSpec API"));
    const sniff = sniffSpec(bytes, "application/json");
    if (!sniff) throw new Error("fixture is not a Spec");
    const { search, calls } = fakeSearch([hit("nospec/openapi")]);
    const { lookup } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({
        hits: [
          {
            url,
            bytes,
            sniff,
            linkedFrom: "https://nospec.test/docs",
            offHost: false,
            robotsDisallowed: false,
          },
        ],
      }),
      search,
    );

    expect(await ask(lookup, "nospec")).toMatchObject({ outcome: "Resolved" });
    expect(calls).toEqual([]);
  });
});

describe("lookup with several API Versions", () => {
  const HOST = "api.boxy.test";
  const API_ID = "boxy.test/boxy-api";
  const path = (version: string) => `/openapi/openapi-v${version}.json`;
  /** A Spec of `version` with `paths` paths (one by default; 0 for none). */
  const versionSpec = (version: string, paths = 1) =>
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Boxy API", version },
      ...(paths > 0 && {
        paths: Object.fromEntries(
          Array.from({ length: paths }, (_, i) => [
            i === 0 ? "/files" : `/files/${i}`,
            { get: { tags: ["files"] } },
          ]),
        ),
      }),
    });
  // Three live API Versions and a Preview, side by side as Box publishes them.
  const VERSIONS = ["2025.0", "2026.0", "2024.0", "2027.0-beta"];

  const candidate: ApiCandidate = {
    key: "boxy.test",
    apiId: API_ID,
    name: "Boxy API",
    vendor: { id: "boxy.test", name: "Boxy", domain: "boxy.test" },
    preferredVersion: "2026.0",
    mirrorUrl: `http://apis-guru.test/boxy.test/openapi.json`,
    originUrls: [],
    possiblyOfficialUrls: [],
    updated: "2024-01-01T00:00:00.000Z",
  };

  /**
   * A Lookup whose APIs.guru entry lists every Version's origin, or, with a
   * `probe`, none: the Specs are then only at the Vendor's known paths.
   * `pathCounts` serves other Versions, each with that many paths.
   */
  function setupVersions(
    probe?: LookupDeps["probe"],
    pathCounts?: Record<string, number>,
  ) {
    const versions = pathCounts ? Object.keys(pathCounts) : VERSIONS;
    for (const v of versions)
      server.send(
        HOST,
        path(v),
        versionSpec(v, pathCounts?.[v]),
        "application/json",
      );
    const judge = new FakeJudge({
      whichApi: Object.fromEntries(
        ["boxy", "boxy files"].map((name) => [
          name,
          { probabilities: { [API_ID]: 0.95, none: 0.05 }, confidence: 0.95 },
        ]),
      ),
      specDescribesApi: { "Boxy API": yes },
    });
    const guru = {
      ...candidate,
      originUrls: probe
        ? []
        : versions.map((v) => `${server.origin(HOST)}${path(v)}`),
    };
    const lookup = createLookup({
      db: openDb(join(dir, "index.db")),
      judge,
      apisGuru: {
        findCandidates: async () => [guru],
        findVendorApis: async () => [guru],
      },
      webSearch: null,
      fetcher: createFetcher({
        allowPrivate: true,
        lookup: fixtureLookup,
        minIntervalMs: 0,
      }),
      now: () => new Date(NOW),
      probe: probe ?? (async () => []),
      crawl: fakeCrawl().crawl,
    });
    return { judge, lookup };
  }

  const versionsOf = (outcome: Outcome) =>
    outcome.outcome === "Resolved"
      ? {
          current: outcome.currentSpec.apiVersion,
          alternates: outcome.alternateSpecs.map((s) => s.apiVersion),
        }
      : outcome.outcome;

  it("answers the highest non-Preview API Version as Current, the others as Alternates", async () => {
    const { lookup } = setupVersions();

    const outcome = await ask(lookup, "boxy");

    expect(versionsOf(outcome)).toEqual({
      current: "2026.0",
      alternates: ["2025.0", "2024.0"],
    });
    expect(outcome).toMatchObject({
      outcome: "Resolved",
      currentSpec: { isPreview: false, supersededAt: null },
      sources: [{ url: `${server.origin(HOST)}${path("2026.0")}` }],
    });
    // Settled by the first origin, the others were still fetched: each
    // names an API Version. The mirror, a later step, was not.
    expect(
      server.requests.filter((r) => r.host === HOST).map((r) => r.path),
    ).toEqual(expect.arrayContaining(VERSIONS.map(path)));
    expect(server.requests.map((r) => r.host)).not.toContain("apis-guru.test");
  });

  it("does not answer a partial Spec as Current over a fuller one", async () => {
    // Box: each versioned file holds only the APIs added in that version.
    const { lookup } = setupVersions(undefined, {
      "2026.0": 5,
      "2025.0": 24,
      "2024.0": 187,
    });

    expect(versionsOf(await ask(lookup, "boxy"))).toEqual({
      current: "2024.0",
      alternates: ["2026.0", "2025.0"],
    });
  });

  it("answers the highest API Version when the Specs are about the same size", async () => {
    const { lookup } = setupVersions(undefined, { "3": 100, "4": 110 });

    expect(versionsOf(await ask(lookup, "boxy"))).toEqual({
      current: "4",
      alternates: ["3"],
    });
  });

  it("ranks a Spec with no path count by API Version alone", async () => {
    const { lookup } = setupVersions(undefined, { "3": 100, "4": 0 });

    expect(versionsOf(await ask(lookup, "boxy"))).toEqual({
      current: "4",
      alternates: ["3"],
    });
  });

  it("answers the same from the Index, still leaving the Preview out", async () => {
    const { lookup, judge } = setupVersions();
    const first = await ask(lookup, "boxy");
    const calls = judge.calls.length;

    const second = await ask(lookup, "boxy");

    expect(second).toEqual(first);
    expect(judge.calls).toHaveLength(calls);
  });

  it("selects an Alternate by its API Version, from Discovery and from the Index", async () => {
    const { lookup, judge } = setupVersions();

    const live = await ask(lookup, "boxy", { apiVersion: "2025.0" });
    expect(versionsOf(live)).toEqual({
      current: "2025.0",
      alternates: ["2026.0", "2024.0"],
    });

    const calls = judge.calls.length;
    const indexed = await ask(lookup, "boxy", { apiVersion: "2024.0" });
    expect(versionsOf(indexed)).toEqual({
      current: "2024.0",
      alternates: ["2026.0", "2025.0"],
    });
    expect(judge.calls).toHaveLength(calls);
  });

  it("selects a Preview Version only when asked for it", async () => {
    const { lookup } = setupVersions();

    const outcome = await ask(lookup, "boxy", { apiVersion: "2027.0-beta" });

    expect(outcome).toMatchObject({
      outcome: "Resolved",
      currentSpec: { apiVersion: "2027.0-beta", isPreview: true },
    });
  });

  it("answers No Spec for an API Version the API does not have", async () => {
    const { lookup } = setupVersions();

    const outcome = await ask(lookup, "boxy", { apiVersion: "1999.0" });

    expect(outcome).toMatchObject({
      outcome: "NoSpec",
      api: { id: API_ID },
      communityAvailable: false,
    });
    expect(outcome.diagnostics).toContain(
      "no Spec for API Version 1999.0; found: 2025.0, 2026.0, 2024.0, 2027.0-beta (Preview)",
    );
  });

  it("marks a Spec Superseded once its Source stops serving it, and leaves it out by default", async () => {
    const { lookup } = setupVersions();
    await ask(lookup, "boxy");

    // 2024.0 is withdrawn; a Lookup under another name finds the rest again.
    server.route(HOST, path("2024.0"), (_req, res) => {
      res.writeHead(404).end();
    });
    await ask(lookup, "boxy files");
    const outcome = await ask(lookup, "boxy");

    expect(versionsOf(outcome)).toEqual({
      current: "2026.0",
      alternates: ["2025.0"],
    });
    // Still kept, and still selectable.
    expect(await ask(lookup, "boxy", { apiVersion: "2024.0" })).toMatchObject({
      outcome: "Resolved",
      currentSpec: { apiVersion: "2024.0", supersededAt: NOW },
    });
  });

  describe("from known paths", () => {
    /** A known-path hit serving `version`, as the probe returns it. */
    const hit = (url: string, version: string): KnownPathHit => {
      const bytes = new TextEncoder().encode(versionSpec(version));
      const sniff = sniffSpec(bytes, "application/json");
      if (!sniff) throw new Error("not a Spec");
      return { url, bytes, sniff, robotsDisallowed: false };
    };
    // A stale copy on the docs host beside the current Spec on the API host,
    // as Novu serves them; neither URL names an API Version.
    const DOCS = "https://docs.boxy.test/openapi.json";
    const API = "https://api.boxy.test/openapi.json";

    it.each([
      ["the stale copy first", [DOCS, API]],
      ["the current Spec first", [API, DOCS]],
    ])("judges every hit, not only the first (%s)", async (_, order) => {
      const versions: Record<string, string> = {
        [DOCS]: "3.15.0",
        [API]: "3.19.2",
      };
      const { lookup, judge } = setupVersions(async () =>
        order.map((url) => hit(url, versions[url] ?? "")),
      );

      const outcome = await ask(lookup, "boxy");

      expect(versionsOf(outcome)).toEqual({
        current: "3.19.2",
        alternates: ["3.15.0"],
      });
      expect(outcome).toMatchObject({ sources: [{ url: API }] });
      expect(
        judge.calls.filter((c) => c.judgment === "specDescribesApi"),
      ).toHaveLength(2);
    });

    it("judges identical bytes from two hits once", async () => {
      const { lookup, judge } = setupVersions(async () => [
        hit(API, "3.19.2"),
        hit("https://api.boxy.test/api-json", "3.19.2"),
      ]);

      expect(await ask(lookup, "boxy")).toMatchObject({
        outcome: "Resolved",
        currentSpec: { apiVersion: "3.19.2" },
      });
      expect(
        judge.calls.filter((c) => c.judgment === "specDescribesApi"),
      ).toHaveLength(1);
    });
  });
});

describe("lookup with a deprecated Spec", () => {
  const API_ID = "novvy.test/novvy-api";
  const DEPRECATED = "DEPRECATED: Novvy API. Use /openapi.{json,yaml} instead.";
  const API_JSON = "https://api.novvy.test/api-json";
  const OPENAPI = "https://api.novvy.test/openapi.json";

  /** A known-path hit serving API Version 3.19.2 with this `info`. */
  const hit = (
    url: string,
    info: { title: string; description?: string },
  ): KnownPathHit => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        openapi: "3.0.3",
        info: { ...info, version: "3.19.2" },
        paths: { "/events": { get: { tags: ["events"] } } },
      }),
    );
    const sniff = sniffSpec(bytes, "application/json");
    if (!sniff) throw new Error("not a Spec");
    return { url, bytes, sniff, robotsDisallowed: false };
  };

  /** A Lookup whose only Specs are these known-path hits, in order. */
  function setupHits(hits: KnownPathHit[]) {
    const guru: ApiCandidate = {
      key: "novvy.test",
      apiId: API_ID,
      name: "Novvy API",
      vendor: { id: "novvy.test", name: "Novvy", domain: "novvy.test" },
      preferredVersion: "3.19.2",
      mirrorUrl: "http://apis-guru.test/novvy.test/openapi.json",
      originUrls: [],
      possiblyOfficialUrls: [],
      updated: "2024-01-01T00:00:00.000Z",
    };
    return createLookup({
      db: openDb(join(dir, "index.db")),
      judge: new FakeJudge({
        whichApi: {
          novvy: {
            probabilities: { [API_ID]: 0.95, none: 0.05 },
            confidence: 0.95,
          },
        },
        defaults: { specDescribesApi: yes },
      }),
      apisGuru: {
        findCandidates: async () => [guru],
        findVendorApis: async () => [guru],
      },
      webSearch: null,
      fetcher: createFetcher({
        allowPrivate: true,
        lookup: fixtureLookup,
        minIntervalMs: 0,
      }),
      now: () => new Date(NOW),
      probe: async () => hits,
      crawl: fakeCrawl().crawl,
    });
  }

  const currentUrl = (outcome: Outcome) =>
    outcome.outcome === "Resolved" ? outcome.sources[0]?.url : outcome.outcome;

  it.each([
    ["the deprecated Spec first", [API_JSON, OPENAPI]],
    ["the deprecated Spec last", [OPENAPI, API_JSON]],
  ])(
    "does not answer a Spec its Vendor marks deprecated as Current (%s)",
    async (_, order) => {
      const title = (url: string) =>
        url === API_JSON ? DEPRECATED : "Novvy API";
      const lookup = setupHits(
        order.map((url) => hit(url, { title: title(url) })),
      );

      expect(currentUrl(await ask(lookup, "novvy"))).toBe(OPENAPI);
    },
  );

  it("answers a deprecated Spec when it is the only one", async () => {
    const lookup = setupHits([hit(API_JSON, { title: DEPRECATED })]);

    expect(currentUrl(await ask(lookup, "novvy"))).toBe(API_JSON);
  });

  it("does not count a mention of deprecated past the start of the description", async () => {
    const description =
      "The Novvy API sends notifications across every channel your product uses; some endpoints are deprecated.";
    expect(description.indexOf("deprecated")).toBeGreaterThan(80);
    const lookup = setupHits([
      hit(OPENAPI, { title: "Novvy API", description }),
      hit(API_JSON, { title: "Novvy API" }),
    ]);

    expect(currentUrl(await ask(lookup, "novvy"))).toBe(OPENAPI);
  });
});

describe("provenanceOf", () => {
  const stripe = { id: "stripe.com", name: "stripe.com", domain: "stripe.com" };

  it("is Official on the Vendor's registrable domain or GitHub org, linked or not", () => {
    for (const linked of [false, true]) {
      expect(
        provenanceOf("https://files.stripe.com/openapi.json", stripe, linked),
      ).toBe("Official");
      expect(
        provenanceOf(
          "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml",
          stripe,
          linked,
        ),
      ).toBe("Official");
      expect(
        provenanceOf("https://github.com/Stripe/openapi", stripe, linked),
      ).toBe("Official");
      expect(
        provenanceOf("https://stripe.github.io/spec.json", stripe, linked),
      ).toBe("Official");
    }
  });

  it("is Endorsed elsewhere when linked from the Vendor's page", () => {
    expect(
      provenanceOf("https://docs.stripe-cdn.test/openapi.json", stripe, true),
    ).toBe("Endorsed");
  });

  it("is Mirror anywhere else", () => {
    expect(
      provenanceOf(
        "https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/stripe.yaml",
        stripe,
        false,
      ),
    ).toBe("Mirror");
    expect(
      provenanceOf("https://stripe.com.evil.test/openapi.json", stripe, false),
    ).toBe("Mirror");
  });
});
