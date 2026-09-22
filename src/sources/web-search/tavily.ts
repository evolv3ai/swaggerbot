import { z } from "zod";
import { SearchError, type SearchResult, type WebSearch } from "./web-search";

export const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/** Tavily rejects a `max_results` above 20. */
const MAX_COUNT = 20;

export interface TavilyOptions {
  apiKey: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

const TavilyResponse = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().default(""),
        content: z.string().default(""),
      }),
    )
    .default([]),
});

/** Tavily's Search API. 8 s timeout, one retry on 429/5xx. */
export function createTavilySearch({
  apiKey,
  timeoutMs = 8000,
  retryDelayMs = 1000,
  fetch: fetchImpl = fetch,
}: TavilyOptions): WebSearch {
  async function attempt(body: string): Promise<Response> {
    try {
      return await fetchImpl(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new SearchError(
        timedOut
          ? `Tavily search timed out after ${timeoutMs} ms`
          : "Tavily search request failed",
        "tavily",
        undefined,
        { cause },
      );
    }
  }

  return {
    async search(query, { count }) {
      const body = JSON.stringify({
        query,
        search_depth: "basic",
        max_results: Math.min(count, MAX_COUNT),
        include_raw_content: false,
      });

      let res = await attempt(body);
      if (retryable(res.status)) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        res = await attempt(body);
      }
      if (!res.ok)
        throw new SearchError(
          `Tavily search failed with HTTP ${res.status}`,
          "tavily",
          res.status,
        );

      const parsed = TavilyResponse.safeParse(
        await res.json().catch(() => null),
      );
      if (!parsed.success)
        throw new SearchError(
          "Tavily search returned an unexpected body",
          "tavily",
          res.status,
          { cause: parsed.error },
        );

      return parsed.data.results.slice(0, count).map(
        (r): SearchResult => ({
          url: r.url,
          title: r.title,
          snippet: r.content,
        }),
      );
    },
  };
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}
