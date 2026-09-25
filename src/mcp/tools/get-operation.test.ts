import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SpecOutline } from "~/domain/spec-forms";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { createRepo } from "~/index-store/repo";
import { createSpecForms, MAX_FORMS_ATTEMPTS } from "~/index-store/spec-forms";
import type { IndexedLookup } from "~/lookup/lookup";
import { createRateLimiter } from "~/lookup/rate-limit";
import { createNormalizedCache } from "~/spec-forms/operation-http";
import { expectGuided } from "../__fixtures__/guided";
import { handleMcpRequest } from "../http";
import { createSwaggerbotMcpHandler } from "../server";
import { GetOperationOutput } from "./get-operation";
import { GetSchemaOutput, missingSchemaText } from "./get-schema";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-mcp-operation-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const AT = "2026-09-24T00:00:00.000Z";
const API = "payco.com/payco-api";
const repo = createRepo(db);
const forms = createSpecForms(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({ id: API, vendorId: "payco.com", name: "PayCo" });

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * A chain of 30 schemas, `level0` → `level1` → …, each about 2 kB: the
 * whole of it is far over an agent's budget, so an operation that reaches
 * it is truncated.
 */
const levels = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [
    `level${i}`,
    {
      type: "object",
      properties: {
        ...Object.fromEntries(
          Array.from({ length: 20 }, (_, p) => [
            `field_${p}`,
            {
              type: "string",
              description: `Field ${p} of level ${i}, described at some length so that it weighs what a real Spec's does.`,
            },
          ]),
        ),
        ...(i < 29 ? { next: ref(`level${i + 1}`) } : {}),
      },
    },
  ]),
);

const normalized = {
  openapi: "3.1.1",
  info: { title: "PayCo", version: "1.0.0" },
  paths: {
    "/v1/account": {
      get: {
        operationId: "GetAccount",
        summary: "Retrieve account",
        responses: {
          "200": {
            description: "The account",
            content: { "application/json": { schema: ref("level0") } },
          },
        },
      },
    },
    "/v1/customers": {
      get: { operationId: "ListCustomers", responses: {} },
      post: {
        operationId: "PostCustomers",
        requestBody: {
          content: { "application/json": { schema: ref("customer") } },
        },
        responses: {},
      },
    },
    "/v1/customers/{customer}": {
      get: {
        operationId: "GetCustomer",
        responses: {
          "200": {
            description: "A customer",
            content: { "application/json": { schema: ref("customer") } },
          },
        },
      },
      post: { operationId: "PostCustomer", responses: {} },
    },
  },
  components: {
    schemas: {
      ...levels,
      customer: {
        type: "object",
        properties: { id: { type: "string" }, tree: ref("node") },
      },
      node: {
        type: "object",
        properties: {
          name: { type: "string" },
          children: { type: "array", items: ref("node") },
        },
      },
    },
  },
};

const outline: SpecOutline = {
  title: "PayCo",
  apiVersion: "1.0.0",
  servers: [],
  securitySchemes: [],
  tags: [],
  operations: Object.entries(normalized.paths).flatMap(([path, item]) =>
    Object.keys(item).map((method) => ({ method, path, tags: [] })),
  ),
};

const specId = repo.putSpec(API, new TextEncoder().encode('{"n":1}'), {
  specVersion: "3.1.0",
  apiVersion: "1.0.0",
  format: "json",
}).id;
forms.saveBuilt(
  specId,
  {
    normalized: new TextEncoder().encode(JSON.stringify(normalized)),
    normalizedSpecVersion: "3.1.1",
    validityIssues: [],
    validityFindingCount: 0,
    normalizedFindingCount: 0,
    outline,
  },
  AT,
);

/** Two more Specs of the API: one whose forms are pending, one whose build failed. */
const specOf = (n: number) =>
  repo.putSpec(API, new TextEncoder().encode(`{"n":${n}}`), {
    specVersion: "3.1.0",
    apiVersion: `${n}.0.0`,
    format: "json",
  }).id;
const pendingSpecId = specOf(2);
const failedSpecId = specOf(3);
for (let i = 0; i < MAX_FORMS_ATTEMPTS; i++)
  forms.saveFailure(failedSpecId, new Error("Unresolvable $ref #/x"), AT);

const lookup = Object.assign(() => Promise.reject(new Error("no Discovery")), {
  fromIndex: () => null,
  currentFromIndex: (apiId: string) =>
    apiId === API ? { currentSpec: { id: specId } } : null,
}) as unknown as IndexedLookup;
const keys = createKeys(db);
const gate = {
  rateLimiter: createRateLimiter({ perMinute: 1000, now: () => 0 }),
  clientIpHeader: "x-forwarded-for",
  dailyQuota: 100,
};
const handler = createSwaggerbotMcpHandler({
  getApp: () => ({ db, lookup, keys }),
  gate,
  cache: createNormalizedCache(),
});

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

async function call(name: string, args: object): Promise<ToolResult> {
  const response = await handleMcpRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    handler,
    () => ({ keys }),
    gate,
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  const data = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
  if (!data) throw new Error(`no JSON-RPC message in ${text}`);
  const message = JSON.parse(data);
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result;
}

const textOf = (result: ToolResult) => result.content[0]?.text ?? "";

/** What an agent takes in: the structured answer and the text beside it. */
const sizeOf = (result: ToolResult) =>
  Buffer.byteLength(JSON.stringify(result.structuredContent ?? {})) +
  Buffer.byteLength(textOf(result));

describe("get_operation", () => {
  it("answers as the HTTP route does, whatever the method's case", async () => {
    const result = await call("get_operation", {
      apiId: API,
      method: "GET",
      path: "/v1/customers/{customer}",
    });

    expect(expectGuided(result, GetOperationOutput)).toEqual({
      summary: `GET /v1/customers/{customer} of ${API} (operationId "GetCustomer"). Every reference is inlined. 1 schema recurs within itself; where it does it is { $ref, "x-circular": true }, and circular holds it once.`,
      next: [],
    });
    expect(result.structuredContent).toMatchObject({
      apiId: API,
      specId,
      method: "get",
      path: "/v1/customers/{customer}",
      truncated: false,
    });
  });

  it("stays under 30 kB, and a reference it leaves is followed with get_schema", async () => {
    const result = await call("get_operation", {
      apiId: API,
      method: "get",
      path: "/v1/account",
    });

    const guidance = expectGuided(result, GetOperationOutput);
    expect(result.structuredContent?.truncated).toBe(true);
    expect(sizeOf(result)).toBeLessThan(30_000);
    expect(guidance.summary).toMatch(
      /1 reference was left as \{ \$ref, "x-truncated": true \}/,
    );
    expect(guidance.next).toHaveLength(1);
    const next =
      /^get_schema\(apiId: "payco\.com\/payco-api", name: "(level\d+)"\)$/.exec(
        guidance.next[0] ?? "",
      );
    expect(next).not.toBeNull();
    const name = next?.[1] as string;

    const followed = await call("get_schema", {
      apiId: API,
      name: `#/components/schemas/${name}`,
    });

    const followedGuidance = expectGuided(followed, GetSchemaOutput);
    expect(followed.structuredContent).toMatchObject({
      apiId: API,
      specId,
      name,
      schema: { type: "object", properties: { field_0: { type: "string" } } },
    });
    expect(sizeOf(followed)).toBeLessThan(30_000);
    expect(followedGuidance.summary).toMatch(
      new RegExp(`^Schema "${name}" of ${API}\\.`),
    );
  });

  it.each([
    [
      "a typo",
      "get",
      "/v1/custmers/{customer}",
      "GET /v1/customers/{customer}",
    ],
    [
      "a filled-in parameter",
      "get",
      "/v1/customers/cus_123",
      "GET /v1/customers/{customer}",
    ],
    [
      "a filled-in parameter, same method first",
      "post",
      "/v1/customers/cus_123",
      "POST /v1/customers/{customer}",
    ],
    ["a wrong method", "delete", "/v1/account", "GET /v1/account"],
  ])(
    "suggests the nearest operations for %s",
    async (_, method, path, first) => {
      const result = await call("get_operation", { apiId: API, method, path });

      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain(
        `This Spec has no operation ${method.toUpperCase()} ${path}. The nearest: ${first}, `,
      );
      const listed = /The nearest: (.*?)\. Next/.exec(text)?.[1]?.split(", ");
      expect(listed?.length).toBe(5);
      const [verb, template] = first.split(" ");
      expect(text).toContain(
        `Next: get_operation(apiId: "${API}", method: "${verb?.toLowerCase()}", path: "${template}")`,
      );
    },
  );

  it("points an unknown API at lookup_api", async () => {
    const result = await call("get_operation", {
      apiId: "nope.com/nope-api",
      method: "get",
      path: "/v1/account",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("lookup_api(name)");
  });
});

describe("get_schema", () => {
  it("keeps a schema that recurs within itself as x-circular", async () => {
    const result = await call("get_schema", { apiId: API, name: "node" });

    const { summary } = expectGuided(result, GetSchemaOutput);
    expect(result.structuredContent).toMatchObject({
      name: "node",
      schema: {
        properties: {
          children: {
            items: { $ref: "#/components/schemas/node", "x-circular": true },
          },
        },
      },
      circular: { node: { type: "object" } },
    });
    expect(summary).toContain("1 schema recurs within itself");
  });

  it("gives the nearest names for a name not in the Spec", async () => {
    const result = await call("get_schema", { apiId: API, name: "Customers" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /^This Spec has no schema "Customers" in components\.schemas\. The nearest: "customer", /,
    );
    expect(textOf(result)).toContain(
      `Next: get_schema(apiId: "${API}", name: "customer")`,
    );
  });

  it("points to get_spec_outline and get_operation when no name is near", () => {
    expect(missingSchemaText(API, undefined, "Customers", [])).toBe(
      `This Spec has no schema "Customers" in components.schemas. No name in it is near. Next: get_spec_outline(apiId: "${API}") to find an operation, then get_operation for it, which inlines the schemas it uses.`,
    );
  });
});

describe.each([
  ["get_operation", { method: "get", path: "/v1/account" }],
  ["get_schema", { name: "customer" }],
])("%s on a Spec without a Normalized Form", (tool, args) => {
  it("is an error saying to retry while the Normalized Form is pending", async () => {
    const result = await call(tool, {
      apiId: API,
      specId: pendingSpecId,
      ...args,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "The Spec's Normalized Form is still being built. Retry in 10 s.",
        },
      ],
    });
  });

  it("is an error pointing to the Published Form when the build failed", async () => {
    const result = await call(tool, {
      apiId: API,
      specId: failedSpecId,
      ...args,
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "The Spec's Normalized Form could not be built (Unresolvable $ref #/x), so its operations and schemas can't be expanded. Its Published Form can still be downloaded: lookup_api gives the URL.",
        },
      ],
    });
  });
});
