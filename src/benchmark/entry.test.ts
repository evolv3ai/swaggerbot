import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BenchmarkEntries, BenchmarkEntry } from "./entry";

const resolved = {
  name: "Stripe",
  group: "popular",
  expected: "Resolved",
  apiId: "stripe.com/stripe-api",
  specSources: ["https://example.com/openapi.json"],
  evidenceUrl: "https://example.com/docs",
  reviewed: false,
};

describe("benchmark/entries.json", () => {
  it("matches the entry schema", async () => {
    const path = new URL("../../benchmark/entries.json", import.meta.url);
    const json = JSON.parse(await readFile(path, "utf8"));
    const result = BenchmarkEntries.safeParse(json);
    expect(result.error?.issues).toBeUndefined();
    expect(result.data?.length).toBeGreaterThan(0);
  });
});

describe("BenchmarkEntry", () => {
  it("parses a Resolved entry", () => {
    expect(BenchmarkEntry.parse(resolved)).toEqual(resolved);
  });

  it.each([
    ["Resolved without apiId", { ...resolved, apiId: undefined }],
    ["Resolved without specSources", { ...resolved, specSources: undefined }],
    ["an unknown group", { ...resolved, group: "misc" }],
    ["an unknown expected Outcome", { ...resolved, expected: "NotFound" }],
    ["a bad evidenceUrl", { ...resolved, evidenceUrl: "not a url" }],
  ])("rejects %s", (_, value) => {
    expect(BenchmarkEntry.safeParse(value).success).toBe(false);
  });

  it("accepts an Unknown entry without apiId or specSources", () => {
    const unknown = {
      name: "nope",
      group: "negative",
      expected: "Unknown",
      evidenceUrl: "https://example.com/",
      reviewed: true,
    };
    expect(BenchmarkEntry.safeParse(unknown).success).toBe(true);
  });

  it("rejects duplicate names", () => {
    expect(BenchmarkEntries.safeParse([resolved, resolved]).success).toBe(
      false,
    );
  });
});
