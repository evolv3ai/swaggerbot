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
  /**
   * The website on a GitHub org's (or user's) profile, as written there
   * (`https://render.com`, `slack.com`); `null` when it has none or GitHub
   * can't say.
   */
  orgWebsite(org: string): Promise<string | null>;
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

const ProfileResponse = z.object({ blog: z.string().nullish() });

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
 * GitHub's repo metadata, from `GET /repos/{owner}/{repo}`, and an org's
 * website, from `GET /users/{org}`, cached in memory for 24 h. Any failure is
 * `null`; a rate limit (403/429), another error status or a network error is
 * also warned about, once per instance.
 */
export function createGitHubRepos({
  fetchJson = defaultFetchJson,
  token,
  ttlHours = 24,
  warn = console.warn,
}: GitHubReposOptions = {}): GitHubRepos {
  const ttlMs = ttlHours * 3_600_000;
  const cache = new Map<string, { at: number; info: RepoInfo }>();
  const websites = new Map<string, { at: number; website: string | null }>();
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    warn(
      `GitHub: ${message}; raw.githubusercontent.com Sources are fetched unchecked while it fails.`,
    );
  };

  const headers = githubHeaders(token);

  /** The 200 response's body, or `null`: a 404 quietly, anything else after warning. */
  async function get(url: string): Promise<{ body: unknown } | null> {
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
    return { body: res.body };
  }

  return {
    async orgWebsite(org) {
      const key = org.toLowerCase();
      const cached = websites.get(key);
      if (cached && Date.now() - cached.at < ttlMs) return cached.website;

      const res = await get(`${GITHUB_API}/users/${encodeURIComponent(org)}`);
      if (!res) return null;
      const parsed = ProfileResponse.safeParse(res.body);
      if (!parsed.success) return null;
      const website = parsed.data.blog?.trim() || null;
      websites.set(key, { at: Date.now(), website });
      return website;
    },

    async repoInfo(owner, repo) {
      const key = `${owner}/${repo}`.toLowerCase();
      const cached = cache.get(key);
      if (cached && Date.now() - cached.at < ttlMs) return cached.info;

      const res = await get(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      );
      if (!res) return null;
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
  /** Repos in an org that look like they hold a Spec, best first; `null` on failure. */
  searchSpecRepos(org: string, name: string): Promise<string[] | null>;
  /** Spec-looking files at the top of a repo, from its tree; `null` on failure. */
  specsInRepo(fullName: string): Promise<SpecHit[] | null>;
  /**
   * The orgs (lowercased) a search found don't exist: GitHub answers a search
   * with an `org:` qualifier naming no org (or a user) with HTTP 422, which
   * `searchSpecs` and `searchSpecRepos` return as no hits, `[]`.
   */
  missingOrgs(): string[];
};

export type GitHubCodeSearchOptions = {
  fetchJson?: FetchJson;
  /** `GITHUB_TOKEN`: required, as GitHub refuses code search unauthenticated. */
  token?: string;
  /** Minimum spacing between code searches. Default 6 s: GitHub allows 10 a minute. */
  minIntervalMs?: number;
  /** Minimum spacing between repository searches. Default 2 s: GitHub allows 30 a minute. */
  minRepoIntervalMs?: number;
  /** Where `specsInRepo` learns a repo's default branch; by default a `createGitHubRepos` on the same `fetchJson` and token. */
  repos?: GitHubRepos;
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

const RepoSearchResponse = z.object({
  items: z.array(z.object({ full_name: z.string() })),
});

const TreeResponse = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
  truncated: z.boolean().optional(),
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
/** GitHub's code search ranks by relevance, not by file type, so a full page is fetched and filtered. */
const PER_PAGE = 100;
const MAX_HITS = 10;
const MAX_REPOS = 5;
/** How deep in a repo's tree a Spec is looked for: `a/b/openapi.json` is 3. */
const MAX_TREE_DEPTH = 3;
const SPEC_BASENAME = /openapi|swagger|api/i;
const RATE_LIMIT_PAUSE_MS = 60_000;
/** A search's answer when GitHub says its `org:` names no org (HTTP 422). */
const NO_SUCH_ORG = Symbol("no such org");

function looksLikeSpec(path: string): boolean {
  return (
    SPEC_EXTENSION.test(path) &&
    !path
      .split("/")
      .some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()))
  );
}

function specHit(fullName: string, path: string): SpecHit {
  return {
    fullName,
    path,
    url: `https://raw.githubusercontent.com/${fullName}/HEAD/${path}`,
  };
}

/** One GitHub search API's own rate limit: its spacing and its pause. */
type SearchLimit = {
  intervalMs: number;
  nextSlot: number;
  blockedUntil: number;
};

/**
 * GitHub code search (`GET /search/code`) for Spec-looking files: `openapi`
 * in the path, a JSON or YAML extension, outside test, example and build
 * folders, at most 10 out of a page of 100. (`extension:json` works as a
 * qualifier; `filename:` and `path:` return nothing.) Code search doesn't
 * index large files, and Specs are often large, so two more ways in:
 * repository search (`GET /search/repositories`) for Spec-looking repos in an
 * org, and a repo's tree (`GET /repos/{fullName}/git/trees/{branch}`), which
 * lists a file whatever its size.
 *
 * Each search API is spaced on its own (`minIntervalMs`, `minRepoIntervalMs`),
 * and a rate limit (403/429) makes that API's searches `null` for the next
 * minute. Every failure is `null`, and the first is warned about, once per
 * instance. An HTTP 422 on a search in an org is no failure: the org doesn't
 * exist, so there are no hits, and `missingOrgs` names it.
 */
export function createGitHubCodeSearch({
  fetchJson = defaultFetchJson,
  token,
  minIntervalMs = 6_000,
  minRepoIntervalMs = 2_000,
  warn = console.warn,
  repos = createGitHubRepos({ fetchJson, token, warn }),
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
  const missing = new Set<string>();
  const codeLimit: SearchLimit = {
    intervalMs: minIntervalMs,
    nextSlot: 0,
    blockedUntil: 0,
  };
  const repoLimit: SearchLimit = {
    intervalMs: minRepoIntervalMs,
    nextSlot: 0,
    blockedUntil: 0,
  };

  /** Reserves the limit's next slot and waits for it. */
  async function waitTurn(limit: SearchLimit) {
    const at = Math.max(now(), limit.nextSlot);
    limit.nextSlot = at + limit.intervalMs;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  }

  /**
   * The 200 response's body, or `null` after warning; a rate limit also
   * pauses `limit`. With `org`, a 422 is `NO_SUCH_ORG`, recorded, unwarned.
   */
  async function get(
    url: string,
    limit: SearchLimit | null,
    org?: string,
  ): Promise<{ body: unknown } | typeof NO_SUCH_ORG | null> {
    let res: { status: number; body: unknown };
    try {
      res = await fetchJson(url, headers);
    } catch (error) {
      warnOnce(error instanceof Error ? error.message : String(error));
      return null;
    }
    if (res.status === 403 || res.status === 429) {
      if (limit) limit.blockedUntil = now() + RATE_LIMIT_PAUSE_MS;
      warnOnce(`rate-limited (HTTP ${res.status})`);
      return null;
    }
    if (res.status === 422 && org) {
      missing.add(org.toLowerCase());
      return NO_SUCH_ORG;
    }
    if (res.status !== 200) {
      warnOnce(`HTTP ${res.status}`);
      return null;
    }
    return { body: res.body };
  }

  /**
   * A search's parsed body, or `null`: no token, paused, failed or
   * unparsable; `NO_SUCH_ORG` when GitHub says `org` doesn't exist.
   */
  async function search<T>(
    url: string,
    limit: SearchLimit,
    schema: z.ZodType<T>,
    org: string | null,
  ): Promise<T | typeof NO_SUCH_ORG | null> {
    if (!token) {
      warnOnce("no GITHUB_TOKEN");
      return null;
    }
    if (now() < limit.blockedUntil) return null;
    await waitTurn(limit);
    const res = await get(url, limit, org ?? undefined);
    if (!res || res === NO_SUCH_ORG) return res;
    const parsed = schema.safeParse(res.body);
    if (!parsed.success) {
      warnOnce("unexpected response body");
      return null;
    }
    return parsed.data;
  }

  return {
    async searchSpecs(org, name) {
      const query = org
        ? `org:${org} openapi in:path`
        : `${name} openapi in:path`;
      const data = await search(
        `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}`,
        codeLimit,
        CodeSearchResponse,
        org,
      );
      if (data === NO_SUCH_ORG) return [];
      if (!data) return null;
      return data.items
        .filter((item) => looksLikeSpec(item.path))
        .slice(0, MAX_HITS)
        .map((item) => specHit(item.repository.full_name, item.path));
    },

    async searchSpecRepos(org, _name) {
      const query = `org:${org} openapi OR api-schemas OR api-spec`;
      const data = await search(
        `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&per_page=10`,
        repoLimit,
        RepoSearchResponse,
        org,
      );
      if (data === NO_SUCH_ORG) return [];
      if (!data) return null;
      return data.items.slice(0, MAX_REPOS).map((item) => item.full_name);
    },

    async specsInRepo(fullName) {
      const [owner, repo, ...rest] = fullName.split("/");
      if (!owner || !repo || rest.length > 0) return null;
      const info = await repos.repoInfo(owner, repo);
      if (!info) return null;

      const url = `${GITHUB_API}/repos/${info.fullName.split("/").map(encodeURIComponent).join("/")}/git/trees/${encodeURIComponent(info.defaultBranch)}?recursive=1`;
      const res = await get(url, null);
      if (!res || res === NO_SUCH_ORG) return null;
      const parsed = TreeResponse.safeParse(res.body);
      if (!parsed.success) {
        warnOnce("unexpected response body");
        return null;
      }
      if (parsed.data.truncated) {
        warn(
          `GitHub: the tree of ${info.fullName} is truncated; its Spec may be among the files left out.`,
        );
      }
      const paths = parsed.data.tree
        .filter(
          (entry) =>
            entry.type === "blob" &&
            entry.path.split("/").length <= MAX_TREE_DEPTH &&
            looksLikeSpec(entry.path),
        )
        .map((entry) => entry.path);
      const named = (path: string) =>
        SPEC_BASENAME.test(path.split("/").pop() ?? "");
      return [...paths.filter(named), ...paths.filter((path) => !named(path))]
        .slice(0, MAX_HITS)
        .map((path) => specHit(info.fullName, path));
    },

    missingOrgs() {
      return [...missing];
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
