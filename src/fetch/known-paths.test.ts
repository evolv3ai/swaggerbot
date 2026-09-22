import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "./__fixtures__/server";
import { createFetcher } from "./fetcher";
import { apisJsonSpecUrls, probeKnownPaths } from "./known-paths";

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

  it("drops hosts that don't finish within the budget", async () => {
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
      createFetcher({
        allowPrivate: true,
        lookup: fixtureLookup,
        minIntervalMs: 0,
        timeoutMs: 5_000,
      }),
      { scheme: "http", budgetMs: 300 },
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hits.map((h) => h.sniff.extract.title)).toEqual(["Fast"]);
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
