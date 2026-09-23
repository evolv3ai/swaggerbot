import { setTimeout as sleep } from "node:timers/promises";
import { FetchError, type Fetcher, type FetchResult } from "~/fetch/fetcher";
import { type SniffResult, sniffSpec } from "~/fetch/sniff";
import type {
  ApiRef,
  Judge,
  SpecLink,
  VendorRef,
  YesNoJudgment,
} from "~/judge/judge";
import { registrableDomain } from "./domain";

export type CrawlHit = {
  /** Where the Spec was served from, after redirects. */
  url: string;
  bytes: Uint8Array;
  sniff: SniffResult;
  /** The page whose link led here. */
  linkedFrom: string;
  /** The link left the start URL's registrable domain. */
  offHost: boolean;
  /** The host's robots.txt disallowed this URL (ADR 0003). */
  robotsDisallowed: boolean;
};

/** A URL a crawl chose to fetch but couldn't, and why. */
export type CrawlFailure = {
  url: string;
  /** The fetch error, without its URL: `http-error: HTTP 429`. */
  reason: string;
};

export type CrawlResult = {
  hits: CrawlHit[];
  /**
   * The Spec candidates the crawl chose but couldn't fetch, after the retry
   * (WTR-86), in the order it tried them. The Lookup reports each one.
   */
  failed: CrawlFailure[];
  /**
   * Registrable domains linked from a crawled page but not crawled, since
   * the crawl stays on the start URL's: first seen first, at most 3. The
   * Lookup probes known paths on them (`docs.machines.dev` from `fly.io`).
   */
  offHostHosts: string[];
  /**
   * The GitHub orgs the crawled pages link to (`github.com/<org>[/…]`),
   * lowercased, most-linked first, then first seen; at most 5. The Lookup
   * searches those whose website is the Vendor's (`renderinc` from
   * `render.com`).
   */
  githubOrgs: string[];
};

export type CrawlOptions = {
  startUrl: string;
  api: ApiRef;
  fetcher: Fetcher;
  judge: Judge;
  /** Default 0.6. */
  threshold?: number;
  /** Default 8. */
  maxPages?: number;
  /** Default 20 s, for the whole crawl. */
  budgetMs?: number;
};

const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_MAX_PAGES = 8;
const DEFAULT_BUDGET_MS = 20_000;
/** Links followed from the start page: a Spec two links away is reached. */
const MAX_DEPTH = 2;
const MAX_LINKS_PER_PAGE = 60;
const MAX_TEXT = 200;
const MAX_CONTEXT = 300;
const MAX_OFF_HOST_HOSTS = 3;
const MAX_GITHUB_ORGS = 5;
/** `github.com` paths that are GitHub's own pages, not an org's. */
const GITHUB_OWN_PATHS = new Set([
  "about",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "enterprise",
  "events",
  "explore",
  "features",
  "join",
  "login",
  "logout",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "pricing",
  "readme",
  "search",
  "security",
  "settings",
  "signup",
  "site",
  "solutions",
  "sponsors",
  "team",
  "topics",
  "trending",
]);
/** A GitHub login: alphanumerics and single hyphens, at most 39 characters. */
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
/** Spec URLs taken from one page's scripts at most (WTR-59). */
const MAX_EMBEDDED_SPECS = 10;
const EMBEDDED_CONTEXT = "Named in the page's embedded configuration";
const SPEC_PATH = /\.(json|ya?ml)$|openapi|swagger|api-spec|api_spec|api-docs/i;
/** A page whose path looks like documentation, followed ahead of the rest. */
const DOCS_PATH = /docs|developer|api|reference/i;
/**
 * Where a Vendor's documentation usually lives, tried in order on a bare
 * origin before its marketing homepage (WTR-55). Page probes: robots.txt
 * applies as usual.
 */
export const DOCS_PATHS = [
  "/docs",
  "/docs/api",
  "/developers",
  "/developer",
  "/api",
  "/api-docs",
  "/reference",
  "/api-reference",
];
/** Documentation paths fetched at most, each counted against `maxPages`. */
const MAX_DOCS_PROBES = 4;
/** The wait before retrying a fetch whose answer gave no `Retry-After`. */
const RETRY_WAIT_MS = 1000;

/**
 * `fetchUrl` with the ADR 0003 exception (WTR-44): `ignoreRobots` skips the
 * robots.txt check for one request, and `robotsDisallowed` says whether it
 * would have refused. A fetcher without it ignores the option and throws
 * `robots-disallowed` again, so the link is skipped.
 */
type RobotsExceptionFetch = (
  url: string,
  opts: { signal?: AbortSignal; ignoreRobots: true },
) => Promise<FetchResult & { robotsDisallowed?: boolean }>;

type Page = {
  url: string;
  depth: number;
  /** The page whose link led here; the start URL for itself. */
  from: string;
};

/**
 * A shallow crawl of a Developer Portal for Specs. From `startUrl` it reads
 * HTML pages for links, asks the Judge once per page which Spec candidates
 * look like the API's Spec, fetches the likely ones and follows the pages on
 * the same registrable domain, documentation-looking ones first, up to `maxPages` pages, two links
 * deep, inside `budgetMs`, and reports the other registrable domains it saw
 * linked. Never throws: failures skip a link or a page. A Spec candidate's
 * fetch is retried once on `HTTP 429`, a 5xx or a timeout, and one that still
 * fails is reported in `failed`.
 *
 * Started at a bare origin, it first looks for the documentation at the
 * usual paths (`/docs`, `/developers`, …) and crawls from the first that
 * answers with HTML, falling back to the origin itself once that runs dry:
 * a homepage's own links are mostly marketing.
 */
export async function crawlForSpecs(opts: CrawlOptions): Promise<CrawlResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const signal = AbortSignal.timeout(budgetMs);
  const deadline = Date.now() + budgetMs;
  const { api, fetcher, judge } = opts;
  const home = registrableDomain(opts.startUrl);

  const hits: CrawlHit[] = [];
  const failed: CrawlFailure[] = [];
  const offHostHosts: string[] = [];
  /** Links per GitHub org, in first-seen order. */
  const githubLinks = new Map<string, number>();
  const seen = new Set<string>([normalize(opts.startUrl)]);
  const origin: Page = { url: opts.startUrl, depth: 0, from: opts.startUrl };
  const queue: Page[] = [];
  let pagesFetched = 0;

  /** The documentation page found on a bare origin, already fetched. */
  let docs: { page: Page; res: FetchResult } | null = null;
  const probes = isBareOrigin(opts.startUrl)
    ? DOCS_PATHS.map((path) => new URL(path, opts.startUrl).href)
    : [];
  let probesMade = 0;
  for (const url of probes) {
    if (
      probesMade >= MAX_DOCS_PROBES ||
      pagesFetched >= maxPages ||
      signal.aborted
    )
      break;
    seen.add(normalize(url));
    let res: FetchResult;
    try {
      res = await fetcher.fetchUrl(url, { signal });
    } catch (error) {
      // robots.txt shut the path before any request was made: no fetch spent.
      if (error instanceof FetchError && error.kind === "robots-disallowed") {
        continue;
      }
      probesMade++;
      pagesFetched++;
      continue;
    }
    probesMade++;
    pagesFetched++;
    if (res.status === 200 && isHtml(res.contentType)) {
      seen.add(normalize(res.finalUrl));
      docs = { page: { url, depth: 0, from: url }, res };
      break;
    }
  }
  /** Crawled after the documentation, never instead of it. */
  let fallback: Page | null = docs ? origin : null;
  if (!docs) queue.push(origin);

  while (!signal.aborted) {
    let page: Page;
    let res: FetchResult;
    if (docs) {
      ({ page, res } = docs);
      docs = null;
    } else {
      if (queue.length === 0 && fallback) {
        queue.push(fallback);
        fallback = null;
      }
      if (queue.length === 0 || pagesFetched >= maxPages) break;
      page = queue.shift() as Page;
      pagesFetched++;
      try {
        res = await fetcher.fetchUrl(page.url, { signal });
      } catch {
        continue;
      }
    }

    if (!isHtml(res.contentType)) {
      // Not read for links, but it may be a Spec: the start URL itself, or
      // one at a path that doesn't look like it (`/api/docs/json`).
      const sniff = sniffSpec(res.bytes, res.contentType);
      if (sniff && !hits.some((h) => h.url === res.finalUrl)) {
        hits.push({
          url: res.finalUrl,
          bytes: res.bytes,
          sniff,
          linkedFrom: page.from,
          offHost: false,
          robotsDisallowed: false,
        });
      }
      continue;
    }

    const text = new TextDecoder().decode(res.bytes);
    for (const org of githubOrgsLinked(text, res.finalUrl))
      githubLinks.set(org, (githubLinks.get(org) ?? 0) + 1);
    const links = withEmbeddedSpecs(
      extractLinks(text, res.finalUrl),
      extractEmbeddedSpecUrls(text, res.finalUrl),
    ).filter((link) => !seen.has(normalize(link.url)));
    for (const link of links) {
      const domain = registrableDomain(link.url);
      if (
        domain !== null &&
        domain !== home &&
        offHostHosts.length < MAX_OFF_HOST_HOSTS &&
        !offHostHosts.includes(domain)
      )
        offHostHosts.push(domain);
    }
    const specs: SpecLink[] = [];
    const pages: SpecLink[] = [];
    for (const link of links) {
      if (isSpecCandidate(link.url)) specs.push(link);
      else if (home !== null && registrableDomain(link.url) === home) {
        pages.push(link);
      }
    }
    if (specs.length > 0) {
      let judgments: YesNoJudgment[] | null = null;
      try {
        judgments = await abortable(judge.areSpecLinks(api, specs), signal);
      } catch {
        // No judgments: no Spec candidate is fetched, but pages still are.
      }
      const likely = specs
        .map((link, i) => ({ link, p: judgments?.[i]?.probability ?? 0 }))
        .filter(({ p }) => p >= threshold)
        .sort((a, b) => b.p - a.p)
        .map(({ link }) => link);
      for (const link of likely) {
        if (signal.aborted) break;
        seen.add(normalize(link.url));
        const hit = await fetchSpec(link.url, fetcher, signal, deadline);
        if (hit && "reason" in hit) {
          failed.push({ url: link.url, reason: hit.reason });
        } else if (hit && !hits.some((h) => h.url === hit.url)) {
          hits.push({
            ...hit,
            linkedFrom: res.finalUrl,
            offHost: registrableDomain(link.url) !== home,
          });
        }
      }
    }

    // Pages are not judged: the Judge is asked whether a link is the Spec,
    // and a documentation page never is. Rank, then truncate: documentation-
    // looking pages first, then the rest in document order, cut to what the
    // page budget has left.
    if (page.depth + 1 < MAX_DEPTH) {
      const room = maxPages - pagesFetched - queue.length;
      const ranked = [
        ...pages.filter((link) => isDocsPage(link.url)),
        ...pages.filter((link) => !isDocsPage(link.url)),
      ];
      for (const link of ranked.slice(0, Math.max(0, room))) {
        seen.add(normalize(link.url));
        queue.push({
          url: link.url,
          depth: page.depth + 1,
          from: res.finalUrl,
        });
      }
    }
  }
  // A stable sort: ties stay in first-seen order.
  const githubOrgs = [...githubLinks]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GITHUB_ORGS)
    .map(([org]) => org);
  return { hits, failed, offHostHosts, githubOrgs };
}

/**
 * The GitHub org of each `<a href>` on a page that points to
 * `github.com/<org>[/…]`, lowercased, one per link, in document order;
 * GitHub's own pages (`/features`, `/pricing`, …) are left out.
 */
export function githubOrgsLinked(html: string, baseUrl: string): string[] {
  const orgs: string[] = [];
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return orgs;
  }
  for (const match of html.matchAll(ANCHOR)) {
    const href = attribute(match[1] ?? "", "href");
    const url = href === null ? null : resolveLink(href, base);
    if (!url) continue;
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") continue;
    const org = parsed.pathname.split("/")[1]?.toLowerCase() ?? "";
    if (GITHUB_LOGIN.test(org) && !GITHUB_OWN_PATHS.has(org)) orgs.push(org);
  }
  return orgs;
}

/** One of a Vendor's APIs, as a link on its Developer Portal names it. */
export type VendorApiHit = {
  /** The link's anchor text: the name the Judge was shown. */
  name: string;
  url: string;
};

export type VendorApiCrawlResult = {
  hits: VendorApiHit[];
  /** The pages the crawl couldn't fetch, after the retry (WTR-86). */
  failed: CrawlFailure[];
};

const VENDOR_APIS_MAX_PAGES = 4;
const VENDOR_APIS_BUDGET_MS = 15_000;
const MAX_VENDOR_APIS = 10;
/** The start page's API links are read; theirs are not followed. */
const VENDOR_APIS_MAX_DEPTH = 1;

/**
 * A shallow crawl of a Developer Portal for the Vendor's APIs, rather than a
 * Spec. The start page's links on its registrable domain go to the Judge
 * (`areVendorApiLinks`); the ones it takes for an API are kept and, best
 * first, read in turn for their own links (a portal's API page often lists
 * its siblings), one link deep, up to `maxPages` pages inside `budgetMs`.
 * Returns at most 10 hits in score order, one per API name, and the pages it
 * couldn't fetch, each retried once as `crawlForSpecs` retries a Spec. Never
 * throws.
 */
export async function crawlForVendorApis(opts: {
  startUrl: string;
  vendor: VendorRef;
  fetcher: Fetcher;
  judge: Judge;
  /** Default 4. */
  maxPages?: number;
  /** Default 15 s, for the whole crawl. */
  budgetMs?: number;
  /** Default 0.6. */
  threshold?: number;
}): Promise<VendorApiCrawlResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const maxPages = opts.maxPages ?? VENDOR_APIS_MAX_PAGES;
  const budgetMs = opts.budgetMs ?? VENDOR_APIS_BUDGET_MS;
  const signal = AbortSignal.timeout(budgetMs);
  const deadline = Date.now() + budgetMs;
  const { vendor, fetcher, judge } = opts;
  const home = registrableDomain(opts.startUrl);

  /** The best-scored link per normalised API name. */
  const best = new Map<string, { hit: VendorApiHit; p: number }>();
  const seen = new Set<string>([normalize(opts.startUrl)]);
  const queue: Page[] = [{ url: opts.startUrl, depth: 0, from: opts.startUrl }];
  const failed: CrawlFailure[] = [];
  let pagesFetched = 0;

  while (queue.length > 0 && pagesFetched < maxPages && !signal.aborted) {
    const page = queue.shift() as Page;
    pagesFetched++;
    let res: FetchResult;
    try {
      res = await retryOnce(
        () => fetcher.fetchUrl(page.url, { signal }),
        signal,
        deadline,
      );
    } catch (error) {
      failed.push({ url: page.url, reason: failureReason(error) });
      continue;
    }
    if (!isHtml(res.contentType)) continue;

    const links = extractLinks(
      new TextDecoder().decode(res.bytes),
      res.finalUrl,
    ).filter(
      (link) =>
        link.text !== "" &&
        home !== null &&
        registrableDomain(link.url) === home &&
        normalize(link.url) !== normalize(res.finalUrl),
    );
    if (links.length === 0) continue;

    let judgments: YesNoJudgment[];
    try {
      judgments = await abortable(
        judge.areVendorApiLinks(vendor, links),
        signal,
      );
    } catch {
      continue;
    }
    const picked = links
      .map((link, i) => ({ link, p: judgments[i]?.probability ?? 0 }))
      .filter(({ p }) => p >= threshold)
      .sort((a, b) => b.p - a.p);

    for (const { link, p } of picked) {
      const key = apiNameKey(link.text);
      const current = best.get(key);
      if (!current || p > current.p) {
        best.set(key, { hit: { name: link.text, url: link.url }, p });
      }
      if (
        page.depth < VENDOR_APIS_MAX_DEPTH &&
        !seen.has(normalize(link.url))
      ) {
        seen.add(normalize(link.url));
        queue.push({
          url: link.url,
          depth: page.depth + 1,
          from: res.finalUrl,
        });
      }
    }
  }
  const hits = [...best.values()]
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_VENDOR_APIS)
    .map(({ hit }) => hit);
  return { hits, failed };
}

/** An API name for deduplication: case, spacing and a trailing "API" ignored. */
function apiNameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim().replace(/ api$/, "");
}

/**
 * Fetches a Spec candidate and sniffs it: a hit, `null` when what came back
 * isn't a Spec, or the reason it couldn't be fetched. A candidate its host's
 * robots.txt disallows is retried once under the ADR 0003 exception: it was
 * linked from a page we were allowed to read, and it is a single document we
 * never crawl on from. A 429, 5xx or timeout is retried once (`retryOnce`).
 */
async function fetchSpec(
  url: string,
  fetcher: Fetcher,
  signal: AbortSignal,
  deadline: number,
): Promise<
  Omit<CrawlHit, "linkedFrom" | "offHost"> | { reason: string } | null
> {
  let res: FetchResult & { robotsDisallowed?: boolean };
  try {
    res = await retryOnce(
      () => fetcher.fetchUrl(url, { signal }),
      signal,
      deadline,
    );
  } catch (error) {
    if (!(error instanceof FetchError) || error.kind !== "robots-disallowed") {
      return { reason: failureReason(error) };
    }
    try {
      const fetchUrl = fetcher.fetchUrl as RobotsExceptionFetch;
      res = await retryOnce(
        () => fetchUrl.call(fetcher, url, { signal, ignoreRobots: true }),
        signal,
        deadline,
      );
    } catch (error) {
      return { reason: failureReason(error) };
    }
  }
  const sniff = sniffSpec(res.bytes, res.contentType);
  if (!sniff) return null;
  return {
    url: res.finalUrl,
    bytes: res.bytes,
    sniff,
    robotsDisallowed: res.robotsDisallowed === true,
  };
}

/**
 * Runs `attempt`, and once more if it fails with `HTTP 429`, a 5xx or a
 * timeout: after the answer's `Retry-After`, else 1 s. A wait that would end
 * past `deadline` (the crawl's budget) isn't made, and the first error stands.
 */
async function retryOnce<T>(
  attempt: () => Promise<T>,
  signal: AbortSignal,
  deadline: number,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isTransient(error) || signal.aborted) throw error;
    const wait = error.retryAfterMs ?? RETRY_WAIT_MS;
    if (Date.now() + wait >= deadline) throw error;
    try {
      await sleep(wait, undefined, { signal });
    } catch {
      throw error;
    }
    return attempt();
  }
}

function isTransient(error: unknown): error is FetchError {
  if (!(error instanceof FetchError)) return false;
  if (error.kind === "timeout") return true;
  const status = error.status ?? 0;
  return error.kind === "http-error" && (status === 429 || status >= 500);
}

/** A fetch error as a `CrawlFailure` reason: `http-error: HTTP 429`. */
function failureReason(error: unknown): string {
  if (!(error instanceof FetchError)) return String(error);
  const suffix = ` (${error.url})`;
  return error.message.endsWith(suffix)
    ? error.message.slice(0, -suffix.length)
    : error.message;
}

/** Rejects as soon as `signal` aborts, so a slow Judge can't outlast the budget. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function isHtml(contentType: string | null): boolean {
  return /^\s*text\/html\b/i.test(contentType ?? "");
}

/** A link whose path looks like a Spec document rather than a page. */
export function isSpecCandidate(url: string): boolean {
  try {
    return SPEC_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** A same-domain page whose path looks like documentation. */
function isDocsPage(url: string): boolean {
  try {
    return DOCS_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** A start URL with no path of its own: a Vendor's homepage. */
function isBareOrigin(url: string): boolean {
  try {
    return new URL(url).pathname === "/";
  } catch {
    return false;
  }
}

/** A URL without its fragment, for deduplication. */
function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

const TAG =
  /<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const HEADING = /^h[1-6]$/;
const ANCHOR = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

/**
 * The `<a href>` links of an HTML page as `SpecLink`s, in document order:
 * `url` resolved against `baseUrl`, `text` the anchor text, `context` the
 * enclosing paragraph's text or else the nearest preceding heading. Skips
 * `mailto:`, `javascript:` and in-page fragments; deduplicated. At most 60:
 * Spec candidates are kept first, then the rest in document order, so a Spec
 * link past a long run of site navigation is never the one dropped.
 */
export function extractLinks(html: string, baseUrl: string): SpecLink[] {
  const links: SpecLink[] = [];
  const seen = new Set<string>();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return links;
  }

  let heading: string | undefined;
  let headingText: string[] | null = null;
  let paragraph: string[] | null = null;
  /** Links waiting for their enclosing paragraph to close. */
  let pendingInParagraph: SpecLink[] = [];
  let anchor: { url: string; text: string[] } | null = null;
  let last = 0;

  const addText = (raw: string) => {
    const text = decodeEntities(raw);
    anchor?.text.push(text);
    headingText?.push(text);
    paragraph?.push(text);
  };
  const closeParagraph = () => {
    if (paragraph) {
      const context = clip(paragraph.join(""), MAX_CONTEXT);
      for (const link of pendingInParagraph) {
        if (context) link.context = context;
      }
    }
    paragraph = null;
    pendingInParagraph = [];
  };

  for (const match of html.matchAll(TAG)) {
    addText(html.slice(last, match.index));
    last = match.index + match[0].length;
    const name = match[3]?.toLowerCase();
    if (!name) continue;
    const closing = match[2] === "/";

    if (HEADING.test(name)) {
      if (closing) {
        if (headingText) heading = clip(headingText.join(""), MAX_CONTEXT);
        headingText = null;
      } else {
        headingText = [];
      }
    } else if (name === "p") {
      closeParagraph();
      if (!closing) paragraph = [];
    } else if (name === "a") {
      if (closing) {
        if (!anchor) continue;
        const link: SpecLink = {
          url: anchor.url,
          text: clip(anchor.text.join(""), MAX_TEXT),
        };
        if (heading) link.context = heading;
        anchor = null;
        if (seen.has(link.url)) continue;
        seen.add(link.url);
        links.push(link);
        if (paragraph) pendingInParagraph.push(link);
      } else {
        const href = attribute(match[4] ?? "", "href");
        const url = href === null ? null : resolveLink(href, base);
        anchor = url ? { url, text: [] } : null;
      }
    }
  }
  closeParagraph();
  if (links.length <= MAX_LINKS_PER_PAGE) return links;
  const specs = links.filter((link) => isSpecCandidate(link.url));
  const kept = new Set(specs.slice(0, MAX_LINKS_PER_PAGE));
  for (const link of links) {
    if (kept.size >= MAX_LINKS_PER_PAGE) break;
    kept.add(link);
  }
  return links.filter((link) => kept.has(link));
}

const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
const CODE = /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
/**
 * A Spec-looking URL in script or code text: absolute, or a site path with or
 * without its leading slash, that ends in `.json`, `.yaml` or `.yml` and names
 * `openapi` or `swagger` in any path segment, a directory
 * (`/openapi/public-api-1.json`) or the file name (`v2-openapi.json`); or
 * that ends in `/api/docs/json`.
 */
const EMBEDDED_SPEC =
  /(?<![\w.~%/:@-])(?:https?:\/\/[\w.-]+(?::\d+)?)?\/?(?:[\w.~%@-]+\/)*?(?:[\w.~%@-]*(?:openapi|swagger)[\w.~%@-]*\/(?:[\w.~%@-]+\/)*[\w.~%-]*\.(?:json|ya?ml)|[\w.~%-]*(?:openapi|swagger)[\w.~%-]*\.(?:json|ya?ml)|api\/docs\/json)(?![\w.~%/-])/gi;

/**
 * Spec URLs a page names outside its anchors: first in its inline `<script>`
 * bodies and JSON, as documentation sites built from a Spec (Mintlify,
 * Scalar) do (`"api-reference/v2-openapi.json"` in a config, never in an
 * `<a href>`); then in the text of its `<pre>` and `<code>` elements, where
 * docs show a Spec URL to copy, with the tags inside (syntax-highlighting
 * spans) stripped and `&amp;`, `&#x2F;` and `&#47;` decoded. Resolved against
 * `baseUrl`; a path without a leading slash resolves from the site root, as
 * those configs mean it. Script matches first, then code matches, each in
 * document order; deduplicated, at most 10.
 */
export function extractEmbeddedSpecUrls(
  html: string,
  baseUrl: string,
): string[] {
  const urls: string[] = [];
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return urls;
  }
  const texts: string[] = [];
  for (const script of html.matchAll(SCRIPT)) {
    // JSON inside a string escapes its slashes: `https:\/\/…`, `/`.
    texts.push(
      (script[1] ?? "").replace(/\\+\//g, "/").replace(/\\u002f/gi, "/"),
    );
  }
  for (const code of html.matchAll(CODE)) {
    texts.push(
      (code[2] ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/&#x2f;|&#47;/gi, "/")
        .replace(/&amp;/gi, "&"),
    );
  }
  for (const text of texts) {
    for (const match of text.matchAll(EMBEDDED_SPEC)) {
      const ref = match[0];
      let url: URL;
      try {
        url = /^https?:/i.test(ref)
          ? new URL(ref)
          : new URL(ref.startsWith("/") ? ref : `/${ref}`, base);
      } catch {
        continue;
      }
      if (urls.includes(url.href)) continue;
      urls.push(url.href);
      if (urls.length >= MAX_EMBEDDED_SPECS) return urls;
    }
  }
  return urls;
}

/**
 * A page's anchors with the Spec URLs its scripts and code blocks name put
 * first: they name a Spec outright, so at an equal score they are fetched
 * ahead of an ordinary link. A URL that is also an anchor is one candidate, carrying the
 * anchor's text.
 */
function withEmbeddedSpecs(
  anchors: SpecLink[],
  embedded: string[],
): SpecLink[] {
  const byUrl = new Map(anchors.map((link) => [link.url, link]));
  const named = embedded.map(
    (url) => byUrl.get(url) ?? { url, text: "", context: EMBEDDED_CONTEXT },
  );
  return [...named, ...anchors.filter((link) => !embedded.includes(link.url))];
}

function resolveLink(href: string, base: URL): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  // A fragment link back to the page itself.
  if (url.href === normalize(base.href) && trimmed.includes("#")) return null;
  return url.href;
}

function attribute(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const m = re.exec(attrs);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
