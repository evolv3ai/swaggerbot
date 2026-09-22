import type { SearchOptions, SearchResult, WebSearch } from "./web-search";

/** A WebSearch for tests: returns canned results and records each call. */
export class FakeWebSearch implements WebSearch {
  readonly calls: { query: string; options: SearchOptions }[] = [];

  constructor(
    private readonly results:
      | SearchResult[]
      | ((query: string) => SearchResult[]) = [],
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    this.calls.push({ query, options });
    const results =
      typeof this.results === "function" ? this.results(query) : this.results;
    return results.slice(0, options.count);
  }
}
