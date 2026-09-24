import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { SpecOutline } from "~/domain/spec-forms";
import { generatedOutline } from "~/spec-forms/__fixtures__/outline";
import type { OutlineAnswer } from "~/spec-forms/http";
import { MAX_RESULT_BYTES, outlineResult } from "./get-spec-outline";

const apiId = "example.com/generated-api";
const specId = "b".repeat(64);

function ready(outline: SpecOutline): OutlineAnswer {
  return {
    status: 200,
    body: {
      apiId,
      specId,
      specVersion: "3.1.0",
      normalized: "ready",
      outline,
      downloads: {
        published: `https://swaggerbot.dev/api/specs/${specId}/published`,
        normalized: `https://swaggerbot.dev/api/specs/${specId}/normalized`,
      },
    },
    headers: {},
  };
}

const textOf = (result: CallToolResult) =>
  result.content.map((c) => (c.type === "text" ? c.text : "")).join("");

/** What the 30 kB bound counts: `structuredContent` as JSON plus the text. */
const sizeOf = (result: CallToolResult) =>
  Buffer.byteLength(JSON.stringify(result.structuredContent ?? null)) +
  Buffer.byteLength(textOf(result));

const big = generatedOutline(4000, 600);

describe("outlineResult", () => {
  it.each([
    ["no filter", {}],
    ["a tag", { tag: "ZONE-SETTINGS-AND-RESOURCES-7" }],
    ["a query", { query: "resources-1" }],
    ["a cursor", { query: "resources", cursor: "200" }],
  ])(
    "stays under 30 kB on 4,000 operations and 600 tags with %s",
    (_, args) => {
      const result = outlineResult({ apiId, ...args }, ready(big));

      expect(result.isError).toBeUndefined();
      expect(sizeOf(result)).toBeLessThan(MAX_RESULT_BYTES);
    },
  );

  it("gives an unfiltered large Spec's tags and first page, and says to filter", () => {
    const result = outlineResult({ apiId }, ready(big));
    const page = result.structuredContent as {
      tags: unknown[];
      tagsCut?: true;
      operations: unknown[];
      totalOperations: number;
      nextCursor: string | null;
    };

    expect(page.tagsCut).toBe(true);
    expect(page.tags).toHaveLength(200);
    expect(page.operations.length).toBeGreaterThan(0);
    expect(page.operations.length).toBeLessThanOrEqual(100);
    expect(page.totalOperations).toBe(4000);
    expect(textOf(result)).toContain("Filter rather than page through them");
    expect(textOf(result)).toContain(
      `get_spec_outline(apiId: "${apiId}", tag: "`,
    );
    expect(textOf(result)).toContain(
      `get_operation(apiId: "${apiId}", method: "get"`,
    );
    expect(textOf(result)).toContain(`cursor: "${page.nextCursor}"`);
  });

  it("filters by tag and names the next page's call with the same filter", () => {
    const result = outlineResult(
      { apiId, tag: "ZONE-SETTINGS-AND-RESOURCES-1" },
      ready(generatedOutline(1000, 2)),
    );

    const page = result.structuredContent as {
      operations: unknown[];
      matchedOperations: number;
      nextCursor: string;
    };

    expect(page.matchedOperations).toBe(500);
    expect(page.nextCursor).toBe(String(page.operations.length));
    expect(textOf(result)).toContain(
      `operations 1–${page.nextCursor} of 500 matching tag "ZONE-SETTINGS-AND-RESOURCES-1" (of 1000 in all).`,
    );
    expect(textOf(result)).toContain(
      `get_spec_outline(apiId: "${apiId}", tag: "ZONE-SETTINGS-AND-RESOURCES-1", cursor: "${page.nextCursor}")`,
    );
  });

  it("filters by query, and on the last page names only get_operation", () => {
    const result = outlineResult(
      { apiId, query: "resources-12/" },
      ready(generatedOutline(200, 4)),
    );

    expect(textOf(result)).toBe(
      `Generated API (apiId "${apiId}"): operations 1–1 of 1 matching query "resources-12/" (of 200 in all). Next: get_operation(apiId: "${apiId}", method: "get", path: "/accounts/{account_id}/resources-12/{resource_id}/settings") for one of these operations.`,
    );
    expect(result.structuredContent).toMatchObject({
      nextCursor: null,
      matchedOperations: 1,
    });
  });

  it("carries the filter and specId into the next page's call", () => {
    const result = outlineResult(
      { apiId, specId, query: "settings" },
      ready(generatedOutline(250, 4)),
    );

    const { nextCursor } = result.structuredContent as { nextCursor: string };

    expect(textOf(result)).toContain(
      `get_spec_outline(apiId: "${apiId}", specId: "${specId}", query: "settings", cursor: "${nextCursor}")`,
    );
  });

  it("says when nothing matches, and names some tags", () => {
    const result = outlineResult(
      { apiId, query: "nothing-like-this" },
      ready(big),
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(
      /^Generated API \(apiId ".*"\): no operation matches query "nothing-like-this"/,
    );
    expect(textOf(result)).toContain('"zone-settings-and-resources-0"');
  });

  it("is an error for a bad cursor", () => {
    const result = outlineResult({ apiId, cursor: "abc" }, ready(big));

    expect(result.isError).toBe(true);
  });

  it("is an error saying to retry in 10 s while the Normalized Form is pending", () => {
    const result = outlineResult(
      { apiId },
      {
        status: 409,
        body: { status: "pending" },
        headers: { "retry-after": "10" },
      },
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("retry in 10 s");
  });

  it("is an error naming lookup_api for an API not in the Index", () => {
    const result = outlineResult(
      { apiId: "nope.com/nope-api" },
      {
        status: 404,
        body: {
          error: "The Index holds no API nope.com/nope-api.",
          hint: "POST /api/lookup",
        },
        headers: {},
      },
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("lookup_api(name)");
    expect(textOf(result)).not.toContain("POST /api/lookup");
  });
});

describe("outlineResult without tags", () => {
  it("says to filter by query only", () => {
    const untagged = { ...generatedOutline(150, 1), tags: [] };

    const text = textOf(outlineResult({ apiId }, ready(untagged)));

    expect(text).toContain("has 150 operations and no tags.");
    expect(text).toContain('query: "…"');
    expect(text).not.toContain("tag:");
  });
});
