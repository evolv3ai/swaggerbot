import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "./__fixtures__/server";
import { createFetcher, FetchError, type Fetcher } from "./fetcher";
import {
  apisJsonSpecUrls,
  KNOWN_HOST_PREFIXES,
  KNOWN_PATHS,
  probeKnownPaths,
} from "./known-paths";

let server: FixtureServer;

beforeEach(async () => {
  server = await startFixtureServer();
});

afterEach(async () => {
  await server.close();
});

const fetcher = () =>
  createFetcher({
    allowPrivate: true,
    lookup: fixtureLookup,
    minIntervalMs: 0,
  });

const slowFetcher = () =>
  createFetcher({
    allowPrivate: true,
    lookup: fixtureLookup,
    minIntervalMs: 0,
    timeoutMs: 5_000,
  });

const spec = (title: string) =>
  JSON.stringify({
    openapi: "3.0.3",
    info: { title, version: "1" },
    paths: {},
  });

// The existing cases hold both with the default grace and with none.
const graces = [
  { name: "the default grace", opts: {} },
  { name: "graceAfterHitMs: Infinity", opts: { graceAfterHitMs: Infinity } },
];

describe.each(graces)("probeKnownPaths with $name", ({ opts: g }) => {
  it("finds /v3/api-docs and an apis.json-listed Spec, and ignores an HTML 200", async () => {
    server.send(
      "vendor.test",
      "/openapi.json",
      "<!doctype html><title>Welcome</title>",
      "text/html",
    );
    server.send(
      "api.vendor.test",
      "/v3/api-docs",
      spec("Main"),
      "application/json",
    );
    server.send(
      "developer.vendor.test",
      "/apis.json",
      JSON.stringify({
        name: "Vendor",
        apis: [
          {
            name: "Billing",
            properties: [
              { type: "Swagger", url: "/specs/billing.yaml" },
              { type: "X-Human", url: "/docs" },
            ],
          },
        ],
      }),
      "application/json",
    );
    server.send(
      "developer.vendor.test",
      "/specs/billing.yaml",
      "swagger: '2.0'\ninfo:\n  title: Billing\n  version: '1'\npaths: {}\n",
      "application/yaml",
    );

    const hits = await probeKnownPaths(
      `vendor.test:${server.port}`,
      fetcher(),
      { ...g, scheme: "http" },
    );

    expect(
      hits.map((h) => ({ url: h.url, title: h.sniff.extract.title })),
    ).toEqual([
      { url: `${server.origin("api.vendor.test")}/v3/api-docs`, title: "Main" },
      {
        url: `${server.origin("developer.vendor.test")}/specs/billing.yaml`,
        title: "Billing",
      },
    ]);
    expect(hits[0]?.bytes.length).toBeGreaterThan(0);
    expect(server.requests).not.toContainEqual(
      expect.objectContaining({ path: "/docs" }),
    );
  });

  it("stops hosts that don't finish within the budget", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("Fast"),
      "application/json",
    );
    server.route("docs.vendor.test", "/openapi.json", () => {
      // Never respond.
    });
    server.send(
      "docs.vendor.test",
      "/swagger.json",
      spec("Late"),
      "application/json",
    );

    const started = Date.now();
    const hits = await probeKnownPaths(
      `vendor.test:${server.port}`,
      slowFetcher(),
      { ...g, scheme: "http", budgetMs: 300 },
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hits.map((h) => h.sniff.extract.title)).toEqual(["Fast"]);
  });

  it("keeps what a host found before the budget stopped it", async () => {
    server.send(
      "vendor.test",
      "/openapi.json",
      spec("Early"),
      "application/json",
    );
    server.route("vendor.test", "/openapi.yaml", () => {
      // Never respond.
    });

    const hits = await probeKnownPaths(
      `vendor.test:${server.port}`,
      slowFetcher(),
      { ...g, scheme: "http", budgetMs: 300 },
    );

    expect(hits.map((h) => h.url)).toEqual([
      `${server.origin("vendor.test")}/openapi.json`,
    ]);
  });

  it("tries the app., api-docs. and spec. hosts", async () => {
    for (const host of ["app", "api-docs", "spec"]) {
      server.send(
        `${host}.vendor.test`,
        "/openapi.json",
        spec(host),
        "application/json",
      );
    }

    const hits = await probeKnownPaths(
      `vendor.test:${server.port}`,
      fetcher(),
      { ...g, scheme: "http" },
    );

    expect(hits.map((h) => h.sniff.extract.title)).toEqual([
      "app",
      "api-docs",
      "spec",
    ]);
    const hosts = new Set(server.requests.map((r) => r.host));
    for (const prefix of KNOWN_HOST_PREFIXES) {
      expect(hosts).toContain(`${prefix}vendor.test`);
    }
  });

  it.each([
    "/openapi.yml",
    "/api-json",
    "/v1-json",
    "/swagger/v1/swagger.json",
    "/api/openapi.json",
    "/docs/openapi.json",
    "/spec/openapi3.json",
  ])("finds a Spec at %s", async (path) => {
    server.send("api.vendor.test", path, spec("New"), "application/json");

    const hits = await probeKnownPaths(
      `vendor.test:${server.port}`,
      fetcher(),
      { ...g, scheme: "http" },
    );

    expect(hits.map((h) => h.url)).toEqual([
      `${server.origin("api.vendor.test")}${path}`,
    ]);
  });

  it("stops probing a host that can't be reached", async () => {
    // A fake fetcher: robots.txt failing on the network would otherwise
    // short-circuit the host inside the fetcher before the probe sees it.
    const asked: string[] = [];
    const deadFetcher: Fetcher = {
      async fetchUrl(url) {
        asked.push(url);
        const kind = new URL(url).hostname.startsWith("docs.")
          ? "network"
          : "http-error";
        throw new FetchError(kind, url, "fake", { status: 404 });
      },
    };

    await probeKnownPaths("vendor.test", deadFetcher, g);

    expect(asked.filter((u) => u.startsWith("https://docs."))).toEqual([
      "https://docs.vendor.test/openapi.json",
    ]);
    expect(
      asked.filter((u) => u.startsWith("https://api.vendor.test/")),
    ).toHaveLength(KNOWN_PATHS.length);
  });

  it("returns a Spec reached from two hosts once", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("Shared"),
      "application/json",
    );
    server.route("developers.vendor.test", "/openapi.json", (_req, res) => {
      res
        .writeHead(302, {
          location: `${server.origin("api.vendor.test")}/openapi.json`,
        })
        .end();
    });

    const hits = await probeKnownPaths(
      `vendor.test:${server.port}`,
      fetcher(),
      { ...g, scheme: "http" },
    );

    expect(hits.map((h) => h.url)).toEqual([
      `${server.origin("api.vendor.test")}/openapi.json`,
    ]);
  });
});

describe.each(graces)(
  "probeKnownPaths on a host whose robots.txt disallows it (ADR 0003), with $name",
  ({ opts: g }) => {
    const disallowAll = (host: string) =>
      server.send(host, "/robots.txt", "User-agent: *\nDisallow: /\n", "");

    it("fetches the Spec once on a host that disallows everything", async () => {
      // api.val.town's shape: `Disallow: /` for the whole app host.
      disallowAll("api.vendor.test");
      server.send(
        "api.vendor.test",
        "/openapi.json",
        spec("Shut"),
        "application/json",
      );

      const hits = await probeKnownPaths(
        `vendor.test:${server.port}`,
        fetcher(),
        { ...g, scheme: "http", allowBlanketRobots: true },
      );

      expect(
        hits.map((h) => ({ url: h.url, robotsDisallowed: h.robotsDisallowed })),
      ).toEqual([
        {
          url: `${server.origin("api.vendor.test")}/openapi.json`,
          robotsDisallowed: true,
        },
      ]);
    });

    it("yields nothing from such a host by default", async () => {
      disallowAll("api.vendor.test");
      server.send(
        "api.vendor.test",
        "/openapi.json",
        spec("Shut"),
        "application/json",
      );

      const hits = await probeKnownPaths(
        `vendor.test:${server.port}`,
        fetcher(),
        { ...g, scheme: "http" },
      );

      expect(hits).toEqual([]);
      expect(
        server.requests.filter(
          (r) => r.host === "api.vendor.test" && r.path !== "/robots.txt",
        ),
      ).toEqual([]);
    });

    it("honours Codeberg's list of disallowed paths even with allowBlanketRobots", async () => {
      // codeberg.org disallows /swagger.*.json and allows the site root;
      // ADR 0003 keeps Codeberg as NoSpec.
      server.send(
        "vendor.test",
        "/robots.txt",
        "User-agent: *\nDisallow: /swagger.*.json\n",
        "",
      );
      server.send(
        "vendor.test",
        "/swagger.v1.json",
        spec("Codeberg"),
        "application/json",
      );
      server.send(
        "vendor.test",
        "/apis.json",
        JSON.stringify({
          apis: [
            { properties: [{ type: "Swagger", url: "/swagger.v1.json" }] },
          ],
        }),
        "application/json",
      );

      const hits = await probeKnownPaths(
        `vendor.test:${server.port}`,
        fetcher(),
        { ...g, scheme: "http", allowBlanketRobots: true },
      );

      expect(hits).toEqual([]);
      expect(server.requests).not.toContainEqual(
        expect.objectContaining({ path: "/swagger.v1.json" }),
      );
    });

    it("retries a path at most once, and never on a dead host", async () => {
      const asked: { url: string; ignoreRobots: boolean }[] = [];
      const shutFetcher: Fetcher = {
        async fetchUrl(url, opts) {
          asked.push({ url, ignoreRobots: opts?.ignoreRobots ?? false });
          if (new URL(url).hostname.startsWith("docs.")) {
            throw new FetchError("network", url, "fake");
          }
          if (!opts?.ignoreRobots) {
            throw new FetchError("robots-disallowed", url, "fake", {
              blanket: true,
            });
          }
          throw new FetchError("http-error", url, "fake", { status: 404 });
        },
      };

      await probeKnownPaths("vendor.test", shutFetcher, {
        ...g,
        allowBlanketRobots: true,
      });

      const onApi = asked.filter((a) =>
        a.url.startsWith("https://api.vendor."),
      );
      expect(onApi).toHaveLength(KNOWN_PATHS.length * 2);
      for (const path of KNOWN_PATHS) {
        expect(
          onApi.filter((a) => a.url === `https://api.vendor.test${path}`),
        ).toEqual([
          { url: `https://api.vendor.test${path}`, ignoreRobots: false },
          { url: `https://api.vendor.test${path}`, ignoreRobots: true },
        ]);
      }
      expect(asked.filter((a) => a.url.startsWith("https://docs."))).toEqual([
        { url: "https://docs.vendor.test/openapi.json", ignoreRobots: false },
      ]);
    });
  },
);

describe("probeKnownPaths after its first hit", () => {
  const hang = (host: string) =>
    server.route(host, "/openapi.json", () => {
      // Never respond.
    });
  const sendAfter = (host: string, ms: number, title: string) =>
    server.route(host, "/openapi.json", (_req, res) => {
      setTimeout(() => {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(spec(title));
      }, ms);
    });
  const probe = (opts: { budgetMs: number; graceAfterHitMs?: number }) =>
    probeKnownPaths(`vendor.test:${server.port}`, slowFetcher(), {
      scheme: "http",
      ...opts,
    });

  it("stops within the grace, not the budget, while another host hangs", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("First"),
      "application/json",
    );
    hang("docs.vendor.test");

    const started = Date.now();
    const hits = await probe({ budgetMs: 5_000, graceAfterHitMs: 200 });

    expect(Date.now() - started).toBeLessThan(1_500);
    expect(hits.map((h) => h.sniff.extract.title)).toEqual(["First"]);
  });

  it("keeps a Spec another host serves inside the grace", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("First"),
      "application/json",
    );
    sendAfter("developer.vendor.test", 50, "Second");
    hang("docs.vendor.test");

    const hits = await probe({ budgetMs: 5_000, graceAfterHitMs: 400 });

    expect(hits.map((h) => h.sniff.extract.title).sort()).toEqual([
      "First",
      "Second",
    ]);
  });

  it("drops a Spec another host would only serve after the grace", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("First"),
      "application/json",
    );
    sendAfter("developer.vendor.test", 800, "Late");
    hang("docs.vendor.test");

    const started = Date.now();
    const hits = await probe({ budgetMs: 5_000, graceAfterHitMs: 200 });

    expect(Date.now() - started).toBeLessThan(700);
    expect(hits.map((h) => h.sniff.extract.title)).toEqual(["First"]);
  });

  it("keeps that late Spec with graceAfterHitMs: Infinity", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("First"),
      "application/json",
    );
    sendAfter("developer.vendor.test", 300, "Late");
    hang("docs.vendor.test");

    const started = Date.now();
    const hits = await probe({ budgetMs: 1_000, graceAfterHitMs: Infinity });

    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(hits.map((h) => h.sniff.extract.title).sort()).toEqual([
      "First",
      "Late",
    ]);
  });

  it("stops at the first hit with graceAfterHitMs: 0", async () => {
    server.send(
      "api.vendor.test",
      "/openapi.json",
      spec("First"),
      "application/json",
    );
    sendAfter("developer.vendor.test", 100, "Second");
    hang("docs.vendor.test");

    const started = Date.now();
    const hits = await probe({ budgetMs: 5_000, graceAfterHitMs: 0 });

    expect(Date.now() - started).toBeLessThan(500);
    expect(hits.map((h) => h.sniff.extract.title)).toEqual(["First"]);
  });

  it("runs to the budget when nothing is found", async () => {
    hang("docs.vendor.test");

    const started = Date.now();
    const hits = await probe({ budgetMs: 600, graceAfterHitMs: 100 });

    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
    expect(hits).toEqual([]);
  });

  it("finishes early when nothing is found and every host is done", async () => {
    const started = Date.now();
    const hits = await probe({ budgetMs: 5_000, graceAfterHitMs: 100 });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hits).toEqual([]);
  });
});

describe("apisJsonSpecUrls", () => {
  it("resolves OpenAPI and Swagger property URLs against the document", () => {
    const doc = JSON.stringify({
      apis: [
        {
          properties: [
            { type: "OpenAPI", url: "https://cdn.example.com/a.json" },
            { type: "x-openapi-spec", url: "b.yaml" },
            { type: "Documentation", url: "/docs" },
          ],
        },
      ],
    });

    expect(
      apisJsonSpecUrls(
        new TextEncoder().encode(doc),
        "https://example.com/apis.json",
      ),
    ).toEqual(["https://cdn.example.com/a.json", "https://example.com/b.yaml"]);
    expect(
      apisJsonSpecUrls(new TextEncoder().encode("<html>"), "https://x.test/"),
    ).toEqual([]);
  });
});

describe("probeKnownPaths beside the crawl", () => {
  it("makes every request in the background, to yield to the crawl's", async () => {
    server.send("vendor.test", "/apis.json", "{}", "application/json");
    const inner = fetcher();
    const background: (boolean | undefined)[] = [];
    const spy: Fetcher = {
      fetchUrl(url, opts) {
        background.push(opts?.background);
        return inner.fetchUrl(url, opts);
      },
    };

    await probeKnownPaths(`vendor.test:${server.port}`, spy, {
      scheme: "http",
    });

    expect(background.length).toBeGreaterThan(0);
    expect(new Set(background)).toEqual(new Set([true]));
  });
});
