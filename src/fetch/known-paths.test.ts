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

describe("probeKnownPaths", () => {
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
      {
        scheme: "http",
      },
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
      { scheme: "http", budgetMs: 300 },
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
      { scheme: "http", budgetMs: 300 },
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
      { scheme: "http" },
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
      { scheme: "http" },
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

    await probeKnownPaths("vendor.test", deadFetcher);

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
      { scheme: "http" },
    );

    expect(hits.map((h) => h.url)).toEqual([
      `${server.origin("api.vendor.test")}/openapi.json`,
    ]);
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
