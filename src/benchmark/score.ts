import type { Outcome, OutcomeKind } from "~/domain/outcome";
import type { BenchmarkEntry, BenchmarkGroup } from "./entry";
import { type Latency, latencyOf } from "./latency";

/** What a Lookup answered for one Benchmark entry. */
export type BenchmarkAnswer = {
  name: string;
  outcome: Outcome;
  /** Set when the Lookup threw; `outcome` is then Unknown. */
  error?: string;
  /** How long the Lookup took, in milliseconds. */
  ms?: number;
};

/** One entry's answer in full, for diagnosing a failure after the run. */
export type BenchmarkEntryAnswer = {
  name: string;
  expected: OutcomeKind;
  /** The Outcome the Lookup returned, `diagnostics` included. */
  outcome: Outcome;
  ms?: number;
};

export type BenchmarkFailure = {
  name: string;
  expected: OutcomeKind;
  got: OutcomeKind;
  why: string;
};

export type GroupCounts = {
  entries: number;
  /** Answers whose Outcome equals `expected`. */
  correctOutcome: number;
  resolved: number;
  falseResolutions: number;
};

export type BenchmarkReport = {
  entries: number;
  resolved: number;
  falseResolutions: number;
  /** False Resolutions ÷ Resolved answers; 0 when there are none. */
  falseResolutionRate: number;
  /** Correct Resolved answers on `longtail` entries ÷ `longtail` entries expected Resolved; 0 when there are none. */
  longtailCoverage: number;
  /** Answers whose Outcome equals `expected` ÷ entries; 0 when there are none. */
  outcomeAccuracy: number;
  groups: Record<BenchmarkGroup, GroupCounts>;
  failures: BenchmarkFailure[];
  errors: { name: string; message: string }[];
  /** Every entry's answer, in entry order. */
  answers: BenchmarkEntryAnswer[];
  /**
   * How long the answers took, over those timed (`ms`): Discoveries, and with
   * `--index` answers from the Index as well.
   */
  latency: Latency;
  /** The Index the run used; set by `pnpm bench`, not by `score`. */
  indexPath?: string;
  /** Whether that Index started empty (a fresh temporary one) rather than given with `--index`. */
  indexFresh?: boolean;
};

/**
 * URL for comparison: lowercase host, `http` equal to `https`, no fragment,
 * no trailing slash. A string that isn't a URL is only trimmed.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  // URL already lowercases the host and drops default ports.
  const scheme = url.protocol === "http:" ? "https:" : url.protocol;
  const path = url.pathname.replace(/\/+$/, "");
  return `${scheme}//${url.host}${path}${url.search}`;
}

/** Why a Resolved answer is a False Resolution, or null when it is correct. */
function falseResolutionReason(
  entry: BenchmarkEntry,
  outcome: Extract<Outcome, { outcome: "Resolved" }>,
): string | null {
  if (!entry.apiId) {
    return `expected ${entry.expected}, but Resolved to ${outcome.api.id}`;
  }
  // API slugs are derived by the pipeline and never match the hand-made ones
  // in the Benchmark, so only the Vendor part of `apiId` is compared.
  const vendorId = entry.apiId.split("/")[0];
  if (outcome.vendor.id !== vendorId) {
    return `wrong Vendor: got ${outcome.vendor.id}, expected ${vendorId}`;
  }
  const expected = new Set((entry.specSources ?? []).map(normalizeUrl));
  if (!outcome.sources.some((s) => expected.has(normalizeUrl(s.url)))) {
    const got = outcome.sources.map((s) => s.url).join(", ");
    return `wrong Spec Source: ${got} is not in specSources`;
  }
  return null;
}

function emptyGroups(): Record<BenchmarkGroup, GroupCounts> {
  const counts = (): GroupCounts => ({
    entries: 0,
    correctOutcome: 0,
    resolved: 0,
    falseResolutions: 0,
  });
  return {
    popular: counts(),
    longtail: counts(),
    ambiguous: counts(),
    negative: counts(),
  };
}

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

/** Score Lookup answers against Benchmark entries, matched by name. Pure. */
export function score(
  entries: readonly BenchmarkEntry[],
  results: readonly BenchmarkAnswer[],
): BenchmarkReport {
  const byName = new Map(results.map((r) => [r.name, r]));
  const groups = emptyGroups();
  const failures: BenchmarkFailure[] = [];
  const errors: BenchmarkReport["errors"] = [];
  const answers: BenchmarkEntryAnswer[] = [];
  let resolved = 0;
  let falseResolutions = 0;
  let correctOutcomes = 0;
  let longtailExpected = 0;
  let longtailCorrect = 0;

  for (const entry of entries) {
    const answer: BenchmarkAnswer = byName.get(entry.name) ?? {
      name: entry.name,
      outcome: { outcome: "Unknown", name: entry.name },
      error: "no answer",
    };
    const got = answer.outcome.outcome;
    const group = groups[entry.group];
    group.entries++;
    if (answer.error) errors.push({ name: entry.name, message: answer.error });
    answers.push({
      name: entry.name,
      expected: entry.expected,
      outcome: answer.outcome,
      ...(answer.ms !== undefined ? { ms: answer.ms } : {}),
    });

    let why: string | null = null;
    if (answer.outcome.outcome === "Resolved") {
      resolved++;
      group.resolved++;
      why = falseResolutionReason(entry, answer.outcome);
      if (why) {
        falseResolutions++;
        group.falseResolutions++;
      }
    }

    const longtailResolved =
      entry.group === "longtail" && entry.expected === "Resolved";
    if (longtailResolved) longtailExpected++;

    if (got === entry.expected) {
      correctOutcomes++;
      group.correctOutcome++;
      if (longtailResolved && !why) longtailCorrect++;
    } else if (!why) {
      why = answer.error
        ? `lookup threw: ${answer.error}`
        : `expected ${entry.expected}, got ${got}`;
    }

    if (why) {
      failures.push({ name: entry.name, expected: entry.expected, got, why });
    }
  }

  return {
    entries: entries.length,
    resolved,
    falseResolutions,
    falseResolutionRate: ratio(falseResolutions, resolved),
    longtailCoverage: ratio(longtailCorrect, longtailExpected),
    outcomeAccuracy: ratio(correctOutcomes, entries.length),
    groups,
    failures,
    errors,
    answers,
    latency: latencyOf(answers.flatMap((a) => a.ms ?? [])),
  };
}
