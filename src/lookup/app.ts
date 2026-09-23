import { createFetcher } from "~/fetch/fetcher";
import { type Db, openDb } from "~/index-store/db";
import { createKeys, type Keys } from "~/index-store/keys";
import { createJudge } from "~/judge";
import { createApisGuru } from "~/sources/apis-guru";
import { crawlForSpecs } from "~/sources/crawl";
import { createGitHubCodeSearch, createGitHubRepos } from "~/sources/github";
import { createWebSearch } from "~/sources/web-search";
import { createFormsWorker, type FormsWorker } from "~/spec-forms/worker";
import { createLookup, type IndexedLookup, type Lookup } from "./lookup";
import { DEFAULT_FRESHNESS_DAYS, SPEC_STEP_BUDGET_MS } from "./thresholds";
import { createVerifier, type Verifier } from "./verify";

/**
 * The Lookup with its real dependencies, configured from the environment:
 * the Index at `DATABASE_PATH`, the Jev judge (`TYPESAFE_API_KEY`, required),
 * APIs.guru, the web search named by `SEARCH_PROVIDER` (skipped without
 * its key), GitHub's repo metadata and code search (`GITHUB_SEARCH_TOKEN`,
 * optional; code search is skipped without it), and the Developer Portal
 * crawl over the same fetcher and Judge; `LOOKUP_TRACE=1` adds the Spec
 * step's trace to `diagnostics` and each step's time as `timings`; Stale
 * answers are those verified more than `FRESHNESS_DAYS` ago (default 7);
 * the Spec step's parallel Sources stop after `SPEC_STEP_BUDGET_MS`
 * (default 9000, `Infinity` for none).
 * Used by `pnpm bench` and the scripts: it queues the Verifications of Stale
 * answers but starts no worker to run them, and builds no Spec's forms
 * (see `createApp`).
 */
export function createAppLookup(env: NodeJS.ProcessEnv = process.env): Lookup {
  return buildAppLookup(env).lookup;
}

/**
 * The app as the server runs it: `createAppLookup`'s Lookup, the API keys
 * in the same Index, the background Verification worker over the same
 * Lookup and Index, and the worker that builds each Spec's forms over the
 * same Index and fetcher (ADR 0004), both started; and the Index itself,
 * which the download routes read. Built once per server by `getApp` in
 * `src/server/app-instance.ts`.
 */
export function createApp(env: NodeJS.ProcessEnv = process.env): {
  db: Db;
  lookup: IndexedLookup;
  keys: Keys;
  verifier: Verifier;
  formsWorker: FormsWorker;
} {
  const { lookup, db, fetcher, freshnessDays } = buildAppLookup(env);
  const verifier = createVerifier({ db, lookup, freshnessDays });
  verifier.start();
  const formsWorker = createFormsWorker({ db, fetcher, env });
  formsWorker.start();
  return { db, lookup, keys: createKeys(db), verifier, formsWorker };
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

/** `SPEC_STEP_BUDGET_MS`, a positive number of milliseconds or `Infinity`; unset, the default. */
export function specStepBudgetMsOf(env: NodeJS.ProcessEnv): number {
  const raw = env.SPEC_STEP_BUDGET_MS?.trim();
  if (!raw) return SPEC_STEP_BUDGET_MS;
  const ms = Number(raw);
  if (Number.isNaN(ms) || ms <= 0)
    throw new Error(
      `SPEC_STEP_BUDGET_MS must be a positive number of milliseconds or Infinity, not "${raw}"`,
    );
  return ms;
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
    specStepBudgetMs: specStepBudgetMsOf(env),
  });
  return { lookup, db, fetcher, freshnessDays };
}
