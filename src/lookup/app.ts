import { createFetcher } from "~/fetch/fetcher";
import { openDb } from "~/index-store/db";
import { createJudge } from "~/judge";
import { createApisGuru } from "~/sources/apis-guru";
import { createWebSearch } from "~/sources/web-search";
import { createLookup, type Lookup } from "./lookup";

/**
 * The Lookup with its real dependencies, configured from the environment:
 * the Index at `DATABASE_PATH`, the Jev judge (`TYPESAFE_API_KEY`, required),
 * APIs.guru, and the web search named by `SEARCH_PROVIDER` (skipped without
 * its key). Used by `POST /api/lookup` and `pnpm bench`.
 */
export function createAppLookup(env: NodeJS.ProcessEnv = process.env): Lookup {
  return createLookup({
    db: openDb(env.DATABASE_PATH || undefined),
    judge: createJudge(env),
    apisGuru: createApisGuru(),
    webSearch: createWebSearch({ env }),
    fetcher: createFetcher(),
  });
}
