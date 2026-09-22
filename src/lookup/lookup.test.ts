import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Outcome } from "~/domain/outcome";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "~/fetch/__fixtures__/server";
import { createFetcher } from "~/fetch/fetcher";
import { probeKnownPaths } from "~/fetch/known-paths";
import { sniffSpec } from "~/fetch/sniff";
import { openDb } from "~/index-store/db";
import { FakeJudge, type FakeJudgeScript } from "~/judge/fake";
import { JudgeError, yesNo } from "~/judge/judge";
import { createApisGuru } from "~/sources/apis-guru";
import type { CrawlHit, CrawlResult } from "~/sources/crawl";
import type { GitHubRepos, RepoInfo } from "~/sources/github";
import { FakeWebSearch } from "~/sources/web-search/fake";
import { SearchError, type WebSearch } from "~/sources/web-search/web-search";
import { apisGuruList } from "./__fixtures__/apis-guru";
import { createLookup, type LookupDeps, provenanceOf } from "./lookup";

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

function setup(
  script: FakeJudgeScript,
  webSearch: WebSearch | null = new FakeWebSearch(),
  github?: GitHubRepos,
  crawl = fakeCrawl(),
) {
  const judge = new FakeJudge(script);
  const fetcher = createFetcher({
    allowPrivate: true,
    lookup: fixtureLookup,
    minIntervalMs: 0,
  });
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
    crawl: crawl.crawl,
    ...(github ? { github } : {}),
  });
  return { judge, lookup, probed, crawls: crawl.starts };
}

/** Parses against the Outcome schema, so every answer is a valid Outcome. */
async function ask(lookup: ReturnType<typeof setup>["lookup"], name: string) {
  return Outcome.parse(await lookup({ name }));
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

  it("merges portal Candidates whose domains redirect to one Vendor", async () => {
    // neon-tech.test redirects to neon.test, as neon.tech does to neon.com.
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
      {
        url: `${server.origin("neon.test")}/docs/neon-api`,
        title: "Neon API | Neon Docs",
        snippet: "Manage Neon.",
      },
      {
        url: `${server.origin("docs.neon.test")}/other-page`,
        title: "Another Neon page",
        snippet: "",
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
    // Each origin fetched once.
    const roots = server.requests.filter((r) => r.path === "/");
    expect(roots.map((r) => r.host).sort()).toEqual([
      "neon.test",
      "neon.test",
      "www.neon-tech.test",
    ]);
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
    const { lookup, judge } = setup({}, search);

    expect(await ask(lookup, "payco billing")).toEqual({
      outcome: "Unknown",
      name: "payco billing",
    });
    expect(judge.calls.map((c) => c.judgment)).toEqual(["whichApi"]);
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
      `crawl: ${url}: its host's robots.txt disallowed it; ADR 0003 allowed the single fetch`,
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

  it("marks an off-host crawl hit a Mirror", async () => {
    const url = `${server.origin("docs.nospec-cdn.test")}/openapi.json`;
    const { lookup } = setup(
      script,
      undefined,
      undefined,
      fakeCrawl({ hits: [crawlHit(url, "NoSpec API", { offHost: true })] }),
    );

    const outcome = await ask(lookup, "nospec");

    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      sources: [{ url, provenance: "Mirror" }],
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

    // A Mirror until WTR-48 makes it Endorsed, and so Resolved.
    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      spec: { specVersion: "3.0.3" },
      sources: [{ url, provenance: "Mirror" }],
    });
    if (outcome.outcome !== "Unconfirmed") throw new Error("unreachable");
    expect(outcome.reasons.join("\n")).toMatch(
      /known paths on machines\.test \(from the crawl\)/,
    );
    // The Vendor's own domain was already probed; the rest are all tried
    // while nothing is settled.
    expect(probed).toEqual(["nospec.test", "machines.test", "later.test"]);
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

    const outcome = await ask(lookup, "ghco");

    expect(outcome).toMatchObject({
      outcome: "Unconfirmed",
      sources: [
        { url: `${server.origin(RAW)}${MASTER}`, provenance: "Mirror" },
      ],
    });
  });
});

describe("provenanceOf", () => {
  const stripe = { id: "stripe.com", name: "stripe.com", domain: "stripe.com" };

  it("is Official on the Vendor's registrable domain or GitHub org", () => {
    expect(provenanceOf("https://files.stripe.com/openapi.json", stripe)).toBe(
      "Official",
    );
    expect(
      provenanceOf(
        "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.yaml",
        stripe,
      ),
    ).toBe("Official");
    expect(provenanceOf("https://github.com/Stripe/openapi", stripe)).toBe(
      "Official",
    );
    expect(provenanceOf("https://stripe.github.io/spec.json", stripe)).toBe(
      "Official",
    );
  });

  it("is Mirror anywhere else", () => {
    expect(
      provenanceOf(
        "https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/stripe.yaml",
        stripe,
      ),
    ).toBe("Mirror");
    expect(
      provenanceOf("https://stripe.com.evil.test/openapi.json", stripe),
    ).toBe("Mirror");
  });
});
