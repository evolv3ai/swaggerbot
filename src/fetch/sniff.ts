import { parseDocument } from "yaml";
import type { VersionInfo } from "~/domain/api-version";
import { SPEC_EXTRACT_LIMITS, type SpecExtract } from "~/domain/spec-extract";

export type SpecFormat = "json" | "yaml";

export type SniffResult = {
  /** `"2.0"` for Swagger, otherwise the document's `openapi` value (e.g. `"3.1.0"`). */
  specVersion: string;
  format: SpecFormat;
  extract: SpecExtract;
  /** For `apiVersionOf`; kept out of `extract`, which the Judge sees. */
  versionInfo: VersionInfo;
  /** The whole Spec's outline, where `extract` keeps only a sample. */
  outline: SpecOutline;
};

export type SpecOutline = {
  /** Each path's first segment, once: `/transfer/intent/create` → `transfer`. */
  firstSegments: string[];
  /** Every tag name, as `extract.tags` lists them. */
  tags: string[];
};

type Obj = Record<string, unknown>;

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

/**
 * Decides whether a fetched document is a Spec: it must parse as JSON or YAML
 * and have `openapi: 3.x` or `swagger: "2.0"` at the top level, plus `paths`
 * or `info`. Returns `null` for anything else, including documents that fail
 * to parse.
 */
export function sniffSpec(
  bytes: Uint8Array,
  contentType: string | null,
): SniffResult | null {
  const parsed = parse(decode(bytes), contentType);
  if (!parsed || !isObj(parsed.doc)) return null;
  const doc = parsed.doc;

  let specVersion: string;
  if (typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) {
    specVersion = doc.openapi;
  } else if (doc.swagger === "2.0") {
    specVersion = "2.0";
  } else {
    return null;
  }
  if (!isObj(doc.paths) && !isObj(doc.info)) return null;

  return {
    specVersion,
    format: parsed.format,
    extract: extractFrom(doc),
    versionInfo: versionInfoFrom(doc),
    outline: outlineFrom(doc),
  };
}

function versionInfoFrom(doc: Obj): VersionInfo {
  const info = isObj(doc.info) ? doc.info : {};
  const raw = info.version;
  // YAML reads an unquoted `version: 2.0` as a number.
  const version =
    typeof raw === "string" || typeof raw === "number"
      ? String(raw).trim()
      : "";
  return {
    version: version === "" ? null : version,
    preview: info["x-preview"] === true,
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(
    bytes,
  );
}

function parse(
  text: string,
  contentType: string | null,
): { doc: unknown; format: SpecFormat } | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) return null;

  const looksJson =
    /json/i.test(contentType ?? "") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");
  if (looksJson) {
    try {
      return { doc: JSON.parse(text), format: "json" };
    } catch {
      // Not valid JSON; YAML (a superset) gets one more try below.
    }
  }

  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length > 0) return null;
  try {
    return { doc: doc.toJS({ maxAliasCount: 100 }), format: "yaml" };
  } catch {
    return null;
  }
}

function extractFrom(doc: Obj): SpecExtract {
  const info = isObj(doc.info) ? doc.info : {};
  const paths = isObj(doc.paths) ? doc.paths : {};
  const pathKeys = Object.keys(paths);
  const description =
    typeof info.description === "string"
      ? info.description.slice(0, SPEC_EXTRACT_LIMITS.description)
      : null;

  return {
    title: typeof info.title === "string" ? info.title : null,
    description,
    serverHosts: serverHosts(doc),
    tags: tagNames(doc, paths).slice(0, SPEC_EXTRACT_LIMITS.tags),
    samplePaths: pathKeys.slice(0, SPEC_EXTRACT_LIMITS.samplePaths),
    pathCount: pathKeys.length,
  };
}

function outlineFrom(doc: Obj): SpecOutline {
  const paths = isObj(doc.paths) ? doc.paths : {};
  const segments = new Set<string>();
  for (const path of Object.keys(paths)) {
    const first = path.split("/").find(Boolean);
    if (first) segments.add(first);
  }
  return { firstSegments: [...segments], tags: tagNames(doc, paths) };
}

function serverHosts(doc: Obj): string[] {
  const hosts = new Set<string>();
  if (typeof doc.host === "string" && doc.host) {
    hosts.add(doc.host.split(":")[0]?.toLowerCase() ?? doc.host);
  }
  if (Array.isArray(doc.servers)) {
    for (const server of doc.servers) {
      if (!isObj(server) || typeof server.url !== "string") continue;
      const host = hostOf(fillVariables(server.url, server.variables));
      if (host) hosts.add(host);
    }
  }
  return [...hosts];
}

/** Replaces `{name}` in a server URL with the variable's default. */
function fillVariables(url: string, variables: unknown): string {
  return url.replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const variable = isObj(variables) ? variables[name] : undefined;
    return isObj(variable) && typeof variable.default === "string"
      ? variable.default
      : whole;
  });
}

function hostOf(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? hostname : null;
  } catch {
    // Relative server URLs ("/v1") name no host.
    return null;
  }
}

/** Top-level tag names first, then any other tags the operations use. */
function tagNames(doc: Obj, paths: Obj): string[] {
  const names = new Set<string>();
  if (Array.isArray(doc.tags)) {
    for (const tag of doc.tags) {
      if (isObj(tag) && typeof tag.name === "string") names.add(tag.name);
    }
  }
  for (const item of Object.values(paths)) {
    if (!isObj(item)) continue;
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isObj(operation) || !Array.isArray(operation.tags)) continue;
      for (const tag of operation.tags) {
        if (typeof tag === "string") names.add(tag);
      }
    }
  }
  return [...names];
}

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
