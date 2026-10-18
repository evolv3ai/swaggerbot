import { describe, expect, it } from "vitest";
import sameOrigin from "~/spec-forms/__fixtures__/openapi31-same-origin.json";
import { generatedOutline } from "~/spec-forms/__fixtures__/outline";
import widget from "~/spec-forms/__fixtures__/widget.json";
import { outlineOf } from "~/spec-forms/build";
import payco from "./__fixtures__/payco.json";
import {
  type ChatTurn,
  DEFAULT_BUDGET_BYTES,
  type GroundingSpec,
  groundingFor,
  MAX_OPERATIONS,
  MAX_SCHEMAS,
  OPERATION_TEXT_BYTES,
  SCHEMA_TEXT_BYTES,
} from "./retrieve";

function specOf(doc: Record<string, unknown>): GroundingSpec {
  return {
    outline: outlineOf(doc),
    doc,
    apiId: "payco.example/payco",
    specId: "s1",
  };
}

const paycoSpec = specOf(payco);

/** The Widget API: the split fixture's paths with `widget.json` as its schemas. */
const widgetSpec = specOf({
  ...sameOrigin,
  components: { schemas: widget },
});

const bytes = (text: string) => Buffer.byteLength(text);

describe("groundingFor", () => {
  it("picks the POST on the customers path first for creating a customer", () => {
    const { documents } = groundingFor(
      "How do I create a customer?",
      [],
      paycoSpec,
    );
    expect(documents[1]).toMatchObject({
      kind: "operation",
      title: "POST /customers (operation)",
      ref: { method: "post", path: "/customers" },
    });
    const operation = JSON.parse(documents[1]?.text ?? "");
    expect(operation.operation.operationId).toBe("createCustomer");
    // Expanded: the request body's schema is inlined, not a reference.
    expect(
      operation.operation.requestBody.content["application/json"].schema
        .properties.address.properties.city,
    ).toEqual({ type: "string" });
    expect(operation.truncated).toBe(false);
  });

  it("picks a schema the question names", () => {
    const { documents, stats } = groundingFor(
      "What does a Widget look like?",
      [],
      widgetSpec,
    );
    const schema = documents.find((d) => d.kind === "schema");
    expect(schema).toMatchObject({
      title: "Widget (schema)",
      ref: { name: "Widget" },
    });
    expect(JSON.parse(schema?.text ?? "").schema).toEqual(widget.Widget);
    expect(documents.map((d) => d.title)).toContain("GET /widgets (operation)");
    expect(stats.unmatchedWords).toEqual(["look", "like"]);
  });

  it("returns the facts only, and the unmatched words, when nothing matches", () => {
    const { documents, stats } = groundingFor(
      "Does it support zebras or quokkas?",
      [],
      paycoSpec,
    );
    expect(documents.map((d) => d.kind)).toEqual(["facts"]);
    expect(stats).toMatchObject({
      operations: 0,
      schemas: 0,
      operationBytes: 0,
      schemaBytes: 0,
      unmatchedWords: ["support", "zebras", "quokkas"],
    });
    expect(stats.bytes).toBe(stats.factsBytes);
  });

  it("keeps what earlier turns cited, first", () => {
    const history: ChatTurn[] = [
      { role: "user", text: "How do I list invoices?" },
      {
        role: "assistant",
        text: "Call GET /invoices.",
        cited: [{ method: "get", path: "/invoices" }, { name: "Invoice" }],
      },
      { role: "user", text: "And delete a customer?" },
      {
        role: "assistant",
        text: "Call DELETE /customers/{customer}.",
        cited: [{ method: "delete", path: "/customers/{customer}" }],
      },
    ];
    const { documents } = groundingFor(
      "How do I create a customer?",
      history,
      paycoSpec,
    );
    const operations = documents.filter((d) => d.kind === "operation");
    expect(operations.slice(0, 3).map((d) => d.title)).toEqual([
      "DELETE /customers/{customer} (operation)",
      "GET /invoices (operation)",
      "POST /customers (operation)",
    ]);
    // Each once, though the question matches the cited DELETE too.
    expect(new Set(operations.map((d) => d.title)).size).toBe(
      operations.length,
    );
    expect(documents.find((d) => d.kind === "schema")?.title).toBe(
      "Invoice (schema)",
    );
  });

  it("passes over a cited operation or schema the Spec doesn't have", () => {
    const { documents } = groundingFor(
      "zebras",
      [
        {
          role: "assistant",
          text: "",
          cited: [{ method: "get", path: "/nowhere" }, { name: "Nothing" }],
        },
      ],
      paycoSpec,
    );
    expect(documents.map((d) => d.kind)).toEqual(["facts"]);
  });

  it("always puts the facts first", () => {
    for (const question of ["create a customer", "Widget", "zebras"]) {
      const spec = question === "Widget" ? widgetSpec : paycoSpec;
      const [first] = groundingFor(question, [], spec).documents;
      expect(first).toMatchObject({
        kind: "facts",
        title: "About this Spec",
        ref: null,
      });
    }
    const facts = JSON.parse(
      groundingFor("zebras", [], paycoSpec).documents[0]?.text ?? "",
    );
    expect(facts).toEqual({
      title: "PayCo",
      apiVersion: "2024-06-01",
      servers: ["https://api.payco.example/v1"],
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Your secret key.",
        },
      },
      tags: [
        { name: "Customers", operationCount: 5 },
        { name: "Invoices", operationCount: 1 },
      ],
    });
  });

  describe("on a Spec with 4,000 large operations", () => {
    const outline = generatedOutline(4_000, 300);
    const doc = largeDoc(outline);
    const spec: GroundingSpec = { outline, doc, apiId: "a", specId: "s" };
    const question =
      "How do I update the settings of a resource, its zone and its DNS records?";

    it("never exceeds the budget, and cuts the expansions short", () => {
      for (const budget of [DEFAULT_BUDGET_BYTES, 20_000, 9_000]) {
        const { documents, stats } = groundingFor(question, [], spec, budget);
        const total = documents.reduce((n, d) => n + bytes(d.text), 0);
        expect(total).toBe(stats.bytes);
        expect(total).toBeLessThanOrEqual(budget);
        expect(stats.operations).toBeLessThanOrEqual(MAX_OPERATIONS);
        expect(stats.schemas).toBeLessThanOrEqual(MAX_SCHEMAS);
        expect(documents[0]?.kind).toBe("facts");
      }
      const { documents, stats } = groundingFor(question, [], spec);
      expect(stats.operations).toBe(MAX_OPERATIONS);
      expect(stats.truncated).toBeGreaterThan(0);
      for (const d of documents) {
        if (d.kind === "operation") {
          expect(bytes(d.text)).toBeLessThanOrEqual(OPERATION_TEXT_BYTES);
          expect(JSON.parse(d.text).truncated).toBe(true);
        }
        if (d.kind === "schema")
          expect(bytes(d.text)).toBeLessThanOrEqual(SCHEMA_TEXT_BYTES);
      }
    });

    it("holds the facts to their cap when the tag list is huge", () => {
      const facts = groundingFor("zebras", [], spec).documents[0];
      const parsed = JSON.parse(facts?.text ?? "");
      expect(bytes(facts?.text ?? "")).toBeLessThanOrEqual(8_000);
      expect(parsed.tagsCut).toBe(true);
      expect(parsed.tags.length).toBeGreaterThan(0);
      expect(parsed.tags.length).toBeLessThan(300);
    });
  });
});

/**
 * A Normalized Form for `outline` whose every operation reaches far more
 * than `OPERATION_TEXT_BYTES` through its references, with schemas named
 * after what the operations do.
 */
function largeDoc(outline: ReturnType<typeof generatedOutline>) {
  const long =
    "A setting that changes how the zone resolves its records. ".repeat(8);
  const props = (prefix: string, ref: string | null, n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `${prefix}_${i}`,
        ref
          ? { $ref: ref, description: long }
          : { type: "string", description: long },
      ]),
    );
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of outline.operations) {
    paths[op.path] ??= {};
    (paths[op.path] as Record<string, unknown>)[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/resource_settings" },
          },
        },
      },
      responses: {
        "200": {
          description: "The settings",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/resource_settings" },
            },
          },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: outline.title, version: outline.apiVersion },
    paths,
    components: {
      schemas: {
        resource_settings: {
          type: "object",
          properties: props("zone", "#/components/schemas/zone_settings", 20),
        },
        zone_settings: {
          type: "object",
          properties: props("record", "#/components/schemas/dns_record", 20),
        },
        dns_record: { type: "object", properties: props("field", null, 30) },
        dns_records_list: {
          type: "array",
          items: { $ref: "#/components/schemas/dns_record" },
        },
        zone: { type: "object", properties: props("name", null, 40) },
      },
    },
  };
}
