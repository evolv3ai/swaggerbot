import { createBraveSearch } from "./brave";
import type { WebSearch } from "./web-search";

export type { SearchOptions, SearchResult, WebSearch } from "./web-search";
export { SearchError } from "./web-search";

export const SEARCH_PROVIDERS = ["brave"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export interface CreateWebSearchOptions {
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
}

/**
 * The WebSearch named by `SEARCH_PROVIDER` (default `brave`). Returns `null`,
 * with one warning, when that provider's key is missing, so the Lookup skips
 * the portal step instead of failing. An unknown provider is a config error.
 */
export function createWebSearch({
  env = process.env,
  warn = console.warn,
}: CreateWebSearchOptions = {}): WebSearch | null {
  const provider = env.SEARCH_PROVIDER?.trim().toLowerCase() || "brave";
  switch (provider) {
    case "brave": {
      const apiKey = env.BRAVE_API_KEY?.trim();
      if (!apiKey) {
        warn(
          "BRAVE_API_KEY is not set: web search is off and Lookups skip the Developer Portal step.",
        );
        return null;
      }
      return createBraveSearch({ apiKey });
    }
    default:
      throw new Error(
        `Unknown SEARCH_PROVIDER "${provider}"; expected one of: ${SEARCH_PROVIDERS.join(", ")}`,
      );
  }
}
