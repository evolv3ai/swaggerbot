import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BenchmarkEntries } from "./entry";

async function loadEntries() {
  const path = new URL("../../benchmark/entries.json", import.meta.url);
  return BenchmarkEntries.parse(JSON.parse(await readFile(path, "utf8")));
}

describe("benchmark/entries.json seed", () => {
  it("has the seeded number of entries per group", async () => {
    const entries = await loadEntries();
    const count = (group: string) =>
      entries.filter((entry) => entry.group === group).length;
    expect({
      popular: count("popular"),
      longtail: count("longtail"),
      ambiguous: count("ambiguous"),
      negative: count("negative"),
    }).toEqual({ popular: 12, longtail: 12, ambiguous: 10, negative: 6 });
  });

  it("splits the negative group into NoSpec and Unknown", async () => {
    const negative = (await loadEntries()).filter(
      (entry) => entry.group === "negative",
    );
    const noSpec = negative.filter((entry) => entry.expected === "NoSpec");
    const unknown = negative.filter((entry) => entry.expected === "Unknown");
    expect(noSpec).toHaveLength(3);
    expect(unknown).toHaveLength(3);
    for (const entry of noSpec) expect(entry.apiId).toBeDefined();
  });

  it("gives every Resolved entry its specSources", async () => {
    const resolved = (await loadEntries()).filter(
      (entry) => entry.expected === "Resolved",
    );
    expect(resolved.length).toBeGreaterThan(0);
    for (const entry of resolved) {
      expect(entry.specSources?.length, entry.name).toBeGreaterThan(0);
    }
  });

  it("lists candidates for every Ambiguous entry", async () => {
    const ambiguous = (await loadEntries()).filter(
      (entry) => entry.expected === "Ambiguous",
    );
    for (const entry of ambiguous) {
      expect(entry.candidates?.length, entry.name).toBeGreaterThanOrEqual(2);
    }
  });

  it("leaves every entry unreviewed", async () => {
    for (const entry of await loadEntries()) {
      expect(entry.reviewed, entry.name).toBe(false);
    }
  });
});
