import { z } from "zod";
import { SearchError, type SearchResult, type WebSearch } from "./web-search";

export const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/** Brave rejects a `count` above 20. */
const MAX_COUNT = 20;

export interface BraveOptions {
  apiKey: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

const BraveResponse = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          url: z.string(),
          title: z.string().default(""),
          description: z.string().default(""),
        }),
      ),
    })
    .optional(),
});

/** Brave's Web Search API. 8 s timeout, one retry on 429/5xx. */
export function createBraveSearch({
  apiKey,
  timeoutMs = 8000,
  retryDelayMs = 1000,
  fetch: fetchImpl = fetch,
}: BraveOptions): WebSearch {
  async function attempt(url: URL): Promise<Response> {
    try {
      return await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new SearchError(
        timedOut
          ? `Brave search timed out after ${timeoutMs} ms`
          : "Brave search request failed",
        "brave",
        undefined,
        { cause },
      );
    }
  }

  return {
    async search(query, { count }) {
      const url = new URL(BRAVE_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(Math.min(count, MAX_COUNT)));

      let res = await attempt(url);
      if (retryable(res.status)) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        res = await attempt(url);
      }
      if (!res.ok)
        throw new SearchError(
          `Brave search failed with HTTP ${res.status}`,
          "brave",
          res.status,
        );

      const parsed = BraveResponse.safeParse(
        await res.json().catch(() => null),
      );
      if (!parsed.success)
        throw new SearchError(
          "Brave search returned an unexpected body",
          "brave",
          res.status,
          {
            cause: parsed.error,
          },
        );

      return (parsed.data.web?.results ?? []).slice(0, count).map(
        (r): SearchResult => ({
          url: r.url,
          title: stripHtml(r.title),
          snippet: stripHtml(r.description),
        }),
      );
    },
  };
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Brave highlights matches with `<strong>` and escapes entities. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
