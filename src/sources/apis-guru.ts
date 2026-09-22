import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { slugify, type Vendor, vendorIdFromDomain } from "~/domain/catalog";
import type { Provenance } from "~/domain/provenance";
import { normalizeName } from "~/index-store/repo";

export const APIS_GURU_LIST_URL = "https://api.apis.guru/v2/list.json";

/** Provenance of the copy APIs.guru serves: a third-party copy of the Spec. */
export const APIS_GURU_PROVENANCE: Provenance = "Mirror";

const MAX_CANDIDATES = 10;

/** An API Candidate proposed by APIs.guru, not yet judged. */
export type ApiCandidate = {
  apiId: string;
  name: string;
  vendor: Vendor;
  description?: string;
  preferredVersion: string;
  /** The APIs.guru copy of the Spec (Provenance: Mirror). */
  mirrorUrl: string;
  /** `info["x-origin"][].url`: where APIs.guru got the Spec. */
  originUrls: string[];
  /**
   * The `originUrls` on the Vendor's domain: possibly Official Sources, for
   * the Lookup to fetch and confirm. Never assigned Official here.
   */
  possiblyOfficialUrls: string[];
  updated: string;
};

export type ApisGuru = {
  findCandidates(name: string): Promise<ApiCandidate[]>;
  /** A Vendor's APIs, by Vendor id (`googleapis.com`), at most 10, by key. */
  findVendorApis(vendorId: string): Promise<ApiCandidate[]>;
};

export type ApisGuruOptions = {
  fetchJson?: (url: string) => Promise<unknown>;
  cachePath?: string;
  ttlHours?: number;
};

const ListVersion = z.object({
  info: z.object({
    title: z.string(),
    description: z.string().optional(),
    "x-serviceName": z.string().optional(),
    "x-origin": z
      .array(z.object({ url: z.string().optional() }).loose())
      .optional(),
  }),
  swaggerUrl: z.string(),
  updated: z.string(),
});

const ListEntry = z.object({
  preferred: z.string(),
  versions: z.record(z.string(), z.unknown()),
});

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.json();
}

export function createApisGuru({
  fetchJson = defaultFetchJson,
  cachePath = "data/apis-guru-list.json",
  ttlHours = 24,
}: ApisGuruOptions = {}): ApisGuru {
  const ttlMs = ttlHours * 3_600_000;
  let loaded: { at: number; entries: Promise<ListedApi[]> } | undefined;

  async function readCache(): Promise<{ list: unknown; ageMs: number } | null> {
    try {
      const { mtimeMs } = await stat(cachePath);
      const list = JSON.parse(await readFile(cachePath, "utf8"));
      return { list, ageMs: Date.now() - mtimeMs };
    } catch {
      return null;
    }
  }

  async function loadList(): Promise<unknown> {
    const cached = await readCache();
    if (cached && cached.ageMs < ttlMs) return cached.list;
    let list: unknown;
    try {
      list = await fetchJson(APIS_GURU_LIST_URL);
    } catch (cause) {
      // A stale cache beats no answer at all.
      if (cached) return cached.list;
      throw new Error("APIs.guru list unavailable and not cached", { cause });
    }
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(list));
    return list;
  }

  function entries(): Promise<ListedApi[]> {
    if (!loaded || Date.now() - loaded.at >= ttlMs) {
      const pending = loadList().then(parseList);
      loaded = { at: Date.now(), entries: pending };
      // Don't keep a failed load: the next call tries again.
      pending.catch(() => {
        if (loaded?.entries === pending) loaded = undefined;
      });
    }
    return loaded.entries;
  }

  return {
    async findCandidates(name) {
      const query = normalizeName(name);
      if (!query) return [];
      const scored = (await entries())
        .map((api) => ({ api, score: scoreMatch(query, api) }))
        .filter(({ score }) => score > 0);
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          (a.api.key < b.api.key ? -1 : a.api.key > b.api.key ? 1 : 0),
      );
      return scored.slice(0, MAX_CANDIDATES).map(({ api }) => api.candidate);
    },

    async findVendorApis(vendorId) {
      return (await entries())
        .filter((api) => api.candidate.vendor.id === vendorId)
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .slice(0, MAX_CANDIDATES)
        .map((api) => api.candidate);
    },
  };
}

type ListedApi = {
  key: string;
  candidate: ApiCandidate;
  /** Match forms: provider label (`stripe`), provider, service, title. */
  exact: string[];
  tokens: string[];
};

/** The list's entries at their preferred version; malformed ones are skipped. */
function parseList(list: unknown): ListedApi[] {
  if (typeof list !== "object" || list === null)
    throw new Error("APIs.guru list is not an object");
  const out: ListedApi[] = [];
  for (const [key, raw] of Object.entries(list)) {
    const entry = ListEntry.safeParse(raw);
    if (!entry.success) continue;
    const version = ListVersion.safeParse(
      entry.data.versions[entry.data.preferred],
    );
    if (!version.success) continue;
    out.push(toListedApi(key, entry.data.preferred, version.data));
  }
  return out;
}

/**
 * `stripe.com` → Vendor `stripe.com`, API `stripe.com/stripe-api` (title slug);
 * `googleapis.com:drive` → Vendor `googleapis.com`, API `googleapis.com/drive`.
 */
function toListedApi(
  key: string,
  preferredVersion: string,
  version: z.infer<typeof ListVersion>,
): ListedApi {
  const [provider = key, service] = splitKey(key);
  const vendorId = vendorIdFromDomain(provider);
  const { info } = version;
  const serviceName = service ?? info["x-serviceName"];
  const originUrls = (info["x-origin"] ?? []).flatMap((o) =>
    o.url ? [o.url] : [],
  );
  const providerLabel = vendorId.split(".")[0] ?? vendorId;
  return {
    key,
    candidate: {
      apiId: `${vendorId}/${slugify(service ?? info.title)}`,
      name: info.title,
      vendor: { id: vendorId, name: vendorId, domain: vendorId },
      ...(info.description ? { description: info.description } : {}),
      preferredVersion,
      mirrorUrl: version.swaggerUrl,
      originUrls,
      possiblyOfficialUrls: originUrls.filter((url) =>
        isOnDomain(url, vendorId),
      ),
      updated: version.updated,
    },
    exact: [
      providerLabel,
      normalizeName(provider),
      ...(serviceName ? [normalizeName(serviceName)] : []),
      normalizeName(info.title),
    ],
    tokens: tokenize([providerLabel, serviceName ?? "", info.title].join(" ")),
  };
}

/** `googleapis.com:drive` → [`googleapis.com`, `drive`]. */
function splitKey(key: string): [string, string | undefined] {
  const i = key.indexOf(":");
  return i < 0 ? [key, undefined] : [key.slice(0, i), key.slice(i + 1)];
}

function isOnDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

const STOP_TOKENS = new Set(["api", "apis", "the", "rest", "web", "v1", "v2"]);

function tokenize(text: string): string[] {
  return normalizeName(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP_TOKENS.has(t));
}

/**
 * Exact match (provider, service or title) > prefix of the title or provider >
 * token overlap. A query token counts fully when it equals an API token and
 * half when it is a prefix of one (`google` → `googleapis`). 0 is no match.
 */
function scoreMatch(query: string, api: ListedApi): number {
  if (api.exact.includes(query)) return 3;
  if (api.exact.some((form) => form.startsWith(query))) return 2;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  let overlap = 0;
  for (const q of queryTokens) {
    if (api.tokens.includes(q)) overlap += 1;
    else if (q.length >= 3 && api.tokens.some((t) => t.startsWith(q)))
      overlap += 0.5;
  }
  return overlap / queryTokens.length;
}
