import { parseArgs } from "node:util";
import type { ChatStats } from "./chat";

export const CHATSTATS_USAGE = `usage: pnpm tsx scripts/chatstats.ts [--since YYYY-MM-DD] [--json]   (built: node .output/cli/chatstats.mjs ...)
  Ask this Spec's turns in the Index at DATABASE_PATH: turns, people, tokens,
  refusals, errors and an estimated cost. --since counts from that UTC day.`;

/** When `CHAT_PRICES` was read from Anthropic's price list. */
export const CHAT_PRICES_READ_ON = "2026-10-06";

/** US dollars per million tokens, by model. */
export type ModelPrice = { input: number; cacheRead: number; output: number };

/**
 * Anthropic's first-party prices (read on `CHAT_PRICES_READ_ON`). Haiku
 * 5.5's cache-read price wasn't listed; it is taken as a tenth of input, as
 * for the others.
 */
export const CHAT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheRead: 0.01, output: 0.5 },
};

export type ChatstatsOptions = { since?: string; json: boolean };

export type ParsedChatstatsArgs =
  | { ok: true; options: ChatstatsOptions }
  | { ok: false; error: string; exitCode: 2 };

function fail(error: string): ParsedChatstatsArgs {
  return { ok: false, error, exitCode: 2 };
}

/** Parses and validates the `scripts/chatstats.ts` arguments without running anything. */
export function parseChatstatsArgs(args: string[]): ParsedChatstatsArgs {
  let values: { since?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        since: { type: "string" },
        json: { type: "boolean", default: false },
      },
    }));
  } catch (err) {
    return fail((err as Error).message);
  }
  const json = values.json ?? false;
  const since = values.since;
  if (since === undefined) return { ok: true, options: { json } };
  const day = new Date(`${since}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(since) ||
    Number.isNaN(day.getTime()) ||
    day.toISOString().slice(0, 10) !== since
  )
    return fail(`--since must be a day, YYYY-MM-DD (got "${since}")`);
  return { ok: true, options: { since, json } };
}

/** The dollars a model's tokens cost; undefined for a model without a price. */
export function costOf(
  model: string,
  tokens: { inputTokens: number; cachedTokens: number; outputTokens: number },
): number | undefined {
  const price = CHAT_PRICES[model];
  if (!price) return undefined;
  return (
    (tokens.inputTokens * price.input +
      tokens.cachedTokens * price.cacheRead +
      tokens.outputTokens * price.output) /
    1_000_000
  );
}

export type ChatReport = ChatStats & {
  since: string | null;
  /** The priced models' cost; models without a price are in `unpriced`. */
  estimatedCostUsd: number;
  unpriced: string[];
  pricesReadOn: string;
};

/** `stats` with its estimated cost. */
export function chatReportOf(stats: ChatStats, since?: string): ChatReport {
  let estimatedCostUsd = 0;
  const unpriced: string[] = [];
  for (const m of stats.byModel) {
    const cost = costOf(m.model, m);
    if (cost === undefined) unpriced.push(m.model);
    else estimatedCostUsd += cost;
  }
  return {
    since: since ?? null,
    ...stats,
    estimatedCostUsd,
    unpriced,
    pricesReadOn: CHAT_PRICES_READ_ON,
  };
}

function dollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

function columns(rows: string[][]): string[] {
  const widths = (rows[0] ?? []).map((_, i) =>
    Math.max(...rows.map((row) => row[i]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

/** The report as `chatstats` prints it without `--json`. */
export function formatChatReport(report: ChatReport): string {
  const lines = [
    `Ask this Spec turns ${report.since ? `since ${report.since} (UTC)` : "in the Index"}`,
    ...columns([
      ["turns", `${report.turns}`],
      ["people", `${report.people}`],
      ["input tokens", `${report.inputTokens}`],
      ["cached tokens", `${report.cachedTokens}`],
      ["output tokens", `${report.outputTokens}`],
      ["refusals", `${report.refusals}`],
      ["errors", `${report.errors}`],
      ["estimated cost", dollars(report.estimatedCostUsd)],
    ]),
  ];
  if (report.byModel.length > 0)
    lines.push(
      "",
      ...columns([
        ["model", "turns", "input", "cached", "output", "cost"],
        ...report.byModel.map((m) => {
          const cost = costOf(m.model, m);
          return [
            m.model,
            `${m.turns}`,
            `${m.inputTokens}`,
            `${m.cachedTokens}`,
            `${m.outputTokens}`,
            cost === undefined ? "no price" : dollars(cost),
          ];
        }),
      ]),
    );
  lines.push(
    "",
    `Prices per million tokens as read on ${report.pricesReadOn}; cache writes are counted at the input price.`,
  );
  if (report.unpriced.length > 0)
    lines.push(`Not in the cost: ${report.unpriced.join(", ")} (no price).`);
  return lines.join("\n");
}
