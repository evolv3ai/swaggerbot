import { describe, expect, it } from "vitest";
import type { ChatStats } from "./chat";
import {
  CHAT_PRICES_READ_ON,
  chatReportOf,
  costOf,
  formatChatReport,
  parseChatstatsArgs,
} from "./chatstats-cli";

const EMPTY: ChatStats = {
  turns: 0,
  people: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  refusals: 0,
  errors: 0,
  byModel: [],
};

const SEEDED: ChatStats = {
  turns: 3,
  people: 2,
  inputTokens: 3_000_000,
  cachedTokens: 10_000_000,
  outputTokens: 200_000,
  refusals: 1,
  errors: 1,
  byModel: [
    {
      model: "claude-opus-5-5",
      turns: 2,
      inputTokens: 1_000_000,
      cachedTokens: 10_000_000,
      outputTokens: 100_000,
    },
    {
      model: "some-other-model",
      turns: 1,
      inputTokens: 2_000_000,
      cachedTokens: 0,
      outputTokens: 100_000,
    },
  ],
};

describe("parseChatstatsArgs", () => {
  it("reads --since and --json", () => {
    expect(parseChatstatsArgs([])).toEqual({
      ok: true,
      options: { json: false },
    });
    expect(parseChatstatsArgs(["--since", "2026-10-01", "--json"])).toEqual({
      ok: true,
      options: { since: "2026-10-01", json: true },
    });
    expect(parseChatstatsArgs(["--since=2026-02-28"])).toEqual({
      ok: true,
      options: { since: "2026-02-28", json: false },
    });
  });

  it("refuses a --since that isn't a day, and anything else", () => {
    for (const since of ["2026-10", "2026-02-30", "yesterday", "2026-1-01"])
      expect(parseChatstatsArgs(["--since", since])).toEqual({
        ok: false,
        error: `--since must be a day, YYYY-MM-DD (got "${since}")`,
        exitCode: 2,
      });
    expect(parseChatstatsArgs(["--until", "x"])).toMatchObject({
      ok: false,
      exitCode: 2,
    });
    expect(parseChatstatsArgs(["extra"])).toMatchObject({
      ok: false,
      exitCode: 2,
    });
  });
});

describe("the chatstats report", () => {
  it("prices a model's tokens per million, and knows no price for others", () => {
    // 1M input at $4, 10M cached at $0.20, 0.1M output at $20.
    expect(costOf("claude-opus-5-5", SEEDED.byModel[0] ?? EMPTY)).toBeCloseTo(
      8,
    );
    expect(costOf("some-other-model", SEEDED)).toBeUndefined();
  });

  it("prints an empty report", () => {
    const report = chatReportOf(EMPTY);
    expect(report).toMatchObject({
      since: null,
      turns: 0,
      estimatedCostUsd: 0,
      unpriced: [],
      pricesReadOn: CHAT_PRICES_READ_ON,
    });
    expect(formatChatReport(report)).toBe(
      [
        "Ask this Spec turns in the Index",
        "turns           0",
        "people          0",
        "input tokens    0",
        "cached tokens   0",
        "output tokens   0",
        "refusals        0",
        "errors          0",
        "estimated cost  $0.00",
        "",
        `Prices per million tokens as read on ${CHAT_PRICES_READ_ON}; cache writes are counted at the input price.`,
      ].join("\n"),
    );
  });

  it("reports seeded turns by model, leaving unpriced models out of the cost", () => {
    const report = chatReportOf(SEEDED, "2026-10-01");
    expect(report.estimatedCostUsd).toBeCloseTo(8);
    expect(report.unpriced).toEqual(["some-other-model"]);
    const text = formatChatReport(report);
    expect(text).toContain("Ask this Spec turns since 2026-10-01 (UTC)");
    expect(text).toContain("estimated cost  $8.00");
    expect(text).toContain(
      "claude-opus-5-5   2      1000000  10000000  100000  $8.00",
    );
    expect(text).toContain(
      "some-other-model  1      2000000  0         100000  no price",
    );
    expect(text).toContain("Not in the cost: some-other-model (no price).");
  });
});
