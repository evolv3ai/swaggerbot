import { setTimeout as sleep } from "node:timers/promises";
import { FetchError, type Fetcher } from "./fetcher";
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

export type KnownPathHit = {
  /** Where the Spec was served from, after redirects. */
  url: string;
  sniff: SniffResult;
  bytes: Uint8Array;
};

export type ProbeOptions = {
  /**
   * Default 25 s, for the whole call across all hosts, not per host. Hosts
   * not finished by then stop fetching but keep the hits they already had.
   */
  budgetMs?: number;
  /** Default `https`. Tests use `http` against the fixture server. */
  scheme?: "http" | "https";
};

/**
 * Checks a Vendor's domain for Specs at well-known locations: each known path
 * on the domain and its `api.`, `developer.`, `developers.`, `docs.`, `app.`,
 * `api-docs.` and `spec.` hosts, plus the Specs an `apis.json` lists. Hosts
 * run in parallel and paths one after another per host, so the fetcher's
 * per-host spacing holds.
 */
export async function probeKnownPaths(
  domain: string,
  fetcher: Fetcher,
  opts: ProbeOptions = {},
): Promise<KnownPathHit[]> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const scheme = opts.scheme ?? "https";
  const hosts = [...new Set(KNOWN_HOST_PREFIXES.map((p) => `${p}${domain}`))];

  const stop = new AbortController();
  const deadline = sleep(budgetMs, "timeout" as const, {
    signal: stop.signal,
  }).catch(() => "timeout" as const);

  // Hits are kept as they are found, so a host stopped by the budget keeps
  // everything it found before the stop; only its unfinished work is lost.
  const found = hosts.map(() => [] as KnownPathHit[]);
  await Promise.all(
    hosts.map((host, i) =>
      Promise.race([
        probeHost(`${scheme}://${host}`, fetcher, stop.signal, (hit) =>
          found[i]?.push(hit),
        ),
        deadline,
      ]),
    ),
  );
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
  collect: (hit: KnownPathHit) => void,
): Promise<void> {
  for (const path of KNOWN_PATHS) {
    if (signal.aborted) break;
    let res: Awaited<ReturnType<Fetcher["fetchUrl"]>>;
    try {
      res = await fetcher.fetchUrl(`${origin}${path}`, { signal });
    } catch (error) {
      // A host that can't be reached won't answer on another path either.
      if (error instanceof FetchError && isHostDead(error)) break;
      continue;
    }

    const sniff = sniffSpec(res.bytes, res.contentType);
    if (sniff) {
      collect({ url: res.finalUrl, sniff, bytes: res.bytes });
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
    return sniff ? { url: res.finalUrl, sniff, bytes: res.bytes } : null;
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
