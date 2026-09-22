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

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

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
