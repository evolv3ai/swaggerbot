import { describe, expect, it } from "vitest";
import type { SpecOutline } from "~/domain/spec-forms";
import { generatedOutline } from "./__fixtures__/outline";
import {
  BadCursorError,
  CUT_TAG_COUNT,
  MAX_TAGS_BYTES,
  pageOutline,
} from "./outline-page";

const ids = { apiId: "payco.com/payco-api", specId: "a".repeat(64) };

const outline: SpecOutline = {
  title: "PayCo",
  apiVersion: "2.0",
  servers: ["https://api.payco.com"],
  securitySchemes: [{ name: "bearer", type: "http", scheme: "bearer" }],
  tags: [
    { name: "Customers", operationCount: 3 },
    { name: "Charges", operationCount: 2 },
  ],
  operations: [
    {
      method: "get",
      path: "/v1/customers",
      summary: "List customers",
      tags: ["Customers"],
    },
    {
      method: "post",
      path: "/v1/customers",
      operationId: "CreateCustomer",
      tags: ["Customers"],
    },
    {
      method: "get",
      path: "/v1/charges",
      summary: "List charges",
      tags: ["Charges"],
    },
    {
      method: "get",
      path: "/v1/charges/{charge}",
      summary: "The charge's customer",
      tags: ["Charges"],
    },
    { method: "delete", path: "/v1/customers/{customer}", tags: ["Customers"] },
  ],
};

const paths = (ops: { method: string; path: string }[]) =>
  ops.map((op) => `${op.method} ${op.path}`);

describe("pageOutline", () => {
  it("keeps the outline's header, every tag and every operation by default", () => {
    expect(pageOutline({ ...ids, outline })).toEqual({
      ...ids,
      title: "PayCo",
      apiVersion: "2.0",
      servers: outline.servers,
      securitySchemes: outline.securitySchemes,
      tags: outline.tags,
      operations: outline.operations,
      totalOperations: 5,
      matchedOperations: 5,
      nextCursor: null,
    });
  });

  it("filters by tag, ignoring case, in outline order", () => {
    const page = pageOutline({ ...ids, outline }, { tag: "customers" });

    expect(paths(page.operations)).toEqual([
      "get /v1/customers",
      "post /v1/customers",
      "delete /v1/customers/{customer}",
    ]);
    expect(page.matchedOperations).toBe(3);
    expect(page.tags).toEqual(outline.tags);
  });

  it("filters by query on the path, operationId or summary, ignoring case", () => {
    expect(
      paths(pageOutline({ ...ids, outline }, { query: "CUSTOMER" }).operations),
    ).toEqual([
      "get /v1/customers",
      "post /v1/customers",
      "get /v1/charges/{charge}",
      "delete /v1/customers/{customer}",
    ]);
    expect(
      paths(
        pageOutline({ ...ids, outline }, { query: "createcust" }).operations,
      ),
    ).toEqual(["post /v1/customers"]);
  });

  it("combines tag and query", () => {
    const page = pageOutline(
      { ...ids, outline },
      { tag: "Charges", query: "customer" },
    );

    expect(paths(page.operations)).toEqual(["get /v1/charges/{charge}"]);
  });

  it("pages across the end with the cursor", () => {
    const first = pageOutline({ ...ids, outline }, { limit: 2 });
    const second = pageOutline(
      { ...ids, outline },
      { limit: 2, cursor: first.nextCursor ?? "" },
    );
    const third = pageOutline(
      { ...ids, outline },
      { limit: 2, cursor: second.nextCursor ?? "" },
    );
    const past = pageOutline({ ...ids, outline }, { limit: 2, cursor: "9" });

    expect(first.nextCursor).not.toBeNull();
    expect(
      paths([...first.operations, ...second.operations, ...third.operations]),
    ).toEqual(paths(outline.operations));
    expect(third.operations).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    expect(past).toMatchObject({
      operations: [],
      matchedOperations: 5,
      nextCursor: null,
    });
  });

  it("pages the filtered operations, not the whole outline", () => {
    const first = pageOutline(
      { ...ids, outline },
      { tag: "customers", limit: 2 },
    );
    const second = pageOutline(
      { ...ids, outline },
      { tag: "customers", limit: 2, cursor: first.nextCursor ?? "" },
    );

    expect(paths(second.operations)).toEqual([
      "delete /v1/customers/{customer}",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it.each(["-1", "abc", "1.5", "01", ""])("rejects the cursor %j", (cursor) => {
    expect(() => pageOutline({ ...ids, outline }, { cursor })).toThrow(
      BadCursorError,
    );
  });

  it("defaults to 100 operations a page", () => {
    const page = pageOutline({ ...ids, outline: generatedOutline(250, 5) });

    expect(page.operations).toHaveLength(100);
    expect(page.nextCursor).toBe("100");
  });

  it("cuts a tag list over 20 kB to the largest tags, and says so", () => {
    const big = generatedOutline(4000, 600);
    big.tags[599] = {
      name: "zone-settings-and-resources-599",
      operationCount: 1000,
    };

    const page = pageOutline({ ...ids, outline: big });

    expect(JSON.stringify(big.tags).length).toBeGreaterThan(MAX_TAGS_BYTES);
    expect(page.tagsCut).toBe(true);
    expect(page.tags).toHaveLength(CUT_TAG_COUNT);
    expect(page.tags[0]).toEqual(big.tags[599]);
  });

  it("keeps a page within maxBytes by dropping operations from its end", () => {
    const page = pageOutline(
      { ...ids, outline: generatedOutline(4000, 600) },
      { maxBytes: 20_000 },
    );

    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(20_000);
    expect(page.operations.length).toBeGreaterThan(0);
    expect(page.nextCursor).toBe(String(page.operations.length));
  });

  it("cuts long summaries when held to maxBytes", () => {
    const long = {
      ...outline,
      operations: [
        {
          method: "get",
          path: "/v1/long",
          summary: "x".repeat(5000),
          tags: [],
        },
      ],
    };

    const [op] = pageOutline(
      { ...ids, outline: long },
      { maxBytes: 30_000 },
    ).operations;

    expect(op?.summary).toHaveLength(300);
  });
});
