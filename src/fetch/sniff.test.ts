import { describe, expect, it } from "vitest";
import { sniffSpec } from "./sniff";

const bytes = (text: string) => new TextEncoder().encode(text);

const OPENAPI_31_YAML = `openapi: 3.1.0
info:
  title: Petstore
  description: "${"A pet store. ".repeat(60)}"
  version: 1.0.0
servers:
  - url: https://{region}.petstore.example.com/v1
    variables:
      region:
        default: eu
  - url: /relative
tags:
  - name: pets
paths:
  /pets:
    get:
      tags: [pets, store]
      summary: List pets
  /pets/{id}:
    get:
      summary: Get a pet
`;

const SWAGGER_20_JSON = JSON.stringify({
  swagger: "2.0",
  info: { title: "Legacy API", version: "1" },
  host: "legacy.example.com:8443",
  basePath: "/api",
  paths: { "/things": { get: { tags: ["things"] } } },
});

describe("sniffSpec", () => {
  it("recognises OpenAPI 3.1 YAML and extracts its fields", () => {
    const result = sniffSpec(bytes(OPENAPI_31_YAML), "application/yaml");

    expect(result).not.toBeNull();
    expect(result?.specVersion).toBe("3.1.0");
    expect(result?.format).toBe("yaml");
    expect(result?.extract).toMatchObject({
      title: "Petstore",
      serverHosts: ["eu.petstore.example.com"],
      tags: ["pets", "store"],
      samplePaths: ["/pets", "/pets/{id}"],
      pathCount: 2,
    });
    expect(result?.extract.description).toHaveLength(500);
  });

  it("recognises Swagger 2.0 JSON, even served as text/plain", () => {
    const result = sniffSpec(bytes(SWAGGER_20_JSON), "text/plain");

    expect(result).toEqual({
      specVersion: "2.0",
      format: "json",
      extract: {
        title: "Legacy API",
        description: null,
        serverHosts: ["legacy.example.com"],
        tags: ["things"],
        samplePaths: ["/things"],
        pathCount: 1,
      },
      versionInfo: { version: "1", preview: false },
      outline: { firstSegments: ["things"], tags: ["things"] },
    });
  });

  it("outlines every path's first segment and every tag, past the extract's sample", () => {
    const names = Array.from({ length: 25 }, (_, i) => `area_${i}`);
    const paths = Object.fromEntries(
      names.flatMap((n) => [
        [`/${n}/get`, { post: { tags: [n] } }],
        [`/${n}/list`, { post: {} }],
      ]),
    );
    const result = sniffSpec(
      bytes(
        JSON.stringify({ openapi: "3.0.3", info: { title: "Big" }, paths }),
      ),
      null,
    );

    expect(result?.extract.samplePaths).toHaveLength(20);
    expect(result?.extract.tags).toHaveLength(20);
    expect(result?.outline).toEqual({ firstSegments: names, tags: names });
  });

  it("reads info.version and info.x-preview for the API Version", () => {
    const doc = (info: object) =>
      bytes(JSON.stringify({ openapi: "3.0.0", info, paths: {} }));

    expect(
      sniffSpec(doc({ version: " 2026.0 ", "x-preview": true }), null)
        ?.versionInfo,
    ).toEqual({ version: "2026.0", preview: true });
    expect(sniffSpec(doc({ title: "No version" }), null)?.versionInfo).toEqual({
      version: null,
      preview: false,
    });
    expect(
      sniffSpec(bytes("openapi: 3.0.0\ninfo:\n  version: 2\npaths: {}\n"), null)
        ?.versionInfo.version,
    ).toBe("2");
  });

  it("returns null for an HTML page", () => {
    const html = "<!doctype html><html><body>openapi: 3.0.0</body></html>";
    expect(sniffSpec(bytes(html), "text/html")).toBeNull();
  });

  it("returns null for JSON that is not a Spec", () => {
    const json = JSON.stringify({ name: "not a spec", paths: {} });
    expect(sniffSpec(bytes(json), "application/json")).toBeNull();
    expect(
      sniffSpec(bytes(JSON.stringify({ openapi: "2.0", paths: {} })), null),
    ).toBeNull();
    expect(sniffSpec(bytes(JSON.stringify({ openapi: "3.0.3" })), null)).toBe(
      null,
    );
  });

  it("returns null for a truncated YAML file", () => {
    const truncated = OPENAPI_31_YAML.slice(
      0,
      OPENAPI_31_YAML.indexOf("A pet store.") + 20,
    );
    expect(sniffSpec(bytes(truncated), "application/yaml")).toBeNull();
  });
});
