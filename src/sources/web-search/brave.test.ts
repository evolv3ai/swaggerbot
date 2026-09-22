import { describe, expect, it, vi } from "vitest";
import { BRAVE_ENDPOINT, createBraveSearch } from "./brave";
import { SearchError } from "./web-search";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const body = {
  web: {
    results: [
      {
        url: "https://www.twilio.com/docs/usage/api",
        title: "Twilio <strong>API</strong> reference",
        description: "Build with &quot;Twilio&quot; &amp; friends",
        extra_snippets: ["ignored"],
      },
      { url: "https://example.com/", title: "Example", description: "" },
    ],
  },
};

describe("createBraveSearch", () => {
  it("sends the query, count and subscription token", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
      json(body),
    );
    const search = createBraveSearch({ apiKey: "k-123", fetch });

    await search.search("twilio API", { count: 8 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    const sent = new URL(String(url));
    expect(`${sent.origin}${sent.pathname}`).toBe(BRAVE_ENDPOINT);
    expect(sent.searchParams.get("q")).toBe("twilio API");
    expect(sent.searchParams.get("count")).toBe("8");
    expect(init?.method ?? "GET").toBe("GET");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-subscription-token")).toBe("k-123");
    expect(headers.get("accept")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("caps count at Brave's maximum of 20", async () => {
    const fetch = vi.fn(async (_url: URL | RequestInfo) => json(body));
    await createBraveSearch({ apiKey: "k", fetch }).search("q", { count: 50 });
    expect(
      new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("count"),
    ).toBe("20");
  });

  it("maps web.results to url, title and plain-text snippet", async () => {
    const search = createBraveSearch({
      apiKey: "k",
      fetch: async () => json(body),
    });

    expect(await search.search("twilio", { count: 8 })).toEqual([
      {
        url: "https://www.twilio.com/docs/usage/api",
        title: "Twilio API reference",
        snippet: 'Build with "Twilio" & friends',
      },
      { url: "https://example.com/", title: "Example", snippet: "" },
    ]);
  });

  it("returns no results when the response has no web section", async () => {
    const search = createBraveSearch({
      apiKey: "k",
      fetch: async () => json({}),
    });
    expect(await search.search("zzz", { count: 8 })).toEqual([]);
  });

  it("retries once on 429 and succeeds", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json(body));
    const search = createBraveSearch({ apiKey: "k", fetch, retryDelayMs: 0 });

    expect(await search.search("q", { count: 8 })).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries once on 5xx, then throws a SearchError", async () => {
    const fetch = vi.fn(async () => json({}, 503));
    const search = createBraveSearch({ apiKey: "k", fetch, retryDelayMs: 0 });

    const err = await search.search("q", { count: 8 }).catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err).toMatchObject({ provider: "brave", status: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 4xx", async () => {
    const fetch = vi.fn(async () => json({}, 401));
    const search = createBraveSearch({ apiKey: "k", fetch, retryDelayMs: 0 });

    await expect(search.search("q", { count: 8 })).rejects.toMatchObject({
      name: "SearchError",
      status: 401,
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
    const search = createBraveSearch({ apiKey: "k", fetch, timeoutMs: 20 });

    const err = await search.search("q", { count: 8 }).catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err.message).toMatch(/timed out after 20 ms/);
  });
});
