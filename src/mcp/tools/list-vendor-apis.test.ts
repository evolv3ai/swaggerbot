import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "~/index-store/db";
import { createKeys } from "~/index-store/keys";
import { createRepo } from "~/index-store/repo";
import { FakeJudge } from "~/judge/fake";
import type { Gate } from "~/lookup/http";
import { createLookup } from "~/lookup/lookup";
import { expectGuided } from "../__fixtures__/guided";
import { createSwaggerbotMcpHandler } from "../server";
import { ListVendorApisOutput, vendorApisGuidance } from "./list-vendor-apis";

const dir = mkdtempSync(join(tmpdir(), "swaggerbot-mcp-vendors-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = openDb(join(dir, "index.db"));
afterAll(() => db.$client.close());

/** A dependency the listing must never touch: any use of it throws. */
function unused<T>(name: string): T {
  return new Proxy({} as object, {
    get: () => {
      throw new Error(`${name} used`);
    },
  }) as T;
}

const lookup = createLookup({
  db,
  judge: new FakeJudge(),
  apisGuru: unused("APIs.guru"),
  webSearch: null,
  fetcher: unused("the fetcher"),
  publicBaseUrl: "https://swaggerbot.test",
});
const gate: Pick<Gate, "dailyQuota" | "now"> = { dailyQuota: 100 };
const handler = createSwaggerbotMcpHandler({
  getApp: () => ({ db, lookup, keys: createKeys(db) }),
  gate,
});

const VERIFIED_AT = "2026-09-20T10:00:00.000Z";
const repo = createRepo(db);

/** Stores an Official Spec of the API; `confirmed` when a Verification confirmed it. */
function spec(apiId: string, confirmed: boolean): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: apiId, version: "1.0.0" },
      paths: {},
    }),
  );
  const { id } = repo.putSpec(apiId, bytes, {
    specVersion: "3.1.0",
    apiVersion: "1.0.0",
    format: "json",
  });
  if (confirmed) repo.confirmSpec(id, VERIFIED_AT);
  repo.addSource(id, `https://${apiId}.json`, "Official", VERIFIED_AT);
  return id;
}

repo.upsertVendor({
  id: "atlassian.com",
  name: "Atlassian",
  domain: "atlassian.com",
});
repo.upsertApi({
  id: "atlassian.com/jira",
  vendorId: "atlassian.com",
  name: "Jira",
});
repo.upsertApi({
  id: "atlassian.com/confluence",
  vendorId: "atlassian.com",
  name: "Confluence",
});
repo.rememberName("jira cloud platform rest", "atlassian.com/jira");
const jiraSpec = spec("atlassian.com/jira", true);
spec("atlassian.com/confluence", false);
repo.upsertVendor({ id: "acme.com", name: "Acme", domain: "acme.com" });
repo.upsertVendor({ id: "acme.io", name: "acme.io", domain: "acme.io" });

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: {
    vendor: { id: string };
    apis: { api: { id: string }; currentSpec: { id: string } | null }[];
  };
};

/** One `tools/call` of `list_vendor_apis`, as a stateless client sends it. */
async function listVendorApis(args: object): Promise<ToolResult> {
  const response = await handler.fetch(
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
        params: { name: "list_vendor_apis", arguments: args },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  const data = text.startsWith("{") ? text : /^data: (.*)$/m.exec(text)?.[1];
  if (!data) throw new Error(`no JSON-RPC message in ${text}`);
  const message = JSON.parse(data);
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result;
}

describe("list_vendor_apis", () => {
  it.each([
    ["an API name", "Jira"],
    ["a domain", "atlassian.com"],
    ["a remembered name's first words", "Jira Cloud"],
  ])("lists one Vendor's APIs by %s", async (_, vendor) => {
    const result = await listVendorApis({ vendor });

    const guidance = expectGuided(result, ListVendorApisOutput);
    expect(result.structuredContent?.vendor.id).toBe("atlassian.com");
    expect(
      result.structuredContent?.apis.map((a) => [a.api.id, a.currentSpec?.id]),
    ).toEqual([
      ["atlassian.com/confluence", undefined],
      ["atlassian.com/jira", jiraSpec],
    ]);
    expect(guidance).toEqual({
      summary: [
        "Atlassian (atlassian.com) has 2 APIs in the Index:",
        '- Confluence, apiId "atlassian.com/confluence": no confirmed Spec in the Index yet.',
        `- Jira, apiId "atlassian.com/jira": Current Spec ${jiraSpec}, API Version 1.0.0, Official Provenance. Download the Spec: https://swaggerbot.test/api/specs/${jiraSpec}/published (Published Form, as the Vendor serves it) or https://swaggerbot.test/api/specs/${jiraSpec}/normalized (Normalized Form, still being built: retry it in a few seconds).`,
      ].join("\n"),
      next: ['get_spec_outline(apiId: "atlassian.com/jira")'],
    });
  });

  it("lists several Vendors as an error, to retry with an id", async () => {
    const result = await listVendorApis({ vendor: "Acme" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      'Several Vendors match: "acme.com" (Acme), "acme.io". Next: list_vendor_apis again with one of these ids as vendor.',
    );
  });

  it("points to lookup_api when no Vendor matches", async () => {
    const result = await listVendorApis({ vendor: "unknown.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(
      /^No Vendor "unknown\.com" in the Index\. .*Next: lookup_api\(name\)/,
    );
  });

  it("refuses a blank vendor as a tool error, not a protocol error", async () => {
    const result = await listVendorApis({ vendor: "  " });

    expect(result.isError).toBe(true);
  });
});

describe("vendorApisGuidance", () => {
  it("names no placeholder call for a Vendor with no APIs, and says how to add one", () => {
    const { summary, next } = vendorApisGuidance({
      vendor: { id: "twilio.dev", name: "Twilio Dev", domain: "twilio.dev" },
      apis: [],
    });

    expect(next).toEqual([]);
    expect(summary).toBe(
      "Twilio Dev (twilio.dev) has 0 APIs in the Index. lookup_api with the name of the API you want finds it and adds it, with its Vendor, to the Index.",
    );
  });
});
