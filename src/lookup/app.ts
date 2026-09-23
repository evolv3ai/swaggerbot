import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createJudge } from "~/judge";
import { createApisGuru } from "~/sources/apis-guru";
import { crawlForSpecs } from "~/sources/crawl";
import { createGitHubCodeSearch, createGitHubRepos } from "~/sources/github";
import { createWebSearch } from "~/sources/web-search";
import { createLookup, type Lookup } from "./lookup";
import { DEFAULT_FRESHNESS_DAYS } from "./thresholds";
import { createVerifier, type Verifier } from "./verify";

/**
 * The Lookup with its real dependencies, configured from the environment:
 * the Index at `DATABASE_PATH`, the Jev judge (`TYPESAFE_API_KEY`, required),
 * APIs.guru, the web search named by `SEARCH_PROVIDER` (skipped without
 * its key), GitHub's repo metadata and code search (`GITHUB_SEARCH_TOKEN`,
 * optional; code search is skipped without it), and the Developer Portal
 * crawl over the same fetcher and Judge; `LOOKUP_TRACE=1` adds the Spec
 * step's trace to `diagnostics` and each step's time as `timings`; Stale
 * answers are those verified more than `FRESHNESS_DAYS` ago (default 7).
 * Used by `pnpm bench` and the scripts: it queues the Verifications of Stale
 * answers but starts no worker to run them (see `createApp`).
 */
export function createAppLookup(env: NodeJS.ProcessEnv = process.env): Lookup {
  return buildAppLookup(env).lookup;
}

/**
 * The app as the server runs it: `createAppLookup`'s Lookup, and the
 * background Verification worker over the same Lookup and Index, started.
 * Used by `POST /api/lookup`.
 */
export function createApp(env: NodeJS.ProcessEnv = process.env): {
  lookup: Lookup;
  verifier: Verifier;
} {
  const { lookup, db, freshnessDays } = buildAppLookup(env);
  const verifier = createVerifier({ db, lookup, freshnessDays });
  verifier.start();
  return { lookup, verifier };
}

/** `FRESHNESS_DAYS`, a positive number of days; unset, the default. */
export function freshnessDaysOf(env: NodeJS.ProcessEnv): number {
  const raw = env.FRESHNESS_DAYS?.trim();
  if (!raw) return DEFAULT_FRESHNESS_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0)
    throw new Error(
      `FRESHNESS_DAYS must be a positive number of days, not "${raw}"`,
    );
  return days;
}

function buildAppLookup(env: NodeJS.ProcessEnv) {
  const judge = createJudge(env);
  const fetcher = createFetcher();
  // Not `GITHUB_TOKEN`: tools run in this repo (weawr, `gh`) read that name
  // from `.env` as their own credential. Still accepted as a fallback.
  const token =
    env.GITHUB_SEARCH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim() || undefined;
  const github = createGitHubRepos({ token });
  const db = openDb(env.DATABASE_PATH || undefined);
  const freshnessDays = freshnessDaysOf(env);
  const lookup = createLookup({
    db,
    judge,
    apisGuru: createApisGuru(),
    webSearch: createWebSearch({ env }),
    fetcher,
    github,
    githubSearch: token
      ? createGitHubCodeSearch({ token, repos: github })
      : undefined,
    crawl: (opts) => crawlForSpecs({ ...opts, fetcher, judge }),
    trace: env.LOOKUP_TRACE === "1",
    freshnessDays,
  });
  return { lookup, db, freshnessDays };
}
