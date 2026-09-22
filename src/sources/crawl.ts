import { FetchError, type Fetcher, type FetchResult } from "~/fetch/fetcher";
import { type SniffResult, sniffSpec } from "~/fetch/sniff";
import type { ApiRef, Judge, SpecLink, YesNoJudgment } from "~/judge/judge";
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
const SPEC_PATH = /\.(json|ya?ml)$|openapi|swagger|api-spec|api_spec|api-docs/i;

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
 * HTML pages for links, asks the Judge once per page which links look like
 * the API's Spec, fetches the likely Spec documents and follows the likely
 * pages on the same registrable domain, up to `maxPages` pages, two links
 * deep, inside `budgetMs`. Never throws: failures skip a link or a page.
 */
export async function crawlForSpecs(opts: CrawlOptions): Promise<CrawlHit[]> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const signal = AbortSignal.timeout(opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const { api, fetcher, judge } = opts;
  const home = registrableDomain(opts.startUrl);

  const hits: CrawlHit[] = [];
  const seen = new Set<string>([normalize(opts.startUrl)]);
  const queue: Page[] = [{ url: opts.startUrl, depth: 0, from: opts.startUrl }];
  let pagesFetched = 0;

  while (queue.length > 0 && pagesFetched < maxPages && !signal.aborted) {
    const page = queue.shift() as Page;
    pagesFetched++;
    let res: FetchResult;
    try {
      res = await fetcher.fetchUrl(page.url, { signal });
    } catch {
      continue;
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

    const links = extractLinks(
      new TextDecoder().decode(res.bytes),
      res.finalUrl,
    ).filter((link) => !seen.has(normalize(link.url)));
    const specs: SpecLink[] = [];
    const pages: SpecLink[] = [];
    for (const link of links) {
      if (isSpecCandidate(link.url)) specs.push(link);
      else if (home !== null && registrableDomain(link.url) === home) {
        pages.push(link);
      }
    }
    if (specs.length + pages.length === 0) continue;

    let judgments: YesNoJudgment[];
    try {
      judgments = await abortable(
        judge.areSpecLinks(api, [...specs, ...pages]),
        signal,
      );
    } catch {
      continue;
    }
    const pick = (list: SpecLink[], offset: number) =>
      list
        .map((link, i) => ({
          link,
          p: judgments[offset + i]?.probability ?? 0,
        }))
        .filter(({ p }) => p >= threshold)
        .sort((a, b) => b.p - a.p)
        .map(({ link }) => link);

    for (const link of pick(specs, 0)) {
      if (signal.aborted) break;
      seen.add(normalize(link.url));
      const hit = await fetchSpec(link.url, fetcher, signal);
      if (hit && !hits.some((h) => h.url === hit.url)) {
        hits.push({
          ...hit,
          linkedFrom: res.finalUrl,
          offHost: registrableDomain(link.url) !== home,
        });
      }
    }

    if (page.depth + 1 < MAX_DEPTH) {
      for (const link of pick(pages, specs.length)) {
        seen.add(normalize(link.url));
        queue.push({
          url: link.url,
          depth: page.depth + 1,
          from: res.finalUrl,
        });
      }
    }
  }
  return hits;
}

/**
 * Fetches a Spec candidate and sniffs it. A candidate its host's robots.txt
 * disallows is retried once under the ADR 0003 exception: it was linked from
 * a page we were allowed to read, and it is a single document we never crawl
 * on from.
 */
async function fetchSpec(
  url: string,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<Omit<CrawlHit, "linkedFrom" | "offHost"> | null> {
  let res: FetchResult & { robotsDisallowed?: boolean };
  try {
    res = await fetcher.fetchUrl(url, { signal });
  } catch (error) {
    if (!(error instanceof FetchError) || error.kind !== "robots-disallowed") {
      return null;
    }
    try {
      const fetchUrl = fetcher.fetchUrl as RobotsExceptionFetch;
      res = await fetchUrl.call(fetcher, url, { signal, ignoreRobots: true });
    } catch {
      return null;
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

/**
 * The `<a href>` links of an HTML page as `SpecLink`s, in document order:
 * `url` resolved against `baseUrl`, `text` the anchor text, `context` the
 * enclosing paragraph's text or else the nearest preceding heading. Skips
 * `mailto:`, `javascript:` and in-page fragments; at most 60, deduplicated.
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
        if (seen.has(link.url) || links.length >= MAX_LINKS_PER_PAGE) continue;
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
  return links;
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
