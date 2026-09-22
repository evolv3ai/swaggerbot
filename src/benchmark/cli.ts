import { parseArgs } from "node:util";
import { SEARCH_PROVIDERS, type SearchProvider } from "~/sources/web-search";
import type { BenchmarkReport } from "./score";

/** The options of `pnpm bench`, once validated. */
export type BenchOptions = {
  onlyReviewed: boolean;
  json: boolean;
  search?: SearchProvider;
  /** An Index to use instead of a fresh one; never deleted. */
  index?: string;
  /** Keep the fresh Index's temporary directory and print its path. */
  keepIndex: boolean;
};

export type ParsedBenchArgs =
  | { ok: true; options: BenchOptions }
  | { ok: false; error: string; exitCode: 2 };

/** Parses and validates the `pnpm bench` arguments without running anything. */
export function parseBenchArgs(args: string[]): ParsedBenchArgs {
  let values: {
    "only-reviewed"?: boolean;
    json?: boolean;
    search?: string;
    index?: string;
    "keep-index"?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        "only-reviewed": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        search: { type: "string" },
        index: { type: "string" },
        "keep-index": { type: "boolean", default: false },
      },
    }));
  } catch (err) {
    return { ok: false, error: (err as Error).message, exitCode: 2 };
  }

  const search = values.search;
  if (
    search !== undefined &&
    !(SEARCH_PROVIDERS as readonly string[]).includes(search)
  ) {
    return {
      ok: false,
      error: `--search must be one of: ${SEARCH_PROVIDERS.join(", ")} (got "${search}")`,
      exitCode: 2,
    };
  }
  if (values.index !== undefined && values["keep-index"]) {
    return {
      ok: false,
      error:
        "--index and --keep-index can't be used together (--index is never deleted)",
      exitCode: 2,
    };
  }
  if (values.index === "") {
    return { ok: false, error: "--index needs a path", exitCode: 2 };
  }

  return {
    ok: true,
    options: {
      onlyReviewed: values["only-reviewed"] ?? false,
      json: values.json ?? false,
      search: search as SearchProvider | undefined,
      index: values.index,
      keepIndex: values["keep-index"] ?? false,
    },
  };
}

/** The Index a Benchmark run used: a fresh temporary one, or one given with `--index`. */
export type BenchIndex = { path: string; fresh: boolean; kept: boolean };

/** The report header line naming the Index. */
export function indexLabel(index: BenchIndex): string {
  if (!index.fresh) return `Index: ${index.path}`;
  return index.kept
    ? `Index: kept at ${index.path}`
    : "Index: fresh (temporary)";
}

/** The report with the Index it was run against. */
export function withIndex(
  report: BenchmarkReport,
  index: BenchIndex,
): BenchmarkReport {
  return { ...report, indexPath: index.path, indexFresh: index.fresh };
}
