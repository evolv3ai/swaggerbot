import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SpecOutline, ValidityIssue } from "~/domain/spec-forms";
import { buildSpecForms, SpecFormsError, type SpecFormsInput } from "./build";

const FIXTURES = join(import.meta.dirname, "__fixtures__");
const SOURCE = "https://api.example.com/specs/openapi.json";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function build(name: string, extra: Partial<SpecFormsInput> = {}) {
  return buildSpecForms({
    bytes: fixture(name),
    format: name.endsWith(".yaml") ? "yaml" : "json",
    sourceUrl: SOURCE,
    ...extra,
  });
}

function parsed(normalized: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(normalized));
}

/** The value at `keys` under `node`, or `undefined`. */
function at(node: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (value, key) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined,
    node,
  );
}

async function expectFormsError(
  promise: Promise<unknown>,
  kind: SpecFormsError["kind"],
) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SpecFormsError);
  expect((error as SpecFormsError).kind).toBe(kind);
}

describe("buildSpecForms", () => {
  it("converts Swagger 2 to OpenAPI 3.1 without the leftovers", async () => {
    const forms = await build("swagger2.json");
    const doc = parsed(forms.normalized);

    expect(forms.normalizedSpecVersion).toMatch(/^3\.1\./);
    expect(at(doc, "openapi")).toBe(forms.normalizedSpecVersion);
    expect(at(doc, "components", "schemas", "Pet")).toBeDefined();
    expect(at(doc, "components", "securitySchemes", "api_key")).toMatchObject({
      type: "apiKey",
      in: "header",
    });
    expect(at(doc, "paths", "/pets", "post", "requestBody")).toBeDefined();
    for (const method of ["get", "post"]) {
      const op = at(doc, "paths", "/pets", method);
      expect(op).not.toHaveProperty("schemes");
      expect(op).not.toHaveProperty("consumes");
      expect(op).not.toHaveProperty("produces");
    }
    for (const key of ["swagger", "host", "basePath", "definitions"])
      expect(doc).not.toHaveProperty(key);
    expect(forms.normalizedFindingCount).toBe(0);
    expect(forms.validityIssues).toEqual([]);
    expect(forms.validityFindingCount).toBe(0);
  });

  it("leaves no findings on the Normalized Form of a valid Spec", async () => {
    const fetchRef = async () => fixture("widget.json");
    for (const name of [
      "swagger2.json",
      "openapi30.yaml",
      "openapi31-same-origin.json",
    ]) {
      const forms = await build(name, { fetchRef });
      expect(forms.validityIssues, name).toEqual([]);
      expect(forms.normalizedFindingCount, name).toBe(0);
    }
  });

  it("leaves the input bytes unchanged", async () => {
    for (const name of [
      "swagger2.json",
      "openapi30.yaml",
      "openapi31-same-origin.json",
    ]) {
      const bytes = fixture(name);
      const before = Uint8Array.from(bytes);
      await build(name, {
        bytes,
        fetchRef: async () => fixture("widget.json"),
      });
      expect(bytes, name).toEqual(before);
    }
  });

  it("bundles a same-origin $ref through fetchRef", async () => {
    const fetchRef = vi.fn(async (_url: string) => fixture("widget.json"));
    const forms = await build("openapi31-same-origin.json", { fetchRef });

    expect(fetchRef).toHaveBeenCalledTimes(1);
    expect(fetchRef).toHaveBeenCalledWith(
      "https://api.example.com/specs/schemas/widget.json",
    );
    const doc = parsed(forms.normalized);
    const ref = String(
      at(
        doc,
        ...["paths", "/widgets", "get", "responses", "200", "content"],
        ...["application/json", "schema", "$ref"],
      ),
    );
    expect(ref).toMatch(/^#\//);
    const target = at(doc, ...ref.slice(2).split("/"));
    expect(target).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
    expect(forms.validityIssues).toEqual([]);
  });

  it("reports an other-origin $ref as unresolved without fetching it", async () => {
    const fetchRef = vi.fn(async (_url: string) => fixture("widget.json"));
    const forms = await build("openapi31-other-origin.json", { fetchRef });

    expect(fetchRef).not.toHaveBeenCalled();
    expect(forms.validityIssues).toEqual([
      {
        message:
          "Unresolved external reference: https://schemas.other.example/gadget.json",
        path: "/paths/~1gadgets/get/responses/200/content/application~1json/schema",
        count: 1,
      },
    ]);
    expect(forms.validityFindingCount).toBe(1);
  });

  it("fetches nothing without fetchRef, and reports the reference", async () => {
    const forms = await build("openapi31-same-origin.json");
    expect(forms.validityIssues).toEqual([
      expect.objectContaining({
        message:
          "Unresolved external reference: https://api.example.com/specs/schemas/widget.json",
        count: 1,
      }),
    ]);
  });

  it("reports a failed fetch as an unresolved reference", async () => {
    const forms = await build("openapi31-same-origin.json", {
      fetchRef: async () => {
        throw new Error("404");
      },
    });
    expect(forms.validityIssues.map((i) => i.message)).toEqual([
      "Unresolved external reference: https://api.example.com/specs/schemas/widget.json",
    ]);
  });

  it("groups a known finding by message with its count", async () => {
    const forms = await build("openapi31-finding.json");
    expect(forms.validityIssues).toEqual([
      {
        message: "Property allowReserved is not expected to be here",
        path: "/paths/~1a/get/responses/200",
        count: 2,
      },
    ]);
    expect(forms.validityFindingCount).toBe(2);
    expect(() =>
      ValidityIssue.array().parse(forms.validityIssues),
    ).not.toThrow();
  });

  it("doesn't report a schema property named $ref", async () => {
    // Kubernetes' `JSONSchemaProps` has one; Scalar's resolver takes it for a
    // reference and reports "Can't resolve reference: [object Object]".
    const spec = {
      swagger: "2.0",
      info: { title: "Props", version: "1" },
      paths: {},
      definitions: {
        Props: {
          type: "object",
          properties: { $ref: { type: "string" }, name: { type: "string" } },
        },
      },
    };
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(JSON.stringify(spec)),
      format: "json",
      sourceUrl: SOURCE,
    });
    expect(forms.validityIssues).toEqual([]);
    expect(forms.normalizedFindingCount).toBe(0);
  });

  it("keeps allowReserved only on query parameters", async () => {
    // Cloudflare's Spec has it on a `path` parameter: 3.0 ignores it there,
    // 3.1's schema rejects it.
    const spec = {
      openapi: "3.0.3",
      info: { title: "Objects", version: "1" },
      paths: {
        "/objects/{key}": {
          parameters: [
            {
              name: "prefix",
              in: "query",
              allowReserved: true,
              schema: { type: "string" },
            },
          ],
          get: {
            parameters: [
              {
                name: "key",
                in: "path",
                required: true,
                allowReserved: true,
                schema: { type: "string" },
              },
              { $ref: "#/components/parameters/Trace" },
            ],
            responses: { "200": { description: "The object" } },
          },
        },
      },
      components: {
        parameters: {
          Trace: {
            name: "X-Trace",
            in: "header",
            allowReserved: true,
            schema: { type: "string" },
          },
        },
      },
    };
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(JSON.stringify(spec)),
      format: "json",
      sourceUrl: SOURCE,
    });
    const doc = parsed(forms.normalized);

    expect(
      at(doc, "paths", "/objects/{key}", "get", "parameters", "0"),
    ).not.toHaveProperty("allowReserved");
    expect(at(doc, "components", "parameters", "Trace")).not.toHaveProperty(
      "allowReserved",
    );
    expect(
      at(doc, "paths", "/objects/{key}", "parameters", "0", "allowReserved"),
    ).toBe(true);
    expect(forms.normalizedFindingCount).toBe(0);
    expect(forms.validityIssues).toEqual([]);
  });

  it("inlines an operation written as a $ref to a same-origin file", async () => {
    // DigitalOcean's Spec writes every operation this way; OpenAPI allows a
    // `$ref` for a Path Item, not for an Operation.
    const spec = [
      "openapi: 3.0.0",
      "info: { title: Clicks, version: '2.0' }",
      "paths:",
      "  /v2/1-clicks:",
      "    get:",
      "      $ref: resources/1-clicks/oneClicks_list.yml",
      "      security: [{ bearer_auth: [read] }]",
      "components:",
      "  securitySchemes:",
      "    bearer_auth: { type: http, scheme: bearer }",
    ].join("\n");
    const operation = [
      "operationId: oneClicks_list",
      "summary: List 1-Click Applications",
      "tags: [1-Click Applications]",
      "security: [{ bearer_auth: [] }]",
      "responses:",
      "  '200':",
      "    description: The 1-Click Applications",
      "    content:",
      "      application/json:",
      "        schema: { type: string, nullable: true }",
    ].join("\n");
    const fetchRef = vi.fn(async (_url: string) =>
      new TextEncoder().encode(operation),
    );
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(spec),
      format: "yaml",
      sourceUrl: SOURCE,
      fetchRef,
    });

    expect(fetchRef).toHaveBeenCalledWith(
      "https://api.example.com/specs/resources/1-clicks/oneClicks_list.yml",
    );
    const op = at(parsed(forms.normalized), "paths", "/v2/1-clicks", "get");
    expect(op).not.toHaveProperty("$ref");
    expect(op).toMatchObject({
      operationId: "oneClicks_list",
      responses: { "200": { description: "The 1-Click Applications" } },
      // The key written beside the `$ref` overrides the target's.
      security: [{ bearer_auth: ["read"] }],
    });
    expect(forms.normalizedFindingCount).toBe(0);
    expect(forms.outline.operations).toEqual([
      {
        method: "get",
        path: "/v2/1-clicks",
        operationId: "oneClicks_list",
        summary: "List 1-Click Applications",
        tags: ["1-Click Applications"],
      },
    ]);
    expect(forms.validityIssues).not.toEqual([]);
  });

  it("inlines an operation written as an internal $ref", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Ops", version: "1" },
      paths: {
        "/a": { get: { $ref: "#/x-ops/getA" } },
        "/b": { $ref: "#/x-paths/b" },
      },
      "x-paths": { b: { post: { $ref: "#/x-ops/postB" } } },
      "x-ops": {
        getA: {
          operationId: "getA",
          summary: "Get A",
          tags: ["a"],
          responses: { "200": { description: "A" } },
        },
        // A chain of references.
        postB: { $ref: "#/x-ops/postBTarget" },
        postBTarget: {
          operationId: "postB",
          tags: ["b"],
          responses: { "201": { description: "B" } },
        },
      },
    };
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(JSON.stringify(spec)),
      format: "json",
      sourceUrl: SOURCE,
    });
    const doc = parsed(forms.normalized);

    expect(at(doc, "paths", "/a", "get")).toEqual(spec["x-ops"].getA);
    expect(at(doc, "x-paths", "b", "post")).toEqual(spec["x-ops"].postBTarget);
    // The target stays in place.
    expect(at(doc, "x-ops", "getA")).toEqual(spec["x-ops"].getA);
    expect(forms.normalizedFindingCount).toBe(0);
    expect(forms.outline.operations).toEqual([
      {
        method: "get",
        path: "/a",
        operationId: "getA",
        summary: "Get A",
        tags: ["a"],
      },
      { method: "post", path: "/b", operationId: "postB", tags: ["b"] },
    ]);
    // As published, an operation that is a `$ref` is invalid.
    expect(forms.validityIssues).not.toEqual([]);
  });

  it("leaves a cycle of operation references as a $ref", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Cycle", version: "1" },
      paths: {
        "/a": { get: { $ref: "#/x-ops/a" } },
        "/b": { get: { $ref: "#/x-ops/missing" } },
      },
      "x-ops": { a: { $ref: "#/x-ops/b" }, b: { $ref: "#/x-ops/a" } },
    };
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(JSON.stringify(spec)),
      format: "json",
      sourceUrl: SOURCE,
    });
    const doc = parsed(forms.normalized);
    expect(at(doc, "paths", "/a", "get")).toEqual({ $ref: "#/x-ops/a" });
    expect(at(doc, "paths", "/b", "get")).toEqual({ $ref: "#/x-ops/missing" });
  });

  it("inlines a response's headers written as a $ref to a same-origin file", async () => {
    // DigitalOcean's Spec writes a response's `headers` this way; OpenAPI
    // allows a `$ref` for each header, not for the map.
    const spec = [
      "openapi: 3.0.0",
      "info: { title: Droplets, version: '2.0' }",
      "paths:",
      "  /v2/droplets:",
      "    get:",
      "      responses:",
      "        '200':",
      "          description: The Droplets",
      "          headers:",
      "            $ref: shared/headers.yml",
      "components:",
      "  responses:",
      "    unauthorized:",
      "      description: Unauthorized",
      "      headers:",
      "        $ref: shared/headers.yml",
    ].join("\n");
    const headers = [
      "ratelimit-limit:",
      "  schema: { type: integer }",
      "ratelimit-remaining:",
      "  schema: { type: integer }",
    ].join("\n");
    const fetchRef = vi.fn(async (_url: string) =>
      new TextEncoder().encode(headers),
    );
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(spec),
      format: "yaml",
      sourceUrl: SOURCE,
      fetchRef,
    });

    expect(fetchRef).toHaveBeenCalledWith(
      "https://api.example.com/specs/shared/headers.yml",
    );
    const doc = parsed(forms.normalized);
    const expected = {
      "ratelimit-limit": { schema: { type: "integer" } },
      "ratelimit-remaining": { schema: { type: "integer" } },
    };
    expect(
      at(doc, "paths", "/v2/droplets", "get", "responses", "200", "headers"),
    ).toEqual(expected);
    expect(
      at(doc, "components", "responses", "unauthorized", "headers"),
    ).toEqual(expected);
    expect(forms.normalizedFindingCount).toBe(0);
    // As published, `headers` written as a `$ref` is invalid.
    expect(forms.validityIssues).not.toEqual([]);
  });

  it("inlines responses, content and properties written as an internal $ref", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Maps", version: "1" },
      paths: {
        "/a": {
          get: { responses: { $ref: "#/x-maps/responses" } },
          post: {
            requestBody: { content: { $ref: "#/x-maps/content" } },
            responses: { "204": { description: "Created" } },
          },
        },
      },
      components: {
        responses: {
          Ok: { description: "OK", content: { $ref: "#/x-maps/content" } },
        },
        schemas: {
          Widget: {
            type: "object",
            properties: { $ref: "#/x-maps/properties" },
          },
          List: {
            type: "array",
            // Nested, and a chain of references with a key written beside it.
            items: {
              type: "object",
              properties: {
                $ref: "#/x-maps/chain",
                extra: { type: "boolean" },
              },
            },
          },
        },
      },
      "x-maps": {
        responses: {
          "200": {
            description: "A",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { $ref: "#/x-maps/properties" },
                },
              },
            },
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Widget" },
          },
        },
        chain: { $ref: "#/x-maps/properties" },
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
    };
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(JSON.stringify(spec)),
      format: "json",
      sourceUrl: SOURCE,
    });
    const doc = parsed(forms.normalized);
    const properties = spec["x-maps"].properties;

    expect(at(doc, "paths", "/a", "get", "responses")).toEqual({
      "200": {
        description: "A",
        content: {
          "application/json": { schema: { type: "object", properties } },
        },
      },
    });
    expect(at(doc, "paths", "/a", "post", "requestBody", "content")).toEqual(
      spec["x-maps"].content,
    );
    expect(at(doc, "components", "responses", "Ok", "content")).toEqual(
      spec["x-maps"].content,
    );
    expect(at(doc, "components", "schemas", "Widget", "properties")).toEqual(
      properties,
    );
    expect(
      at(doc, "components", "schemas", "List", "items", "properties"),
    ).toEqual({ ...properties, extra: { type: "boolean" } });
    // The target stays in place.
    expect(at(doc, "x-maps")).toEqual(spec["x-maps"]);
    expect(forms.normalizedFindingCount).toBe(0);
    expect(forms.validityIssues).not.toEqual([]);
  });

  it("leaves a cycle of map references as a $ref", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Cycle", version: "1" },
      paths: {},
      components: {
        schemas: {
          Loop: { type: "object", properties: { $ref: "#/x-maps/a" } },
          Missing: { type: "object", properties: { $ref: "#/x-maps/none" } },
          // A map whose copy would contain its own reference again.
          Tree: { type: "object", properties: { $ref: "#/x-maps/tree" } },
        },
      },
      "x-maps": {
        a: { $ref: "#/x-maps/b" },
        b: { $ref: "#/x-maps/a" },
        tree: {
          child: { type: "object", properties: { $ref: "#/x-maps/tree" } },
        },
      },
    };
    const forms = await buildSpecForms({
      bytes: new TextEncoder().encode(JSON.stringify(spec)),
      format: "json",
      sourceUrl: SOURCE,
    });
    const doc = parsed(forms.normalized);
    expect(at(doc, "components", "schemas", "Loop", "properties")).toEqual({
      $ref: "#/x-maps/a",
    });
    expect(at(doc, "components", "schemas", "Missing", "properties")).toEqual({
      $ref: "#/x-maps/none",
    });
    expect(at(doc, "components", "schemas", "Tree", "properties")).toEqual({
      child: { type: "object", properties: { $ref: "#/x-maps/tree" } },
    });
  });

  it("outlines the 3.0 Spec's tags, operations and security schemes", async () => {
    const { outline } = await build("openapi30.yaml");
    expect(SpecOutline.parse(outline)).toEqual(outline);
    expect(outline).toEqual({
      title: "Library",
      apiVersion: "2.0.0",
      servers: [
        "https://library.example.com/api",
        "https://staging.library.example.com/api",
      ],
      securitySchemes: [
        { name: "bearer", type: "http", scheme: "bearer" },
        { name: "key", type: "apiKey", in: "query" },
      ],
      tags: [
        { name: "books", operationCount: 2 },
        { name: "authors", operationCount: 1 },
        { name: "unused", operationCount: 0 },
        { name: "people", operationCount: 1 },
      ],
      operations: [
        {
          method: "get",
          path: "/books",
          operationId: "listBooks",
          summary: "List books",
          tags: ["books"],
        },
        {
          method: "post",
          path: "/books",
          operationId: "createBook",
          tags: ["books"],
          deprecated: true,
        },
        {
          method: "get",
          path: "/authors/{id}",
          operationId: "getAuthor",
          summary: "Get an author",
          tags: ["authors", "people"],
        },
        {
          method: "get",
          path: "/categories",
          summary: "List categories",
          tags: [],
        },
      ],
    });
  });

  it("keeps the circular schema of the 3.0 Spec as a $ref", async () => {
    const forms = await build("openapi30.yaml");
    const doc = parsed(forms.normalized);
    expect(
      at(doc, "components", "schemas", "Category", "properties", "parent"),
    ).toEqual({
      $ref: "#/components/schemas/Category",
    });
  });

  it("calls onStep after each step, in order", async () => {
    const steps: string[] = [];
    await build("openapi30.yaml", { onStep: (step) => void steps.push(step) });
    expect(steps).toEqual([
      "parse",
      "bundle",
      "validate",
      "upgrade",
      "strip",
      "validate-normalized",
      "outline",
      "serialize",
    ]);
  });

  it("throws SpecFormsError on unparseable bytes", async () => {
    const bytes = new TextEncoder().encode('{"openapi": "3.1.0",');
    await expectFormsError(
      buildSpecForms({ bytes, format: "json", sourceUrl: SOURCE }),
      "unparseable",
    );
    await expectFormsError(
      buildSpecForms({
        bytes: new TextEncoder().encode("a: [b\n  c: }"),
        format: "yaml",
        sourceUrl: SOURCE,
      }),
      "unparseable",
    );
  });

  it("throws SpecFormsError on a document that isn't OpenAPI", async () => {
    const bytes = new TextEncoder().encode('{"name": "not a spec"}');
    await expectFormsError(
      buildSpecForms({ bytes, format: "json", sourceUrl: SOURCE }),
      "not-openapi",
    );
  });

  it("refuses bytes over MAX_FORMS_BYTES", async () => {
    const bytes = fixture("swagger2.json");
    await expectFormsError(
      build("swagger2.json", {
        env: { MAX_FORMS_BYTES: String(bytes.byteLength - 1) },
      }),
      "too-large",
    );
    await expect(
      build("swagger2.json", {
        env: { MAX_FORMS_BYTES: String(bytes.byteLength) },
      }),
    ).resolves.toBeDefined();
  });

  it("falls back to 32 MB on an unusable MAX_FORMS_BYTES", async () => {
    const warn = vi.fn();
    await build("swagger2.json", { env: { MAX_FORMS_BYTES: "-1" }, warn });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("MAX_FORMS_BYTES"),
    );
  });
});
