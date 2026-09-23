import { describe, expect, it } from "vitest";
import { indexLabel, latencyLine, parseBenchArgs, withIndex } from "./cli";
import { score } from "./score";

describe("parseBenchArgs", () => {
  it("defaults to a fresh Index", () => {
    expect(parseBenchArgs([])).toEqual({
      ok: true,
      options: {
        onlyReviewed: false,
        json: false,
        search: undefined,
        index: undefined,
        keepIndex: false,
        concurrency: 4,
      },
    });
  });

  it("reads --concurrency", () => {
    const parsed = parseBenchArgs(["--concurrency", "2"]);
    expect(parsed.ok && parsed.options.concurrency).toBe(2);
    expect(parseBenchArgs(["--concurrency=1"])).toMatchObject({
      ok: true,
      options: { concurrency: 1 },
    });
  });

  it.each([["0"], ["x"], ["-1"], ["1.5"], [""]])(
    "rejects --concurrency %j, exit 2",
    (value) => {
      expect(parseBenchArgs(["--concurrency", value])).toMatchObject({
        ok: false,
        exitCode: 2,
      });
    },
  );

  it("reads --index and --keep-index", () => {
    const withPath = parseBenchArgs(["--index", "/tmp/a.db", "--json"]);
    expect(withPath.ok && withPath.options).toMatchObject({
      index: "/tmp/a.db",
      keepIndex: false,
      json: true,
    });
    const kept = parseBenchArgs(["--keep-index", "--only-reviewed"]);
    expect(kept.ok && kept.options).toMatchObject({
      index: undefined,
      keepIndex: true,
      onlyReviewed: true,
    });
  });

  it("rejects --index with --keep-index, exit 2", () => {
    const parsed = parseBenchArgs(["--index", "/tmp/a.db", "--keep-index"]);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("rejects an unknown --search provider and unknown flags, exit 2", () => {
    expect(parseBenchArgs(["--search", "bing"])).toMatchObject({
      ok: false,
      exitCode: 2,
    });
    expect(parseBenchArgs(["--nope"])).toMatchObject({
      ok: false,
      exitCode: 2,
    });
  });
});

describe("the Index in the report", () => {
  const report = score([], []);

  it("carries indexPath and indexFresh", () => {
    expect(
      withIndex(report, { path: "/tmp/x/index.db", fresh: true, kept: false }),
    ).toMatchObject({ indexPath: "/tmp/x/index.db", indexFresh: true });
    expect(
      withIndex(report, { path: "data/a.db", fresh: false, kept: true }),
    ).toMatchObject({ indexPath: "data/a.db", indexFresh: false });
  });

  it("prints latency in seconds, saying when answers came from the Index", () => {
    const timed = {
      ...report,
      latency: { count: 40, p50: 9800, p90: 31_234, max: 57_500 },
    };
    const fresh = { path: "/t/index.db", fresh: true, kept: false };
    expect(latencyLine(withIndex(timed, fresh))).toBe(
      "Latency (Discovery): p50 9.8 s · p90 31.2 s · max 57.5 s (n=40)",
    );
    const given = { path: "data/a.db", fresh: false, kept: true };
    expect(latencyLine(withIndex(timed, given))).toBe(
      "Latency (Discovery and Index): p50 9.8 s · p90 31.2 s · max 57.5 s (n=40)",
    );
  });

  it("names the Index in the header", () => {
    expect(indexLabel({ path: "/t/index.db", fresh: true, kept: false })).toBe(
      "Index: fresh (temporary)",
    );
    expect(indexLabel({ path: "/t/index.db", fresh: true, kept: true })).toBe(
      "Index: kept at /t/index.db",
    );
    expect(indexLabel({ path: "data/a.db", fresh: false, kept: true })).toBe(
      "Index: data/a.db",
    );
  });
});
