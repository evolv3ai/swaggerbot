import { describe, expect, it } from "vitest";
import {
  expandOperation,
  MAX_OPERATION_BYTES,
  schemaNames,
  schemaOf,
  truncatedReferences,
} from "./operation";

const doc = {
  openapi: "3.1.0",
  info: { title: "PayCo", version: "1.0.0" },
  security: [{ apiKey: [] }],
  paths: {
    "/customers/{customer}": {
      parameters: [
        { $ref: "#/components/parameters/Customer" },
        { name: "expand", in: "query", schema: { type: "string" } },
        { name: "trace", in: "header", schema: { type: "string" } },
      ],
      get: {
        operationId: "getCustomer",
        parameters: [
          {
            name: "expand",
            in: "query",
            schema: { type: "array", items: { type: "string" } },
          },
          { name: "trace", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": { $ref: "#/components/responses/Customer" },
        },
      },
      post: {
        operationId: "updateCustomer",
        security: [{ oauth: ["write"] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  billing: { $ref: "#/components/schemas/Address" },
                  shipping: { $ref: "#/components/schemas/Address" },
                },
              },
            },
          },
        },
        responses: { "204": { description: "Updated" } },
      },
    },
    "/nodes": {
      get: {
        responses: {
          "200": {
            description: "A tree",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Node" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      Customer: {
        name: "customer",
        in: "path",
        required: true,
        schema: { $ref: "#/components/schemas/Id" },
      },
    },
    responses: {
      Customer: {
        description: "A customer",
        headers: { "Request-Id": { $ref: "#/components/headers/RequestId" } },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Customer" },
          },
        },
      },
    },
    headers: {
      RequestId: { schema: { $ref: "#/components/schemas/Id" } },
    },
    schemas: {
      Id: { type: "string", pattern: "^cus_" },
      Address: {
        type: "object",
        properties: { line1: { type: "string" } },
      },
      Customer: {
        type: "object",
        properties: {
          id: { $ref: "#/components/schemas/Id" },
          address: { $ref: "#/components/schemas/Address" },
        },
      },
      Node: {
        type: "object",
        properties: {
          name: { type: "string" },
          children: {
            type: "array",
            items: { $ref: "#/components/schemas/Node" },
          },
        },
      },
    },
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "Authorization" },
      oauth: { type: "oauth2", flows: {} },
      unused: { type: "http", scheme: "basic" },
    },
  },
};

describe("expandOperation", () => {
  it("merges the Path Item's parameters, and an operation parameter wins", () => {
    const result = expandOperation(doc, "get", "/customers/{customer}");
    expect(result?.operation.parameters).toEqual([
      {
        name: "customer",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^cus_" },
      },
      // Same name, other location: both kept.
      { name: "trace", in: "header", schema: { type: "string" } },
      {
        name: "expand",
        in: "query",
        schema: { type: "array", items: { type: "string" } },
      },
      { name: "trace", in: "query", schema: { type: "boolean" } },
    ]);
  });

  it("inlines nested references at any depth", () => {
    const result = expandOperation(doc, "get", "/customers/{customer}");
    expect(result?.operation.responses).toEqual({
      "200": {
        description: "A customer",
        headers: {
          "Request-Id": { schema: { type: "string", pattern: "^cus_" } },
        },
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "string", pattern: "^cus_" },
                address: {
                  type: "object",
                  properties: { line1: { type: "string" } },
                },
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("$ref");
    expect(result?.circular).toEqual({});
    expect(result?.truncated).toBe(false);
  });

  it("leaves a schema that recurs within itself as an x-circular $ref, listed once", () => {
    const result = expandOperation(doc, "get", "/nodes");
    const node = {
      type: "object",
      properties: {
        name: { type: "string" },
        children: {
          type: "array",
          items: { $ref: "#/components/schemas/Node", "x-circular": true },
        },
      },
    };
    const response = result?.operation.responses as Record<
      string,
      { content: Record<string, { schema: unknown }> }
    >;
    expect(response["200"]?.content["application/json"]?.schema).toEqual(node);
    expect(result?.circular).toEqual({ Node: node });
    expect(result?.truncated).toBe(false);
  });

  it("inlines a schema on two branches twice", () => {
    const result = expandOperation(doc, "POST", "/customers/{customer}");
    const address = {
      type: "object",
      properties: { line1: { type: "string" } },
    };
    expect(result?.operation.requestBody).toEqual({
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { billing: address, shipping: address },
          },
        },
      },
    });
    expect(result?.circular).toEqual({});
  });

  it("gives the operation's security and the schemes it names", () => {
    const result = expandOperation(doc, "post", "/customers/{customer}");
    expect(result?.operation.security).toEqual([{ oauth: ["write"] }]);
    expect(result?.securitySchemes).toEqual({
      oauth: { type: "oauth2", flows: {} },
    });
  });

  it("falls back to the document's security", () => {
    const result = expandOperation(doc, "get", "/customers/{customer}");
    expect(result?.operation.security).toEqual([{ apiKey: [] }]);
    expect(result?.securitySchemes).toEqual({
      apiKey: { type: "apiKey", in: "header", name: "Authorization" },
    });
  });

  it("is undefined for a path or method the Spec doesn't have", () => {
    expect(expandOperation(doc, "delete", "/nodes")).toBeUndefined();
    expect(expandOperation(doc, "parameters", "/nodes")).toBeUndefined();
    expect(expandOperation(doc, "get", "/nodes/")).toBeUndefined();
    expect(expandOperation(doc, "get", "/customers/{id}")).toBeUndefined();
  });

  it("stops inlining at the cap, deepest detail first", () => {
    // 25 properties, each a 30 kB schema that holds a 30 kB schema:
    // 1.5 MB in full, and the properties alone 750 kB.
    const big = (n: number) => ({
      type: "string",
      description: `${n} ${"x".repeat(30_000)}`,
    });
    const schemas: Record<string, unknown> = {};
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) {
      schemas[`Leaf${i}`] = big(i);
      schemas[`Mid${i}`] = {
        ...big(i),
        type: "object",
        properties: { leaf: { $ref: `#/components/schemas/Leaf${i}` } },
      };
      properties[`p${i}`] = { $ref: `#/components/schemas/Mid${i}` };
    }
    const huge = {
      openapi: "3.1.0",
      paths: {
        "/big": {
          get: {
            responses: {
              "200": {
                description: "Big",
                content: {
                  "application/json": {
                    schema: { type: "object", properties },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas },
    };
    const result = expandOperation(huge, "get", "/big");
    const serialized = JSON.stringify(result);
    expect(result?.truncated).toBe(true);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
      MAX_OPERATION_BYTES,
    );
    expect(Buffer.byteLength(serialized)).toBeGreaterThan(
      MAX_OPERATION_BYTES * 0.9,
    );
    // Every property is inlined before any leaf is.
    const refs = [...serialized.matchAll(/\{"\$ref":"[^"]*"[^}]*\}/g)].map(
      ([ref]) => ref,
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/Leaf.*"x-truncated":true/);
    expect(refs).toContain(
      '{"$ref":"#/components/schemas/Leaf24","x-truncated":true}',
    );
  });
});

describe("schemaOf", () => {
  const schemas = {
    openapi: "3.1.0",
    components: {
      schemas: {
        Address: {
          type: "object",
          properties: {
            city: { type: "string" },
            geo: { $ref: "#/components/schemas/Geo" },
          },
        },
        Geo: { type: "object", properties: { lat: { type: "number" } } },
        Alias: { $ref: "#/components/schemas/Geo" },
        Tree: {
          type: "object",
          properties: {
            children: {
              type: "array",
              items: { $ref: "#/components/schemas/Tree" },
            },
          },
        },
        "a/b~c": { type: "string" },
      },
    },
  };

  it("expands a schema by its bare name or its whole reference", () => {
    const expected = {
      name: "Address",
      schema: {
        type: "object",
        properties: {
          city: { type: "string" },
          geo: { type: "object", properties: { lat: { type: "number" } } },
        },
      },
      circular: {},
      truncated: false,
    };
    expect(schemaOf(schemas, "Address")).toEqual(expected);
    expect(schemaOf(schemas, "#/components/schemas/Address")).toEqual(expected);
  });

  it("follows a reference to a reference, in an operation too", () => {
    const withPath = {
      ...schemas,
      paths: {
        "/geo": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Alias" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const expanded = expandOperation(withPath, "get", "/geo");
    expect(expanded?.operation).toEqual({
      responses: {
        "200": {
          description: "ok",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { lat: { type: "number" } },
              },
            },
          },
        },
      },
    });
  });

  it("follows a schema that is only a reference", () => {
    expect(schemaOf(schemas, "Alias")?.schema).toEqual({
      type: "object",
      properties: { lat: { type: "number" } },
    });
  });

  it("finds a name with a slash or a tilde, bare or pointer-escaped", () => {
    expect(schemaOf(schemas, "a/b~c")?.schema).toEqual({ type: "string" });
    expect(schemaOf(schemas, "#/components/schemas/a~1b~0c")?.name).toBe(
      "a/b~c",
    );
  });

  it("keeps a schema that recurs within itself as x-circular, listed once", () => {
    const tree = schemaOf(schemas, "Tree");
    expect(tree?.schema).toEqual({
      type: "object",
      properties: {
        children: {
          type: "array",
          items: { $ref: "#/components/schemas/Tree", "x-circular": true },
        },
      },
    });
    expect(Object.keys(tree?.circular ?? {})).toEqual(["Tree"]);
  });

  it("stops at maxBytes, leaving the deepest references truncated", () => {
    const whole = Buffer.byteLength(
      JSON.stringify(schemaOf(schemas, "Address")),
    );
    const address = schemaOf(schemas, "Address", { maxBytes: whole - 1 });
    expect(address?.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(address))).toBeLessThan(whole);
    expect(address?.schema).toMatchObject({
      properties: { city: { type: "string" } },
    });
    expect(truncatedReferences(address)).toEqual(["#/components/schemas/Geo"]);
  });

  it("is undefined for a name that isn't a schema", () => {
    expect(schemaOf(schemas, "Nope")).toBeUndefined();
    expect(schemaOf(schemas, "#/components/responses/Address")).toBeUndefined();
    expect(schemaOf({}, "Address")).toBeUndefined();
    expect(schemaNames(schemas)).toEqual([
      "Address",
      "Geo",
      "Alias",
      "Tree",
      "a/b~c",
    ]);
  });
});
