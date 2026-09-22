/**
 * API Versions: which one a Spec describes, whether it is a Preview Version,
 * and how API Versions order. `compareApiVersions` is the one ordering rule;
 * `currentAndAlternates` and the Lookup use nothing else.
 */

/** What a Spec's `info` says about its API Version, read by `sniffSpec`. */
export type VersionInfo = {
  /** `info.version`, trimmed; `null` when absent or empty. */
  version: string | null;
  /** `info["x-preview"] === true`. */
  preview: boolean;
};

export type ApiVersionOf = {
  apiVersion: string | null;
  isPreview: boolean;
};

/**
 * `info.version` values that tools write by default and so say nothing when
 * the Source path names a version (`1.0.0` at `…/openapi-v2026.0.json`).
 */
const PLACEHOLDER_VERSIONS = new Set([
  "0",
  "1",
  "0.1",
  "1.0",
  "0.0.1",
  "0.1.0",
  "1.0.0",
]);

const PREVIEW_WORDS = new Set([
  "alpha",
  "beta",
  "preview",
  "rc",
  "experimental",
]);

/** A date (`2024-06-20`) or a `v`-number (`v2`, `v2026.0`, `v1beta1`). */
const PATH_VERSION =
  /(?<![0-9])(\d{4}-\d{2}-\d{2})(?![0-9])|(?<![a-z0-9])(v\d+(?:\.\d+)*(?:(?:alpha|beta|preview|rc)\d*)?)(?![0-9a-z])/gi;

/**
 * The API Version a Spec describes: `info.version`, unless it is absent or a
 * placeholder while the Source path names a version (`v2`, `v2026.0`,
 * `2024-06-20`, `release/v2`), which is then used instead; `null` when
 * neither says. A Preview Version when the API Version or the Source path has
 * `alpha`, `beta`, `preview`, `rc` or `experimental` as a word, or
 * `info["x-preview"]` is true.
 */
export function apiVersionOf(
  info: VersionInfo,
  sourceUrl: string,
): ApiVersionOf {
  const path = pathOf(sourceUrl);
  const fromPath = versionInPath(path);
  const stated = info.version;
  const apiVersion =
    stated !== null &&
    !(fromPath !== null && PLACEHOLDER_VERSIONS.has(stated.replace(/^v/i, "")))
      ? stated
      : fromPath;
  return {
    apiVersion,
    isPreview:
      info.preview || hasPreviewWord(apiVersion ?? "") || hasPreviewWord(path),
  };
}

/** Whether a Source URL's path names an API Version. */
export function urlNamesApiVersion(url: string): boolean {
  return versionInPath(pathOf(url)) !== null;
}

/**
 * The last version-looking part of a URL path, or `null`. The `v3`/`v2` of
 * springdoc's and springfox's `/v3/api-docs` is the OpenAPI version, not the
 * API's, and is skipped.
 */
function versionInPath(path: string): string | null {
  let found: string | null = null;
  for (const m of path.matchAll(PATH_VERSION)) {
    const after = path.slice((m.index ?? 0) + m[0].length);
    if (/^\/api-docs\b/i.test(after)) continue;
    found = m[1] ?? m[2] ?? null;
  }
  return found;
}

/** Whole words only: `v1beta1` and `2.0.0-rc.1` are Preview, `alphabet` is not. */
function hasPreviewWord(text: string): boolean {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).some((w) =>
    PREVIEW_WORDS.has(w),
  );
}

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return "";
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DOTTED = /^v?(\d+(?:\.\d+)*)(.*)$/i;

/**
 * Orders two API Versions highest first (negative when `a` ranks above `b`),
 * for `Array.prototype.sort`:
 *
 * 1. date-like (`YYYY-MM-DD`), newest first, above anything else;
 * 2. then dotted-numeric (`v2`, `2026.0`, `1.10.2`), compared segment by
 *    segment as numbers (a missing segment is 0); on equal numbers a bare
 *    release ranks above one with a suffix (`2.0` above `2.0-rc.1`);
 * 3. then anything else, by plain string comparison.
 */
export function compareApiVersions(a: string, b: string): number {
  const ka = kind(a);
  const kb = kind(b);
  if (ka !== kb) return ka - kb;
  if (ka === DATE_KIND) return byString(b, a);
  if (ka === DOTTED_KIND) {
    const [na, sa] = dotted(a);
    const [nb, sb] = dotted(b);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const d = (nb[i] ?? 0) - (na[i] ?? 0);
      if (d !== 0) return d;
    }
    if (sa === "" || sb === "") return sa === sb ? 0 : sa === "" ? -1 : 1;
    return byString(sb, sa);
  }
  return byString(b, a);
}

const DATE_KIND = 0;
const DOTTED_KIND = 1;
const OTHER_KIND = 2;

function kind(v: string): number {
  if (DATE.test(v)) return DATE_KIND;
  if (DOTTED.test(v)) return DOTTED_KIND;
  return OTHER_KIND;
}

function dotted(v: string): [number[], string] {
  const m = DOTTED.exec(v);
  return [(m?.[1] ?? "").split(".").map(Number), m?.[2] ?? ""];
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Current Spec and the Alternate Specs among Specs of one API, which
 * come in order of preference for ties (the same or no API Version).
 *
 * The Current Spec should be the API Version the Vendor recommends, but no
 * Vendor says so in a way a machine can read (curating the Index by hand is a
 * PRD "Later" item), so the highest non-Preview API Version stands in for it.
 * Alternates are the other non-Preview API Versions, one Spec each; a Spec
 * with no API Version is never an Alternate. `null` when every Spec is a
 * Preview Version.
 */
export function currentAndAlternates<T>(
  specs: T[],
  versionOf: (spec: T) => ApiVersionOf,
): { current: T; alternates: T[] } | null {
  const ranked = specs
    .map((s, i) => ({ s, v: versionOf(s), i }))
    .filter(({ v }) => !v.isPreview)
    .sort((x, y) => byVersion(x.v, y.v) || x.i - y.i);
  const [current, ...rest] = ranked;
  if (!current) return null;
  const seen = new Set([current.v.apiVersion]);
  const alternates = rest
    .filter(({ v }) => {
      if (v.apiVersion === null || seen.has(v.apiVersion)) return false;
      seen.add(v.apiVersion);
      return true;
    })
    .map(({ s }) => s);
  return { current: current.s, alternates };
}

/** Highest API Version first; no API Version last. */
function byVersion(a: ApiVersionOf, b: ApiVersionOf): number {
  if (a.apiVersion === null || b.apiVersion === null)
    return a.apiVersion === b.apiVersion ? 0 : a.apiVersion === null ? 1 : -1;
  return compareApiVersions(a.apiVersion, b.apiVersion);
}
