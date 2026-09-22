import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { USER_AGENT } from "~/fetch/fetcher";

export const GITHUB_API = "https://api.github.com";

/** What the Lookup needs to know about a GitHub repo holding a Spec Source. */
export type RepoInfo = {
  /** `owner/repo` as GitHub names it now, after a rename or transfer. */
  fullName: string;
  defaultBranch: string;
  archived: boolean;
};

export type GitHubRepos = {
  /** The repo's info, or `null` when GitHub can't say (missing, rate-limited, offline). */
  repoInfo(owner: string, repo: string): Promise<RepoInfo | null>;
};

/** A JSON GET; the body is `null` when the response has none. */
export type FetchJson = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: unknown }>;

export type GitHubReposOptions = {
  fetchJson?: FetchJson;
  /** `GITHUB_TOKEN`: optional, raises the rate limit from 60 to 5,000 an hour. */
  token?: string;
  ttlHours?: number;
  warn?: (message: string) => void;
};

const RepoResponse = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  archived: z.boolean(),
});

/** Follows redirects, so a moved repo answers with its new `full_name`. */
async function defaultFetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers, redirect: "follow" });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

function githubHeaders(token: string | undefined): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * GitHub's repo metadata, from `GET /repos/{owner}/{repo}`, cached in memory
 * for 24 h. Any failure is `null`; a rate limit (403/429), another error
 * status or a network error is also warned about, once per instance.
 */
export function createGitHubRepos({
  fetchJson = defaultFetchJson,
  token,
  ttlHours = 24,
  warn = console.warn,
}: GitHubReposOptions = {}): GitHubRepos {
  const ttlMs = ttlHours * 3_600_000;
  const cache = new Map<string, { at: number; info: RepoInfo }>();
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    warn(
      `GitHub: ${message}; raw.githubusercontent.com Sources are fetched unchecked while it fails.`,
    );
  };

  const headers = githubHeaders(token);

  return {
    async repoInfo(owner, repo) {
      const key = `${owner}/${repo}`.toLowerCase();
      const cached = cache.get(key);
      if (cached && Date.now() - cached.at < ttlMs) return cached.info;

      const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      let res: { status: number; body: unknown };
      try {
        res = await fetchJson(url, headers);
      } catch (error) {
        warnOnce(error instanceof Error ? error.message : String(error));
        return null;
      }
      if (res.status === 404) return null;
      if (res.status !== 200) {
        warnOnce(
          res.status === 403 || res.status === 429
            ? `rate-limited (HTTP ${res.status})`
            : `HTTP ${res.status}`,
        );
        return null;
      }
      const parsed = RepoResponse.safeParse(res.body);
      if (!parsed.success) return null;
      const info: RepoInfo = {
        fullName: parsed.data.full_name,
        defaultBranch: parsed.data.default_branch,
        archived: parsed.data.archived,
      };
      cache.set(key, { at: Date.now(), info });
      return info;
    },
  };
}

/** A Spec-looking file found by GitHub code search. */
export type SpecHit = {
  /** `owner/repo`. */
  fullName: string;
  /** The file's path in the repo. */
  path: string;
  /** The raw file on `HEAD`; the caller resolves the default branch through `repoInfo`. */
  url: string;
};

export type GitHubCodeSearch = {
  /**
   * Spec-looking files in an org, or across GitHub when `org` is null. `null`
   * when the search can't run: no token, rate-limited, or any other failure.
   */
  searchSpecs(org: string | null, name: string): Promise<SpecHit[] | null>;
};

export type GitHubCodeSearchOptions = {
  fetchJson?: FetchJson;
  /** `GITHUB_TOKEN`: required, as GitHub refuses code search unauthenticated. */
  token?: string;
  /** Minimum spacing between searches. Default 6 s: GitHub allows 10 a minute. */
  minIntervalMs?: number;
  warn?: (message: string) => void;
  /** Tests inject these to avoid waiting. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const CodeSearchResponse = z.object({
  items: z.array(
    z.object({
      path: z.string(),
      repository: z.object({ full_name: z.string() }),
    }),
  ),
});

const SPEC_EXTENSION = /\.(json|ya?ml)$/i;
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  "test",
  "tests",
  "fixture",
  "fixtures",
  "example",
  "examples",
  "vendor",
  "dist",
]);
const MAX_HITS = 10;
const RATE_LIMIT_PAUSE_MS = 60_000;

function looksLikeSpec(path: string): boolean {
  return (
    SPEC_EXTENSION.test(path) &&
    !path
      .split("/")
      .some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()))
  );
}

/**
 * GitHub code search (`GET /search/code`) for Spec-looking files: `openapi`
 * in the path, a JSON or YAML extension, outside test, example and build
 * folders, at most 10. Searches are spaced `minIntervalMs` apart; a rate limit
 * (403/429) makes every search `null` for the next minute. Every failure is
 * `null`, and the first is warned about, once per instance.
 */
export function createGitHubCodeSearch({
  fetchJson = defaultFetchJson,
  token,
  minIntervalMs = 6_000,
  warn = console.warn,
  sleep = (ms) => delay(ms),
  now = Date.now,
}: GitHubCodeSearchOptions = {}): GitHubCodeSearch {
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    warn(
      `GitHub code search: ${message}; the search is skipped while it fails.`,
    );
  };

  const headers = githubHeaders(token);
  let nextSlot = 0;
  let blockedUntil = 0;

  /** Reserves the next slot and waits for it. */
  async function waitTurn() {
    const at = Math.max(now(), nextSlot);
    nextSlot = at + minIntervalMs;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  }

  return {
    async searchSpecs(org, name) {
      if (!token) {
        warnOnce("no GITHUB_TOKEN");
        return null;
      }
      if (now() < blockedUntil) return null;

      const query = org
        ? `org:${org} openapi in:path`
        : `${name} openapi in:path`;
      const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=20`;
      await waitTurn();
      let res: { status: number; body: unknown };
      try {
        res = await fetchJson(url, headers);
      } catch (error) {
        warnOnce(error instanceof Error ? error.message : String(error));
        return null;
      }
      if (res.status === 403 || res.status === 429) {
        blockedUntil = now() + RATE_LIMIT_PAUSE_MS;
        warnOnce(`rate-limited (HTTP ${res.status})`);
        return null;
      }
      if (res.status !== 200) {
        warnOnce(`HTTP ${res.status}`);
        return null;
      }
      const parsed = CodeSearchResponse.safeParse(res.body);
      if (!parsed.success) {
        warnOnce("unexpected response body");
        return null;
      }
      return parsed.data.items
        .filter((item) => looksLikeSpec(item.path))
        .slice(0, MAX_HITS)
        .map((item) => {
          const fullName = item.repository.full_name;
          return {
            fullName,
            path: item.path,
            url: `https://raw.githubusercontent.com/${fullName}/HEAD/${item.path}`,
          };
        });
    },
  };
}

/** The parts of `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`. */
export type RawGitHubUrl = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
};

/**
 * Splits a raw.githubusercontent.com URL, or `null` for any other URL. A ref
 * written `refs/heads/<branch>` is read as the branch; any other ref is taken
 * to be one path segment.
 */
export function parseRawGitHubUrl(url: string): RawGitHubUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== "raw.githubusercontent.com")
    return null;
  const segments = parsed.pathname.split("/").slice(1);
  let [owner, repo, ref, ...rest] = segments;
  if (ref === "refs" && rest[0] === "heads") [, ref, ...rest] = rest;
  const path = rest.join("/");
  if (!owner || !repo || !ref || !path) return null;
  return { owner, repo, ref, path };
}

/** The same raw URL at another repo and ref: `{fullName}/{ref}/{path}`. */
export function rawGitHubUrl(
  url: string,
  fullName: string,
  ref: string,
  path: string,
): string {
  const parsed = new URL(url);
  parsed.pathname = `/${fullName}/${ref}/${path}`;
  return parsed.href;
}
