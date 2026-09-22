import { describe, expect, it, vi } from "vitest";
import { createTavilySearch, TAVILY_ENDPOINT } from "./tavily";
import { SearchError } from "./web-search";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const body = {
  query: "twilio API",
  results: [
    {
      url: "https://www.twilio.com/docs/usage/api",
      title: "Twilio API reference",
      content: "Build with Twilio & friends",
      score: 0.92,
      raw_content: null,
    },
    { url: "https://example.com/", title: "Example", content: "", score: 0.1 },
  ],
  response_time: 1.2,
};

describe("createTavilySearch", () => {
  it("POSTs the query, basic depth, max_results and a bearer key", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(body),
    );
    const search = createTavilySearch({ apiKey: "tvly-123", fetch });

    await search.search("twilio API", { count: 8 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(TAVILY_ENDPOINT);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tvly-123");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "twilio API",
      search_depth: "basic",
      max_results: 8,
      include_raw_content: false,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("caps max_results at Tavily's maximum of 20", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(body),
    );
    await createTavilySearch({ apiKey: "k", fetch }).search("q", { count: 50 });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).max_results).toBe(
      20,
    );
  });

  it("maps results to url, title and content as the snippet", async () => {
    const search = createTavilySearch({
      apiKey: "k",
      fetch: async () => json(body),
    });

    expect(await search.search("twilio", { count: 8 })).toEqual([
      {
        url: "https://www.twilio.com/docs/usage/api",
        title: "Twilio API reference",
        snippet: "Build with Twilio & friends",
      },
      { url: "https://example.com/", title: "Example", snippet: "" },
    ]);
  });

  it("returns no results when the response has none", async () => {
    const search = createTavilySearch({
      apiKey: "k",
      fetch: async () => json({ query: "zzz" }),
    });
    expect(await search.search("zzz", { count: 8 })).toEqual([]);
  });

  it("throws a SearchError on an unexpected body", async () => {
    const search = createTavilySearch({
      apiKey: "k",
      fetch: async () => json({ results: "nope" }),
    });
    await expect(search.search("q", { count: 8 })).rejects.toMatchObject({
      name: "SearchError",
      provider: "tavily",
    });
  });

  it("retries once on 429 and succeeds", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json(body));
    const search = createTavilySearch({ apiKey: "k", fetch, retryDelayMs: 0 });

    expect(await search.search("q", { count: 8 })).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries once on 5xx, then throws a SearchError", async () => {
    const fetch = vi.fn(async () => json({}, 500));
    const search = createTavilySearch({ apiKey: "k", fetch, retryDelayMs: 0 });

    const err = await search.search("q", { count: 8 }).catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err).toMatchObject({ provider: "tavily", status: 500 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 4xx, such as a plan limit", async () => {
    const fetch = vi.fn(async () => json({}, 432));
    const search = createTavilySearch({ apiKey: "k", fetch, retryDelayMs: 0 });

    await expect(search.search("q", { count: 8 })).rejects.toMatchObject({
      name: "SearchError",
      status: 432,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws a SearchError when the request times out", async () => {
    const fetch = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const search = createTavilySearch({ apiKey: "k", fetch, timeoutMs: 20 });

    const err = await search.search("q", { count: 8 }).catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err.message).toMatch(/timed out after 20 ms/);
  });
});
