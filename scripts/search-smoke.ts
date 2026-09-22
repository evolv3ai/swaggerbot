// Live smoke test for web search and portal finding (needs BRAVE_API_KEY,
// or TAVILY_API_KEY with --provider tavily).
// Usage: pnpm tsx scripts/search-smoke.ts [--provider brave|tavily] "twilio"
import { parseArgs } from "node:util";
import { findPortalCandidates } from "../src/sources/portal";
import { createWebSearch, SEARCH_PROVIDERS } from "../src/sources/web-search";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: rely on the environment.
}

const { values, positionals } = parseArgs({
  options: { provider: { type: "string" } },
  allowPositionals: true,
});

const name = positionals[0];
const provider = values.provider;
if (
  !name ||
  (provider !== undefined &&
    !(SEARCH_PROVIDERS as readonly string[]).includes(provider))
) {
  console.error(
    `usage: pnpm tsx scripts/search-smoke.ts [--provider ${SEARCH_PROVIDERS.join("|")}] "<name>"`,
  );
  process.exit(2);
}
if (provider) process.env.SEARCH_PROVIDER = provider;

const search = createWebSearch();
if (!search) process.exit(1);

const candidates = await findPortalCandidates(name, search);
console.log(JSON.stringify(candidates, null, 2));
