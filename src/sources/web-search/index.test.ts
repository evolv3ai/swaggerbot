import { describe, expect, it, vi } from "vitest";
import { createWebSearch } from "./index";

describe("createWebSearch", () => {
  it("defaults to Brave when SEARCH_PROVIDER is unset", () => {
    const warn = vi.fn();
    const search = createWebSearch({ env: { BRAVE_API_KEY: "k" }, warn });
    expect(search).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("picks Brave when SEARCH_PROVIDER=brave", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ web: { results: [] } })),
      );
    try {
      const search = createWebSearch({
        env: { SEARCH_PROVIDER: "brave", BRAVE_API_KEY: "k" },
      });
      await search?.search("q", { count: 1 });
      expect(String(fetch.mock.calls[0]?.[0])).toMatch(
        /^https:\/\/api\.search\.brave\.com\//,
      );
    } finally {
      fetch.mockRestore();
    }
  });

  it("picks Tavily when SEARCH_PROVIDER=tavily", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    try {
      const search = createWebSearch({
        env: { SEARCH_PROVIDER: "Tavily", TAVILY_API_KEY: "k" },
      });
      await search?.search("q", { count: 1 });
      expect(String(fetch.mock.calls[0]?.[0])).toBe(
        "https://api.tavily.com/search",
      );
    } finally {
      fetch.mockRestore();
    }
  });

  it("wants TAVILY_API_KEY, not BRAVE_API_KEY, for Tavily", () => {
    const warn = vi.fn();
    expect(
      createWebSearch({
        env: { SEARCH_PROVIDER: "tavily", BRAVE_API_KEY: "k" },
        warn,
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/TAVILY_API_KEY/);
  });

  it("returns null and warns once when the key is missing", () => {
    const warn = vi.fn();
    expect(
      createWebSearch({ env: { SEARCH_PROVIDER: "brave" }, warn }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/BRAVE_API_KEY/);
  });

  it("treats a blank key as missing", () => {
    const warn = vi.fn();
    expect(createWebSearch({ env: { BRAVE_API_KEY: "  " }, warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      createWebSearch({ env: { SEARCH_PROVIDER: "bing", BRAVE_API_KEY: "k" } }),
    ).toThrow(/Unknown SEARCH_PROVIDER "bing"/);
  });
});
