import { describe, expect, it, vi } from "vitest";
import {
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
