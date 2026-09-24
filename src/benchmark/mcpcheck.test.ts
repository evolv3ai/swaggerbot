import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterAll, describe, expect, it } from "vitest";
import { Outcome } from "~/domain/outcome";
import type { SpecOutline } from "~/domain/spec-forms";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { IndexedLookup, LookupRequest } from "~/lookup/lookup";
import { createRateLimiter } from "~/lookup/rate-limit";
import { handleMcpRequest } from "~/mcp/http";
import { createSwaggerbotMcpHandler, MCP_TOOLS } from "~/mcp/server";
import { createNormalizedCache } from "~/spec-forms/operation-http";
import {
  type McpcheckCall,
  type McpcheckNameReport,
  type McpcheckOptions,
  mcpcheckLines,
  mcpcheckReport,
  parseMcpcheckArgs,
  queryFrom,
  resultBytes,
  runMcpcheck,
} from "./mcpcheck";

describe("parseMcpcheckArgs", () => {
  it("reads the defaults, the key from LOADCHECK_KEY", () => {
    expect(
      parseMcpcheckArgs(["https://swaggerbot.dev/"], { LOADCHECK_KEY: "s" }),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        baseUrl: "https://swaggerbot.dev",
        names: ["Stripe", "GitHub REST API", "Cloudflare"],
        key: "s",
        rps: 0.8,
        json: false,
      },
    });
  });

  it("reads --names and --json; no key without LOADCHECK_KEY", () => {
    expect(
      parseMcpcheckArgs([
        "http://localhost:3000",
        "--names",
        " Stripe , GitHub REST API ,",
        "--json",
      ]),
    ).toMatchObject({
      ok: true,
      options: {
        names: ["Stripe", "GitHub REST API"],
        key: undefined,
        json: true,
      },
    });
  });

  it("answers --help without a URL", () => {
    expect(parseMcpcheckArgs(["--help"])).toEqual({ ok: true, help: true });
  });

  it.each([
    [[], "missing URL"],
    [["https://x.dev", "--nope"], "unknown flag"],
    [["https://x.dev", "--names", " , "], "no names"],
    [["ftp://x.dev"], "not http(s)"],
    [["https://x.dev", "https://y.dev"], "two URLs"],
  ])("exits 2 on %j (%s)", (args) => {
    expect(parseMcpcheckArgs(args)).toMatchObject({ ok: false, exitCode: 2 });
  });
});

describe("queryFrom", () => {
  it("takes the first literal path segment that isn't a version or a parameter", () => {
    expect(
      queryFrom([
        { path: "/" },
        { path: "/v1/{id}" },
        { path: "/v1/Customers/{customer}" },
      ]),
    ).toBe("customers");
  });

  it("has none when no path has a word", () => {
    expect(queryFrom([{ path: "/" }, { path: "/v2/{x}/ab" }])).toBeUndefined();
  });
});

describe("resultBytes", () => {
  it("counts the structuredContent as JSON and the text", () => {
    expect(
      resultBytes({
        structuredContent: { a: 1 },
        content: [{ type: "text", text: "héllo" }],
      }),
    ).toBe(7 + 6);
  });
});

describe("mcpcheckReport", () => {
  const TOOLS = [
    "lookup_api",
    "list_vendor_apis",
    "get_spec_outline",
    "get_operation",
    "get_schema",
  ];
  const setup: McpcheckCall[] = [
    { tool: "connect", ms: 20, bytes: 0 },
    { tool: "tools/list", ms: 10, bytes: 9000 },
  ];
  const name = (calls: McpcheckCall[]): McpcheckNameReport => ({
    name: "Acme",
    calls,
    failures: [],
  });

  it("passes when every call is quick and small", () => {
    const report = mcpcheckReport("http://x", setup, TOOLS, [
      name([{ name: "Acme", tool: "lookup_api", ms: 2000, bytes: 29_999 }]),
    ]);
    expect(report).toMatchObject({
      pass: true,
      failures: [],
      maxMs: 2000,
      maxBytes: 29_999,
    });
    expect(mcpcheckLines(report).at(-1)).toBe("PASS");
  });

  it("fails a missing tool, a result of 30 kB and a call over 2 s", () => {
    const report = mcpcheckReport("http://x", setup, TOOLS.slice(0, 4), [
      name([{ name: "Acme", tool: "get_operation", ms: 2001, bytes: 30_000 }]),
    ]);
    expect(report.pass).toBe(false);
    expect(report.failures).toEqual([
      "tools/list: missing get_schema",
      "Acme: get_operation: the result is 30.0 KB, not under 30.0 KB",
      "Acme: get_operation: took 2.0 s, over 2.0 s",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The whole check, through the SDK's client, against the real `/mcp` handler.

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-mcpcheck-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

const AT = "2026-09-24T00:00:00.000Z";
const API = "payco.com/payco-api";
const repo = createRepo(db);
repo.upsertVendor({ id: "payco.com", name: "PayCo", domain: "payco.com" });
repo.upsertApi({ id: API, vendorId: "payco.com", name: "PayCo" });

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
/** A chain of schemas far over an agent's budget, so operations reaching it are truncated. */
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
const withLevels = {
  responses: {
    "200": {
      description: "OK",
      content: { "application/json": { schema: ref("level0") } },
    },
  },
};
const normalized = {
  openapi: "3.1.1",
  info: { title: "PayCo", version: "1.0.0" },
  paths: {
    "/v1/customers": { get: withLevels, post: withLevels },
    "/v1/customers/{customer}": { get: withLevels },
    "/v1/invoices": { get: withLevels },
  },
  components: { schemas: levels },
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
const spec = repo.putSpec(API, new TextEncoder().encode('{"n":1}'), {
  specVersion: "3.1.0",
  apiVersion: "1.0.0",
  format: "json",
});
createSpecForms(db).saveBuilt(
  spec.id,
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

const resolved = Outcome.parse({
  outcome: "Resolved",
  api: { id: API, vendorId: "payco.com", name: "PayCo" },
  vendor: { id: "payco.com", name: "PayCo", domain: "payco.com" },
  currentSpec: {
    id: spec.id,
    apiId: API,
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    isPreview: false,
    supersededAt: null,
    format: "json",
    byteLength: 7,
    downloads: {
      published: `/api/specs/${spec.id}/published`,
      normalized: `/api/specs/${spec.id}/normalized`,
    },
    normalized: "ready",
  },
  alternateSpecs: [],
  provenance: "Official",
  sources: [
    {
      id: 1,
      specId: spec.id,
      url: "https://payco.com/openapi.json",
      provenance: "Official",
      firstSeenAt: AT,
      lastVerifiedAt: AT,
    },
  ],
  validityIssues: [],
  validityIssueCount: 0,
  verifiedAt: AT,
});

/** The Index knows "PayCo"; any other name would need Discovery. */
const lookup = Object.assign(
  () => Promise.reject(new Error("no Discovery in this test")),
  {
    fromIndex: ({ name }: LookupRequest) =>
      name === "PayCo" ? resolved : null,
    currentFromIndex: (apiId: string) =>
      apiId === API ? { currentSpec: { id: spec.id } } : null,
  },
) as unknown as IndexedLookup;
const keys = createKeys(db);
const gate = {
  rateLimiter: createRateLimiter({ perMinute: 1000 }),
  clientIpHeader: "x-forwarded-for",
  dailyQuota: 100,
};

/** `fetch` to the `/mcp` route's handler, in process, serving `tools`. */
function mcpFetch(tools = MCP_TOOLS): typeof fetch {
  const deps = {
    getApp: () => ({ db, lookup, keys }),
    gate,
    cache: createNormalizedCache(),
  };
  const handler =
    tools === MCP_TOOLS
      ? createSwaggerbotMcpHandler(deps)
      : createMcpHandler(() => {
          const server = new McpServer({ name: "swagger.bot", version: "0" });
          for (const register of tools) register(server, deps);
          return server;
        });
  return async (input, init) =>
    handleMcpRequest(new Request(input, init), handler, () => ({ keys }), gate);
}

const options: McpcheckOptions = {
  baseUrl: "http://swaggerbot.test",
  names: ["PayCo"],
  rps: 1000,
  json: false,
};

describe("runMcpcheck", () => {
  it("passes against the MCP server, following a reference with get_schema", async () => {
    const report = await runMcpcheck(options, { fetch: mcpFetch() });

    expect(report.failures).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.tools).toHaveLength(5);
    const [payco] = report.names;
    expect(payco?.apiId).toBe(API);
    expect(payco?.query).toBe("customers");
    expect(payco?.calls.map((c) => c.tool)).toEqual([
      "lookup_api",
      "get_spec_outline",
      "get_spec_outline",
      "get_operation",
      "get_operation",
      "get_operation",
      "get_schema",
    ]);
    expect(payco?.calls.at(-1)?.arguments).toMatchObject({
      name: expect.stringMatching(/^#\/components\/schemas\/level\d+$/),
    });
    expect(payco?.calls.every((c) => c.bytes > 0 && c.bytes < 30_000)).toBe(
      true,
    );
  });

  it("fails a name that isn't Resolved, with the tool's error", async () => {
    const report = await runMcpcheck(
      { ...options, names: ["Nope"] },
      { fetch: mcpFetch() },
    );

    expect(report.pass).toBe(false);
    expect(report.names[0]?.calls).toHaveLength(1);
    expect(report.failures[0]).toMatch(/^Nope: lookup_api: /);
  });

  it("fails when a tool is missing", async () => {
    const report = await runMcpcheck(options, {
      fetch: mcpFetch(MCP_TOOLS.slice(0, 4)),
    });

    expect(report.failures).toContain("tools/list: missing get_schema");
  });

  it("fails an unknown key before any tool runs", async () => {
    const report = await runMcpcheck(
      { ...options, key: "sb_live_nope" },
      { fetch: mcpFetch() },
    );

    expect(report.pass).toBe(false);
    expect(report.setup[0]?.tool).toBe("connect");
    expect(report.setup[0]?.error).toBeTruthy();
    expect(report.names).toEqual([]);
  });
});
