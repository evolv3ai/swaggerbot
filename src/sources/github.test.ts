import { describe, expect, it, vi } from "vitest";
import {
  createGitHubCodeSearch,
  createGitHubRepos,
  type FetchJson,
  parseRawGitHubUrl,
  rawGitHubUrl,
} from "./github";

const openaiRepo = {
  id: 1,
  full_name: "openai/openai-openapi",
  default_branch: "main",
  archived: false,
  private: false,
};

const answering = (status: number, body: unknown = null) =>
  vi.fn<FetchJson>(async () => ({ status, body }));

describe("createGitHubRepos", () => {
  it("maps GitHub's repo to its full name, default branch and archived flag", async () => {
    const fetchJson = answering(200, {
      ...openaiRepo,
      full_name: "AsanaArchive/developer-docs",
      default_branch: "master",
      archived: true,
    });
    const github = createGitHubRepos({ fetchJson });

    expect(await github.repoInfo("Asana", "developer-docs")).toEqual({
      fullName: "AsanaArchive/developer-docs",
      defaultBranch: "master",
      archived: true,
    });
    expect(fetchJson).toHaveBeenCalledWith(
      "https://api.github.com/repos/Asana/developer-docs",
      expect.objectContaining({ Accept: "application/vnd.github+json" }),
    );
  });

  it("caches a repo for 24 hours, whatever the case of its name", async () => {
    vi.useFakeTimers();
    try {
      const fetchJson = answering(200, openaiRepo);
      const github = createGitHubRepos({ fetchJson });

      await github.repoInfo("openai", "openai-openapi");
      await github.repoInfo("OpenAI", "openai-openapi");
      expect(fetchJson).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(24 * 3_600_000);
      await github.repoInfo("openai", "openai-openapi");
      expect(fetchJson).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the token as a Bearer header when set, and none otherwise", async () => {
    const withToken = answering(200, openaiRepo);
    await createGitHubRepos({
      fetchJson: withToken,
      token: "ghp_test",
    }).repoInfo("openai", "openai-openapi");
    expect(withToken.mock.calls[0]?.[1]).toMatchObject({
      Authorization: "Bearer ghp_test",
    });

    const without = answering(200, openaiRepo);
    await createGitHubRepos({ fetchJson: without }).repoInfo(
      "openai",
      "openai-openapi",
    );
    expect(without.mock.calls[0]?.[1]).not.toHaveProperty("Authorization");
  });

  it("is null on 403 and 429, warning once, and doesn't cache the failure", async () => {
    const warn = vi.fn();
    const fetchJson = answering(403, { message: "API rate limit exceeded" });
    const github = createGitHubRepos({ fetchJson, warn });

    expect(await github.repoInfo("openai", "openai-openapi")).toBeNull();
    fetchJson.mockResolvedValue({ status: 429, body: null });
    expect(await github.repoInfo("openai", "openai-openapi")).toBeNull();

    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/rate-limited \(HTTP 403\)/);
  });

  it("is null on a network error, warning once", async () => {
    const warn = vi.fn();
    const github = createGitHubRepos({
      fetchJson: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.github.com");
      },
      warn,
    });

    expect(await github.repoInfo("a", "b")).toBeNull();
    expect(await github.repoInfo("c", "d")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is null, without a warning, for a missing repo or an unexpected body", async () => {
    const warn = vi.fn();
    expect(
      await createGitHubRepos({ fetchJson: answering(404), warn }).repoInfo(
        "nobody",
        "nothing",
      ),
    ).toBeNull();
    expect(
      await createGitHubRepos({
        fetchJson: answering(200, { full_name: "x/y" }),
        warn,
      }).repoInfo("x", "y"),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

const hit = (fullName: string, path: string) => ({
  name: path.split("/").pop(),
  path,
  repository: { full_name: fullName },
});

/** A clock that only moves when the search sleeps. */
function fakeClock() {
  let time = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
    sleeps,
  };
}

const codeSearch = (
  fetchJson: FetchJson,
  extra: Parameters<typeof createGitHubCodeSearch>[0] = {},
) => {
  const clock = fakeClock();
  const warn = vi.fn();
  const search = createGitHubCodeSearch({
    fetchJson,
    token: "ghp_test",
    warn,
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  });
  return { search, clock, warn };
};

describe("createGitHubCodeSearch", () => {
  it("builds the org query and the global query, URL-encoded, 100 per page", async () => {
    const fetchJson = answering(200, { total_count: 0, items: [] });
    const { search } = codeSearch(fetchJson);

    expect(await search.searchSpecs("cloudflare", "Cloudflare API")).toEqual(
      [],
    );
    expect(await search.searchSpecs(null, "Cloudflare API")).toEqual([]);

    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/search/code?q=org%3Acloudflare%20openapi%20in%3Apath&per_page=100",
      "https://api.github.com/search/code?q=Cloudflare%20API%20openapi%20in%3Apath&per_page=100",
    ]);
    expect(fetchJson.mock.calls[0]?.[1]).toMatchObject({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer ghp_test",
    });
  });

  it("keeps only JSON and YAML files outside test, example and build folders", async () => {
    const { search } = codeSearch(
      answering(200, {
        items: [
          hit("cloudflare/api-schemas", "openapi.json"),
          hit("cloudflare/api-schemas", "openapi.yaml"),
          hit("cloudflare/api-schemas", "specs/openapi.YML"),
          hit("cloudflare/workers-sdk", "src/openapi.ts"),
          hit("cloudflare/cloudflare-docs", "content/openapi.mdx"),
          hit("cloudflare/workers-sdk", "node_modules/x/openapi.json"),
          hit("cloudflare/a", "test/openapi.json"),
          hit("cloudflare/a", "packages/tests/openapi.yaml"),
          hit("cloudflare/a", "Fixture/openapi.json"),
          hit("cloudflare/a", "fixtures/openapi.json"),
          hit("cloudflare/a", "example/openapi.json"),
          hit("cloudflare/a", "docs/examples/openapi.yaml"),
          hit("cloudflare/a", "vendor/openapi.json"),
          hit("cloudflare/a", "dist/openapi.json"),
          hit("cloudflare/a", "testing/openapi.json"),
        ],
      }),
    );

    expect(
      (await search.searchSpecs("cloudflare", "Cloudflare API"))?.map(
        (h) => h.path,
      ),
    ).toEqual([
      "openapi.json",
      "openapi.yaml",
      "specs/openapi.YML",
      "testing/openapi.json",
    ]);
  });

  it("caps the hits at 10", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      hit("box/box-openapi", `openapi/v${i}.json`),
    );
    const { search } = codeSearch(answering(200, { items }));

    const hits = await search.searchSpecs("box", "Box API");
    expect(hits).toHaveLength(10);
    expect(hits?.[9]?.path).toBe("openapi/v9.json");
  });

  it("finds a JSON hit below a first 20 that are all .ts", async () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) =>
        hit("cloudflare/cloudflare-docs", `src/openapi/page${i}.ts`),
      ),
      hit("cloudflare/cloudflare-docs", "src/content/openapi.json"),
    ];
    // Like GitHub, the stub serves only the page asked for.
    const { search } = codeSearch(async (url) => ({
      status: 200,
      body: {
        items: items.slice(
          0,
          Number(new URL(url).searchParams.get("per_page")),
        ),
      },
    }));

    expect(
      (await search.searchSpecs("cloudflare", "Cloudflare API"))?.map(
        (h) => h.path,
      ),
    ).toEqual(["src/content/openapi.json"]);
  });

  it("builds the raw URL on HEAD from the repo's full name and the path", async () => {
    const { search } = codeSearch(
      answering(200, {
        items: [hit("box/box-openapi", "openapi/openapi-v2026.0.json")],
      }),
    );

    expect(await search.searchSpecs("box", "Box API")).toEqual([
      {
        fullName: "box/box-openapi",
        path: "openapi/openapi-v2026.0.json",
        url: "https://raw.githubusercontent.com/box/box-openapi/HEAD/openapi/openapi-v2026.0.json",
      },
    ]);
  });

  it("is null without a token, warning once and making no request", async () => {
    const fetchJson = answering(200, { items: [] });
    const { search, warn } = codeSearch(fetchJson, { token: undefined });

    expect(await search.searchSpecs("box", "Box API")).toBeNull();
    expect(await search.searchSpecs(null, "Box API")).toBeNull();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/no GITHUB_TOKEN/);
  });

  it("is null on 403 and 429, warning once, and stays null for the rest of the minute", async () => {
    const fetchJson = answering(403, { message: "API rate limit exceeded" });
    const { search, clock, warn } = codeSearch(fetchJson);

    expect(await search.searchSpecs("box", "Box API")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/rate-limited \(HTTP 403\)/);

    clock.advance(30_000);
    expect(await search.searchSpecs(null, "Box API")).toBeNull();
    expect(fetchJson).toHaveBeenCalledTimes(1);

    clock.advance(30_000);
    fetchJson.mockResolvedValue({ status: 429, body: null });
    expect(await search.searchSpecs(null, "Box API")).toBeNull();
    expect(fetchJson).toHaveBeenCalledTimes(2);

    fetchJson.mockResolvedValue({ status: 200, body: { items: [] } });
    clock.advance(59_000);
    expect(await search.searchSpecs(null, "Box API")).toBeNull();
    clock.advance(1_000);
    expect(await search.searchSpecs(null, "Box API")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is null on another error status, a network error or an unparsable body", async () => {
    const { search: failing, warn } = codeSearch(answering(500));
    expect(await failing.searchSpecs("box", "Box API")).toBeNull();
    expect(await failing.searchSpecs("box", "Box API")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    const { search: offline } = codeSearch(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    expect(await offline.searchSpecs("box", "Box API")).toBeNull();

    const { search: garbled, warn: garbledWarn } = codeSearch(
      answering(200, { items: [{ path: "openapi.json" }] }),
    );
    expect(await garbled.searchSpecs("box", "Box API")).toBeNull();
    expect(garbledWarn).toHaveBeenCalledTimes(1);
    expect(
      await codeSearch(answering(200, null)).search.searchSpecs("box", "Box"),
    ).toBeNull();
  });

  it("spaces consecutive searches at least 6 s apart", async () => {
    const times: number[] = [];
    const clock = fakeClock();
    const search = createGitHubCodeSearch({
      fetchJson: async () => {
        times.push(clock.now());
        return { status: 200, body: { items: [] } };
      },
      token: "ghp_test",
      now: clock.now,
      sleep: clock.sleep,
    });

    await search.searchSpecs("box", "Box API");
    await search.searchSpecs(null, "Box API");
    clock.advance(10_000);
    await search.searchSpecs("asana", "Asana API");

    const start = 1_000_000;
    expect(times).toEqual([start, start + 6_000, start + 16_000]);
    expect(clock.sleeps).toEqual([6_000]);
  });
});

describe("searchSpecRepos", () => {
  const repoItems = (...names: string[]) => ({
    items: names.map((full_name) => ({ full_name })),
  });

  it("builds the repository query and returns full names in rank order, at most 5", async () => {
    const fetchJson = answering(
      200,
      repoItems("c/api-schemas", "c/a", "c/b", "c/c", "c/d", "c/e", "c/f"),
    );
    const { search } = codeSearch(fetchJson);

    expect(
      await search.searchSpecRepos("cloudflare", "Cloudflare API"),
    ).toEqual(["c/api-schemas", "c/a", "c/b", "c/c", "c/d"]);
    expect(fetchJson.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/search/repositories?q=org%3Acloudflare%20openapi%20OR%20api-schemas%20OR%20api-spec&per_page=10",
    );
    expect(fetchJson.mock.calls[0]?.[1]).toMatchObject({
      Authorization: "Bearer ghp_test",
    });
  });

  it("is null without a token, making no request", async () => {
    const fetchJson = answering(200, repoItems("c/a"));
    const { search, warn } = codeSearch(fetchJson, { token: undefined });

    expect(await search.searchSpecRepos("cloudflare", "Cloudflare")).toBeNull();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toMatch(/no GITHUB_TOKEN/);
  });

  it("is null on 403 and stays null for the rest of the minute", async () => {
    const fetchJson = answering(403, { message: "API rate limit exceeded" });
    const { search, clock } = codeSearch(fetchJson);

    expect(await search.searchSpecRepos("cloudflare", "Cloudflare")).toBeNull();
    clock.advance(59_000);
    expect(await search.searchSpecRepos("cloudflare", "Cloudflare")).toBeNull();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("is null on an unparsable body", async () => {
    const { search, warn } = codeSearch(
      answering(200, { items: [{ name: "api-schemas" }] }),
    );
    expect(await search.searchSpecRepos("cloudflare", "Cloudflare")).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toMatch(/unexpected response body/);
  });

  it("has its own rate-limit slot, apart from code search's", async () => {
    const times: Record<string, number[]> = { code: [], repos: [] };
    const clock = fakeClock();
    let rateLimitCode = false;
    const search = createGitHubCodeSearch({
      fetchJson: async (url) => {
        const kind = url.includes("/search/code") ? "code" : "repos";
        times[kind]?.push(clock.now());
        if (kind === "code" && rateLimitCode)
          return { status: 403, body: null };
        return { status: 200, body: { items: [] } };
      },
      token: "ghp_test",
      now: clock.now,
      sleep: clock.sleep,
      warn: () => {},
    });

    const start = 1_000_000;
    await search.searchSpecs("box", "Box API");
    await search.searchSpecRepos("box", "Box API");
    await search.searchSpecRepos("box", "Box API");
    expect(times.code).toEqual([start]);
    expect(times.repos).toEqual([start, start + 2_000]);

    // A code-search rate limit doesn't pause repository search.
    rateLimitCode = true;
    expect(await search.searchSpecs("box", "Box API")).toBeNull();
    expect(await search.searchSpecs("box", "Box API")).toBeNull();
    expect(times.code).toHaveLength(2);
    expect(await search.searchSpecRepos("box", "Box API")).toEqual([]);
    expect(times.repos).toHaveLength(3);
  });
});

describe("specsInRepo", () => {
  const blob = (path: string) => ({ path, type: "blob" });
  const tree = (
    entries: { path: string; type: string }[],
    truncated = false,
  ) => ({
    sha: "abc",
    tree: entries,
    truncated,
  });
  const box = {
    fullName: "box/box-openapi",
    defaultBranch: "main",
    archived: false,
  };
  const withRepos = (
    fetchJson: FetchJson,
    info: typeof box | null = box,
    extra: Parameters<typeof createGitHubCodeSearch>[0] = {},
  ) =>
    codeSearch(fetchJson, {
      repos: { repoInfo: async () => info },
      ...extra,
    });

  it("reads the default branch's tree and keeps Spec-looking blobs at most 3 deep", async () => {
    const fetchJson = answering(
      200,
      tree([
        blob("openapi.json"),
        blob("specs/v1/schema.yaml"),
        blob("specs/v1/deep/openapi.json"),
        blob("src/index.ts"),
        blob("test/openapi.json"),
        { path: "specs.json", type: "tree" },
      ]),
    );
    const { search } = withRepos(fetchJson, {
      ...box,
      fullName: "Box/Box-OpenAPI",
      defaultBranch: "release",
    });

    expect(await search.specsInRepo("box/box-openapi")).toEqual([
      {
        fullName: "Box/Box-OpenAPI",
        path: "openapi.json",
        url: "https://raw.githubusercontent.com/Box/Box-OpenAPI/HEAD/openapi.json",
      },
      {
        fullName: "Box/Box-OpenAPI",
        path: "specs/v1/schema.yaml",
        url: "https://raw.githubusercontent.com/Box/Box-OpenAPI/HEAD/specs/v1/schema.yaml",
      },
    ]);
    expect(fetchJson.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/Box/Box-OpenAPI/git/trees/release?recursive=1",
    );
  });

  it("works without a token", async () => {
    const fetchJson = answering(200, tree([blob("openapi.json")]));
    const { search } = withRepos(fetchJson, box, { token: undefined });

    expect(await search.specsInRepo("box/box-openapi")).toHaveLength(1);
  });

  it("puts openapi, swagger and api basenames first, then caps at 10", async () => {
    const others = Array.from({ length: 10 }, (_, i) =>
      blob(`data/d${i}.json`),
    );
    const { search } = withRepos(
      answering(
        200,
        tree([
          ...others,
          blob("v2/swagger.yaml"),
          blob("schemas/api.json"),
          blob("openapi.json"),
        ]),
      ),
    );

    const paths = (await search.specsInRepo("box/box-openapi"))?.map(
      (h) => h.path,
    );
    expect(paths).toEqual([
      "v2/swagger.yaml",
      "schemas/api.json",
      "openapi.json",
      ...others.slice(0, 7).map((b) => b.path),
    ]);
  });

  it("returns what a truncated tree has, with a warning", async () => {
    const { search, warn } = withRepos(
      answering(200, tree([blob("openapi.json")], true)),
    );

    expect(
      (await search.specsInRepo("box/box-openapi"))?.map((h) => h.path),
    ).toEqual(["openapi.json"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/truncated/));
  });

  it("is null when the repo is unknown, the tree fails or its body is unparsable", async () => {
    const unknown = answering(200, tree([blob("openapi.json")]));
    expect(
      await withRepos(unknown, null).search.specsInRepo("nobody/nothing"),
    ).toBeNull();
    expect(unknown).not.toHaveBeenCalled();

    expect(
      await withRepos(answering(404)).search.specsInRepo("box/box-openapi"),
    ).toBeNull();
    expect(
      await withRepos(answering(403)).search.specsInRepo("box/box-openapi"),
    ).toBeNull();
    expect(
      await withRepos(async () => {
        throw new Error("offline");
      }).search.specsInRepo("box/box-openapi"),
    ).toBeNull();
    expect(
      await withRepos(answering(200, { tree: "nope" })).search.specsInRepo(
        "box/box-openapi",
      ),
    ).toBeNull();
    expect(
      await withRepos(answering(200, tree([]))).search.specsInRepo(
        "not-a-repo",
      ),
    ).toBeNull();
  });
});

describe("parseRawGitHubUrl", () => {
  it("splits owner, repo, ref and path", () => {
    expect(
      parseRawGitHubUrl(
        "https://raw.githubusercontent.com/Asana/developer-docs/master/defs/asana_oas.yaml",
      ),
    ).toEqual({
      owner: "Asana",
      repo: "developer-docs",
      ref: "master",
      path: "defs/asana_oas.yaml",
    });
  });

  it("reads refs/heads/<branch> as the branch", () => {
    expect(
      parseRawGitHubUrl(
        "https://raw.githubusercontent.com/o/r/refs/heads/main/spec.yaml",
      ),
    ).toEqual({ owner: "o", repo: "r", ref: "main", path: "spec.yaml" });
  });

  it("is null for other hosts and for URLs without a path in the repo", () => {
    expect(parseRawGitHubUrl("https://github.com/o/r/blob/main/x")).toBeNull();
    expect(
      parseRawGitHubUrl("https://raw.githubusercontent.com/o/r/main"),
    ).toBeNull();
    expect(parseRawGitHubUrl("not a url")).toBeNull();
  });
});

describe("rawGitHubUrl", () => {
  it("moves a raw URL to another repo and ref, keeping its origin", () => {
    expect(
      rawGitHubUrl(
        "http://raw.githubusercontent.com:8080/openai/openai-openapi/master/openapi.yaml",
        "openai/openai-openapi",
        "main",
        "openapi.yaml",
      ),
    ).toBe(
      "http://raw.githubusercontent.com:8080/openai/openai-openapi/main/openapi.yaml",
    );
  });
});
