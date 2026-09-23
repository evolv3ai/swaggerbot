import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createJudge } from "~/judge";
import { createApisGuru } from "~/sources/apis-guru";
import { crawlForSpecs } from "~/sources/crawl";
import { createGitHubCodeSearch, createGitHubRepos } from "~/sources/github";
import { createWebSearch } from "~/sources/web-search";
import { createLookup, type Lookup } from "./lookup";

/**
 * The Lookup with its real dependencies, configured from the environment:
 * the Index at `DATABASE_PATH`, the Jev judge (`TYPESAFE_API_KEY`, required),
 * APIs.guru, the web search named by `SEARCH_PROVIDER` (skipped without
 * its key), GitHub's repo metadata and code search (`GITHUB_SEARCH_TOKEN`,
 * optional; code search is skipped without it), and the Developer Portal
 * crawl over the same fetcher and Judge; `LOOKUP_TRACE=1` adds the Spec
 * step's trace to `diagnostics` and each step's time as `timings`. Used by
 * `POST /api/lookup` and `pnpm bench`.
 */
export function createAppLookup(env: NodeJS.ProcessEnv = process.env): Lookup {
  const judge = createJudge(env);
  const fetcher = createFetcher();
  // Not `GITHUB_TOKEN`: tools run in this repo (weawr, `gh`) read that name
  // from `.env` as their own credential. Still accepted as a fallback.
  const token =
    env.GITHUB_SEARCH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim() || undefined;
  const github = createGitHubRepos({ token });
  return createLookup({
    db: openDb(env.DATABASE_PATH || undefined),
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
  });
}
