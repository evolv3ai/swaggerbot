/** One result from a web search API. */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchOptions {
  /** How many results to ask for; a provider may return fewer. */
  count: number;
}

/** A web search API, used to find a Vendor's Developer Portal. */
export interface WebSearch {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

/** A search that failed after its retry: HTTP error, timeout or network. */
export class SearchError extends Error {
  override name = "SearchError";

  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
