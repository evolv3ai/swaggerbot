// Live smoke test for web search and portal finding (needs BRAVE_API_KEY).
// Usage: pnpm tsx scripts/search-smoke.ts "twilio"
import { findPortalCandidates } from "../src/sources/portal";
import { createWebSearch } from "../src/sources/web-search";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env: rely on the environment.
}

const name = process.argv[2];
if (!name) {
  console.error('usage: pnpm tsx scripts/search-smoke.ts "<name>"');
  process.exit(2);
}

const search = createWebSearch();
if (!search) process.exit(1);

const candidates = await findPortalCandidates(name, search);
console.log(JSON.stringify(candidates, null, 2));
