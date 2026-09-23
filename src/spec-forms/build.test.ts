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
