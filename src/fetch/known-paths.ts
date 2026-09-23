import { FetchError, type Fetcher, type FetchResult } from "./fetcher";
import { type SniffResult, sniffSpec } from "./sniff";

export const KNOWN_HOST_PREFIXES = [
  "",
  "api.",
  "developer.",
  "developers.",
  "docs.",
  "app.",
  "api-docs.",
  "spec.",
] as const;

/** Most likely first: a host stopped by the budget may not get through it. */
export const KNOWN_PATHS = [
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/swagger.yaml",
  "/openapi.yml",
  "/v3/api-docs",
  "/api-docs",
  "/api-json",
  "/v1-json",
  "/swagger/v1/swagger.json",
  "/api/openapi.json",
  "/docs/openapi.json",
  "/spec/openapi3.json",
  "/.well-known/openapi.json",
  "/apis.json",
] as const;

const APIS_JSON_PATH = "/apis.json";
const DEFAULT_BUDGET_MS = 25_000;
export const DEFAULT_GRACE_AFTER_HIT_MS = 3_000;

export type KnownPathHit = {
  /** Where the Spec was served from, after redirects. */
  url: string;
  sniff: SniffResult;
  bytes: Uint8Array;
  /**
   * True when the host's robots.txt disallowed the fetch and ADR 0003 allowed
   * it once; false on the ordinary path.
   */
  robotsDisallowed: boolean;
};

export type ProbeOptions = {
  /**
   * Default 25 s, for the whole call across all hosts, not per host. Hosts
   * not finished by then stop fetching but keep the hits they already had.
   */
  budgetMs?: number;
  /**
   * Default 3 s. Once the first hit is collected, the probe stops at the
   * earlier of the budget and this long after that hit, as the budget stops
   * it. The window keeps a Spec on another host that answers a little later
   * than a stale copy (WTR-42). `0` stops at the first hit; `Infinity` runs
   * to the budget, or until every host finishes.
   */
  graceAfterHitMs?: number;
  /** Default `https`. Tests use `http` against the fixture server. */
  scheme?: "http" | "https";
  /**
   * When a host's own robots.txt disallows its whole site (`Disallow: /`),
   * fetch a known path there once anyway (ADR 0003). Only for a probe of the
   * Vendor's own domain, never a third party's host. Default false.
   */
  allowBlanketRobots?: boolean;
};

/**
 * Checks a Vendor's domain for Specs at well-known locations: each known path
 * on the domain and its `api.`, `developer.`, `developers.`, `docs.`, `app.`,
 * `api-docs.` and `spec.` hosts, plus the Specs an `apis.json` lists. Hosts
 * run in parallel and paths one after another per host, so the fetcher's
 * per-host spacing holds. The first hit starts a short grace window
 * (`graceAfterHitMs`), after which every host stops.
 */
export async function probeKnownPaths(
  domain: string,
  fetcher: Fetcher,
  opts: ProbeOptions = {},
): Promise<KnownPathHit[]> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const scheme = opts.scheme ?? "https";
  const hosts = [...new Set(KNOWN_HOST_PREFIXES.map((p) => `${p}${domain}`))];

  const graceAfterHitMs = opts.graceAfterHitMs ?? DEFAULT_GRACE_AFTER_HIT_MS;

  // The deadline starts as the budget and is brought forward by the first
  // hit. When it passes every host stops, as if the budget had run out.
  const stop = new AbortController();
  const endsAt = Date.now() + budgetMs;
  let resolveDeadline: () => void = () => {};
  const deadline = new Promise<void>((resolve) => {
    resolveDeadline = resolve;
  });
  const end = () => {
    stop.abort();
    resolveDeadline();
  };
  let timer = setTimeout(end, budgetMs);
  let graceStarted = false;

  // Hits are kept as they are found, so a host stopped by the deadline keeps
  // everything it found before the stop; only its unfinished work is lost.
  const found = hosts.map(() => [] as KnownPathHit[]);
  const collect = (i: number, hit: KnownPathHit) => {
    if (stop.signal.aborted) return;
    found[i]?.push(hit);
    if (graceStarted) return;
    graceStarted = true;
    if (graceAfterHitMs <= 0) end();
    else if (graceAfterHitMs < endsAt - Date.now()) {
      clearTimeout(timer);
      timer = setTimeout(end, graceAfterHitMs);
    }
  };
  await Promise.all(
    hosts.map((host, i) =>
      Promise.race([
        probeHost(
          `${scheme}://${host}`,
          fetcher,
          stop.signal,
          opts.allowBlanketRobots ?? false,
          (hit) => collect(i, hit),
        ),
        deadline,
      ]),
    ),
  );
  clearTimeout(timer);
  stop.abort();

  const hits = new Map<string, KnownPathHit>();
  for (const hit of found.flat()) {
    if (!hits.has(hit.url)) hits.set(hit.url, hit);
  }
  return [...hits.values()];
}

async function probeHost(
  origin: string,
  fetcher: Fetcher,
  signal: AbortSignal,
  allowBlanketRobots: boolean,
  collect: (hit: KnownPathHit) => void,
): Promise<void> {
  for (const path of KNOWN_PATHS) {
    if (signal.aborted) break;
    const url = `${origin}${path}`;
    let res: FetchResult;
    try {
      res = await fetcher.fetchUrl(url, { signal });
    } catch (error) {
      if (!(error instanceof FetchError)) continue;
      // A host that can't be reached won't answer on another path either.
      if (isHostDead(error)) break;
      // ADR 0003: a host that shuts its whole site still has its Spec
      // fetched once. A list of disallowed paths is honoured as it stands.
      if (
        !allowBlanketRobots ||
        error.kind !== "robots-disallowed" ||
        !error.blanket
      )
        continue;
      try {
        res = await fetcher.fetchUrl(url, { signal, ignoreRobots: true });
      } catch (retryError) {
        if (retryError instanceof FetchError && isHostDead(retryError)) break;
        continue;
      }
    }

    const sniff = sniffSpec(res.bytes, res.contentType);
    if (sniff) {
      collect({
        url: res.finalUrl,
        sniff,
        bytes: res.bytes,
        robotsDisallowed: res.robotsDisallowed,
      });
    } else if (path === APIS_JSON_PATH) {
      for (const specUrl of apisJsonSpecUrls(res.bytes, res.finalUrl)) {
        if (signal.aborted) break;
        const hit = await fetchSpec(specUrl, fetcher, signal);
        if (hit) collect(hit);
      }
    }
  }
}

async function fetchSpec(
  url: string,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<KnownPathHit | null> {
  try {
    const res = await fetcher.fetchUrl(url, { signal });
    const sniff = sniffSpec(res.bytes, res.contentType);
    return sniff
      ? {
          url: res.finalUrl,
          sniff,
          bytes: res.bytes,
          robotsDisallowed: res.robotsDisallowed,
        }
      : null;
  } catch {
    return null;
  }
}

function isHostDead(error: FetchError): boolean {
  return error.kind === "network" || error.kind === "refused";
}

/**
 * The Spec URLs an APIs.json document lists: `apis[].properties[]` entries
 * whose type names Swagger or OpenAPI, resolved against the document's URL.
 */
export function apisJsonSpecUrls(bytes: Uint8Array, baseUrl: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
  if (!isObj(doc) || !Array.isArray(doc.apis)) return [];

  const urls = new Set<string>();
  for (const api of doc.apis) {
    if (!isObj(api) || !Array.isArray(api.properties)) continue;
    for (const property of api.properties) {
      if (!isObj(property)) continue;
      const { type, url } = property;
      if (typeof type !== "string" || !/swagger|openapi/i.test(type)) continue;
      if (typeof url !== "string") continue;
      try {
        urls.add(new URL(url, baseUrl).href);
      } catch {
        // Unparseable URL: skip it.
      }
    }
  }
  return [...urls];
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
