import {
  bundle,
  type LifecyclePlugin,
  type LoaderPlugin,
  resolveReferencePath,
} from "@scalar/json-magic/bundle";
import { upgrade, validate } from "@scalar/openapi-parser";
import { parseDocument } from "yaml";
import type { SpecOutline, ValidityIssue } from "~/domain/spec-forms";

/**
 * The version of this builder's output. Bump it whenever the builder's output
 * changes for a Spec already built: the forms worker then rebuilds every
 * stored Spec's forms, keeping the old ones until the new are saved.
 */
export const FORMS_BUILDER_VERSION = 1;

/**
 * Default ceiling on the Published Form's bytes. A build of Cloudflare's 26 MB
 * Spec peaks near 830 MB RSS in a 2 GB container (ADR 0004), so anything
 * larger than this is refused rather than built. `MAX_FORMS_BYTES` overrides it.
 */
export const DEFAULT_MAX_FORMS_BYTES = 32 * 1024 * 1024;

/**
 * Swagger 2 keys that have no place in OpenAPI 3.1 and that Scalar's upgrader
 * can leave behind (ADR 0004: Kubernetes' Spec gained 1,202 findings after
 * `upgrade`, every one an operation-level `schemes`). The builder deletes them
 * from the Normalized Form.
 */
export const SWAGGER2_LEFTOVER_KEYS = {
  root: [
    "host",
    "basePath",
    "schemes",
    "consumes",
    "produces",
    "securityDefinitions",
    "definitions",
  ],
  operation: ["schemes", "consumes", "produces"],
} as const;

/**
 * Parameter Object keys that apply only when `in` is `query`. OpenAPI 3.0's
 * text says `allowReserved` is ignored elsewhere though its schema allows it;
 * 3.1's schema rejects it, and the upgrader keeps it (ADR 0004: Cloudflare's
 * Spec had 3 findings, all on a `path` parameter). The builder deletes them
 * from the Normalized Form's other parameters.
 */
export const QUERY_ONLY_PARAMETER_KEYS = ["allowReserved"] as const;

export type SpecFormsErrorKind = "too-large" | "unparseable" | "not-openapi";

export class SpecFormsError extends Error {
  readonly kind: SpecFormsErrorKind;
  constructor(kind: SpecFormsErrorKind, message: string) {
    super(message);
    this.name = "SpecFormsError";
    this.kind = kind;
  }
}

/** The steps of a build, in order; `onStep` is awaited after each one. */
export type SpecFormsStep =
  | "parse"
  | "bundle"
  | "validate"
  | "upgrade"
  | "strip"
  | "validate-normalized"
  | "outline"
  | "serialize";

export type SpecFormsInput = {
  /** The Published Form. Never modified. */
  bytes: Uint8Array;
  format: "json" | "yaml";
  /** Where the Spec was found; external `$ref`s resolve against it. */
  sourceUrl: string;
  /** Fetches a same-origin external `$ref`. Omitted, none are fetched. */
  fetchRef?: (url: string) => Promise<Uint8Array>;
  /** Awaited after each step, so a caller can time the build or yield. */
  onStep?: (step: SpecFormsStep) => void | Promise<void>;
  /** Where `MAX_FORMS_BYTES` is read from. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** Receives the warning for an unusable `MAX_FORMS_BYTES`. */
  warn?: (message: string) => void;
};

export type SpecForms = {
  /**
   * The Normalized Form, as minified JSON: bundled, upgraded to OpenAPI 3.1,
   * with each operation written as a `$ref` replaced by a copy of its target,
   * and likewise each Response's `headers`, Operation's `responses`, Request
   * Body's or Response's `content` and Schema's `properties` written as one.
   */
  normalized: Uint8Array;
  /** The Normalized Form's `openapi` field. */
  normalizedSpecVersion: string;
  /** Every group of findings on the Published Form. */
  validityIssues: ValidityIssue[];
  /** How many findings there were before grouping. */
  validityFindingCount: number;
  /** Findings left on the Normalized Form: our defect, not a Validity Issue. */
  normalizedFindingCount: number;
  outline: SpecOutline;
};

type Obj = Record<string, unknown>;
type Finding = { message: string; path: string };

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

/**
 * The validator's own finding for an external `$ref` it can't follow. Step 2
 * already reports each unresolved reference as a Validity Issue, and on the
 * Normalized Form it isn't our defect, so both validations drop it.
 */
const EXTERNAL_REFERENCE_NOT_FOUND = "EXTERNAL_REFERENCE_NOT_FOUND";

/**
 * A false positive of Scalar's reference resolver: it takes any `$ref` key for
 * a reference, including a schema property named `$ref` (Kubernetes'
 * `JSONSchemaProps` has one), and reports the object it finds there. A `$ref`
 * that really is malformed where a Reference Object belongs still fails schema
 * validation, so dropping this finding hides nothing.
 */
const OBJECT_REFERENCE_FALSE_POSITIVE =
  "Can't resolve reference: [object Object]";

/**
 * Builds a Spec's Normalized Form (bundled, upgraded to OpenAPI 3.1, with each
 * operation, and each map where only its values may be, written as a `$ref`
 * inlined, as minified JSON), its Validity Issues and its Spec Outline from
 * the Published Form (ADR 0004).
 */
export async function buildSpecForms(
  input: SpecFormsInput,
): Promise<SpecForms> {
  const step = async (name: SpecFormsStep) => {
    await input.onStep?.(name);
  };
  const maxBytes = maxFormsBytesFromEnv(
    input.env ?? process.env,
    input.warn ?? console.warn,
  );
  if (input.bytes.byteLength > maxBytes)
    throw new SpecFormsError(
      "too-large",
      `too large: ${input.bytes.byteLength} bytes is over MAX_FORMS_BYTES (${maxBytes})`,
    );

  // 1. Parse.
  const published = parseSpec(input.bytes, input.format);
  await step("parse");

  // 2. Bundle external references.
  const unresolved = await bundleExternalRefs(
    published,
    input.sourceUrl,
    input.fetchRef,
  );
  await step("bundle");

  // 3. Validate the Published Form, at its own version.
  const findings = [...unresolved, ...(await findingsOf(published))];
  await step("validate");

  // 4. Upgrade a copy: `upgrade` mutates its input.
  const upgraded = upgrade(structuredClone(published)).specification;
  if (!isObj(upgraded))
    throw new SpecFormsError(
      "not-openapi",
      "The Published Form could not be upgraded to OpenAPI 3.1",
    );
  const normalized: Obj = upgraded;
  await step("upgrade");

  // 5. Inline each operation written as an internal `$ref` (bundling turns an
  // operation in another file into one), and each map written as one where
  // OpenAPI allows a `$ref` only for its values (`headers`, `responses`,
  // `content`, `properties`); then strip the Swagger 2 keys the upgrader
  // leaves behind, and the query-only keys on other parameters.
  inlineOperationRefs(normalized);
  inlineMapRefs(normalized);
  stripSwagger2Leftovers(normalized);
  stripQueryOnlyParameterKeys(normalized);
  await step("strip");

  // 6. Validate the Normalized Form.
  const normalizedFindingCount = (await findingsOf(normalized)).length;
  await step("validate-normalized");

  // 7. Outline.
  const outline = outlineOf(normalized);
  await step("outline");

  // 8. Serialize.
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  await step("serialize");

  return {
    normalized: bytes,
    normalizedSpecVersion: String(normalized.openapi),
    validityIssues: groupFindings(findings),
    validityFindingCount: findings.length,
    normalizedFindingCount,
    outline,
  };
}

/** `MAX_FORMS_BYTES` when it is a positive integer, else the default. */
function maxFormsBytesFromEnv(
  env: Record<string, string | undefined>,
  warn: (message: string) => void,
): number {
  const raw = env.MAX_FORMS_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_FORMS_BYTES;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(value) && value > 0) return value;
  warn(
    `MAX_FORMS_BYTES "${raw}" is not a positive integer; using ${DEFAULT_MAX_FORMS_BYTES} bytes (32 MB).`,
  );
  return DEFAULT_MAX_FORMS_BYTES;
}

function parseSpec(bytes: Uint8Array, format: "json" | "yaml"): Obj {
  const doc = parseText(decode(bytes), format);
  if (doc === undefined)
    throw new SpecFormsError(
      "unparseable",
      `The Published Form does not parse as ${format === "json" ? "JSON" : "YAML"}`,
    );
  const isSpec =
    isObj(doc) &&
    ((typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) ||
      doc.swagger === "2.0");
  if (!isSpec)
    throw new SpecFormsError(
      "not-openapi",
      "The Published Form is not an OpenAPI or Swagger document",
    );
  return doc;
}

/** The parsed document, or `undefined` when it doesn't parse. */
function parseText(text: string, format: "json" | "yaml"): unknown {
  if (format === "json") {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length > 0) return undefined;
  try {
    return doc.toJS({ maxAliasCount: 100 });
  } catch {
    return undefined;
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(
    bytes,
  );
}

/**
 * Bundles `doc`'s external `$ref`s into it, in place, with `@scalar/json-magic`.
 * A reference is fetched through `fetchRef` only when its absolute URL has the
 * same origin as `sourceUrl`; internal (`#/…`) references are never fetched.
 * Returns a finding for each reference left unresolved.
 */
async function bundleExternalRefs(
  doc: Obj,
  sourceUrl: string,
  fetchRef: SpecFormsInput["fetchRef"],
): Promise<Finding[]> {
  if (!hasExternalRef(doc)) return [];

  const sourceOrigin = httpOrigin(sourceUrl);
  const unresolved: Finding[] = [];
  const seen = new WeakMap<
    object,
    { path: readonly string[]; origin: string }
  >();

  const loader: LoaderPlugin = {
    type: "loader",
    validate: () => true,
    exec: async (url) => {
      if (
        !fetchRef ||
        sourceOrigin === null ||
        httpOrigin(url) !== sourceOrigin
      )
        return { ok: false };
      try {
        const text = decode(await fetchRef(url));
        const data = parseText(text, /^\s*[{[]/.test(text) ? "json" : "yaml");
        return data === undefined
          ? { ok: false }
          : { ok: true, data, raw: text };
      } catch {
        return { ok: false };
      }
    },
  };
  const tracker: LifecyclePlugin = {
    type: "lifecycle",
    onBeforeNodeProcess: (node, context) => {
      seen.set(node, { path: context.path, origin: context.origin });
    },
    onResolveError: (node) => {
      const at = seen.get(node);
      const [target = ""] = String(node.$ref).split("#", 1);
      const url = at ? resolveReferencePath(at.origin, target) : target;
      unresolved.push({
        message: `Unresolved external reference: ${url}`,
        path: toPointer(at?.path ?? []),
      });
    },
  };

  await bundle(doc, {
    plugins: [loader, tracker],
    treeShake: false,
    origin: sourceUrl,
  });
  return unresolved;
}

/** Whether any `$ref` in `doc` points outside it. */
function hasExternalRef(doc: unknown): boolean {
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (isObj(node)) {
      if (typeof node.$ref === "string" && !node.$ref.startsWith("#"))
        return true;
      for (const value of Object.values(node))
        if (typeof value === "object" && value !== null) stack.push(value);
    }
  }
  return false;
}

/** The origin of an `http:`/`https:` URL, else `null`. */
function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * The validator's findings on `doc`. `validate` fills in a missing
 * `info.version` before validating; that is undone, so the document is left
 * as it was.
 */
async function findingsOf(doc: Obj): Promise<Finding[]> {
  const info = doc.info;
  const hadVersion = isObj(info) && "version" in info;
  const result = await validate(doc);
  if (isObj(info) && !hadVersion) delete info.version;
  return (result.errors ?? [])
    .filter(
      (error) =>
        error.code !== EXTERNAL_REFERENCE_NOT_FOUND &&
        error.message !== OBJECT_REFERENCE_FALSE_POSITIVE,
    )
    .map((error) => ({
      message: error.message,
      path: Array.isArray(error.path)
        ? toPointer(error.path)
        : (error.path ?? ""),
    }));
}

/** Groups findings by message, in order of each message's first finding. */
function groupFindings(findings: readonly Finding[]): ValidityIssue[] {
  const groups = new Map<string, ValidityIssue>();
  for (const { message, path } of findings) {
    const group = groups.get(message);
    if (group) group.count += 1;
    else groups.set(message, { message, path, count: 1 });
  }
  return [...groups.values()];
}

/**
 * Replaces each operation that is an internal `$ref` with a copy of its target,
 * following a chain of such references; keys written beside a `$ref` override
 * its target's. OpenAPI allows a `$ref` for a Path Item but not an Operation,
 * yet DigitalOcean's Spec writes every operation as one. The target stays in
 * place; a reference that can't be resolved, or that is part of a cycle, stays
 * as it is.
 */
function inlineOperationRefs(doc: Obj): void {
  if (!isObj(doc.paths)) return;
  for (const value of Object.values(doc.paths)) {
    const item = resolveLocal(doc, value);
    if (!isObj(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const inlined = inlinedRef(doc, operation);
      if (inlined) item[method] = inlined.value;
    }
  }
}

/**
 * A copy of what `value`'s chain of internal `$ref`s leads to, if any, with the
 * keys written beside each `$ref` over its target's, and the chain's `$ref`s.
 */
function inlinedRef(
  doc: Obj,
  value: unknown,
): { value: Obj; refs: string[] } | undefined {
  const chain: Obj[] = [];
  let node = value;
  while (isObj(node) && typeof node.$ref === "string") {
    if (chain.includes(node)) return undefined;
    chain.push(node);
    const target = resolveLocal(doc, node);
    if (target === node) return undefined;
    node = target;
  }
  if (chain.length === 0 || !isObj(node)) return undefined;
  const inlined = structuredClone(node);
  const refs = chain.map((link) => String(link.$ref));
  for (const { $ref: _, ...beside } of chain.reverse())
    Object.assign(inlined, structuredClone(beside));
  return { value: inlined, refs };
}

/**
 * Replaces each map written as an internal `$ref` with a copy of its target,
 * as `inlinedRef` does: a Response's `headers`, an Operation's `responses`, a
 * Request Body's or Response's `content` and a Schema's `properties`. OpenAPI
 * allows a `$ref` for each of their values but not for the map, yet
 * DigitalOcean's Spec writes a response's `headers` as a `$ref` to a file of
 * several headers, which bundling turns into an internal one. It walks each
 * operation, each Response under `components.responses` and each Schema under
 * `components.schemas`, with their nested Schemas. The target stays in place;
 * a reference that can't be resolved, or whose copy would contain it again,
 * stays as it is. Each copy is walked afresh, so maps that reference one
 * another can multiply without a cycle (each level doubling the copies): after
 * `MAX_MAP_INLINES` copies in one document, every further one stays a `$ref`.
 */
/**
 * The most maps `inlineMapRefs` copies into one document. Real Specs need far
 * fewer; the cap only stops maps that multiply one another.
 */
export const MAX_MAP_INLINES = 10_000;

function inlineMapRefs(doc: Obj): void {
  type Expanding = ReadonlySet<string>;
  const visited = new WeakSet<object>();
  let inlines = 0;

  /** Inlines `owner[key]`; returns the map and the refs expanded to reach it. */
  const inlineMap = (owner: Obj, key: string, expanding: Expanding) => {
    if (inlines >= MAX_MAP_INLINES) return { map: owner[key], expanding };
    const inlined = inlinedRef(doc, owner[key]);
    if (!inlined || inlined.refs.some((ref) => expanding.has(ref)))
      return { map: owner[key], expanding };
    inlines++;
    owner[key] = inlined.value;
    return {
      map: inlined.value,
      expanding: new Set([...expanding, ...inlined.refs]),
    };
  };
  const firstVisit = (node: unknown): node is Obj => {
    if (!isObj(node) || visited.has(node)) return false;
    visited.add(node);
    return true;
  };

  const walkSchema = (schema: unknown, expanding: Expanding): void => {
    if (Array.isArray(schema)) {
      for (const item of schema) walkSchema(item, expanding);
      return;
    }
    if (!firstVisit(schema)) return;
    const properties = inlineMap(schema, "properties", expanding);
    if (isObj(properties.map))
      for (const property of Object.values(properties.map))
        walkSchema(property, properties.expanding);
    for (const key of ["items", "allOf", "anyOf", "oneOf"])
      walkSchema(schema[key], expanding);
    walkSchema(schema.additionalProperties, expanding);
  };
  const walkContent = (owner: Obj, expanding: Expanding): void => {
    const content = inlineMap(owner, "content", expanding);
    if (!isObj(content.map)) return;
    for (const media of Object.values(content.map))
      if (isObj(media)) walkSchema(media.schema, content.expanding);
  };
  const walkResponse = (response: unknown, expanding: Expanding): void => {
    if (!firstVisit(response)) return;
    inlineMap(response, "headers", expanding);
    walkContent(response, expanding);
  };
  const walkOperation = (operation: Obj): void => {
    const responses = inlineMap(operation, "responses", new Set());
    if (isObj(responses.map))
      for (const response of Object.values(responses.map))
        walkResponse(response, responses.expanding);
    if (isObj(operation.requestBody))
      walkContent(operation.requestBody, new Set());
  };

  if (isObj(doc.paths))
    for (const value of Object.values(doc.paths)) {
      const item = resolveLocal(doc, value);
      if (!isObj(item)) continue;
      for (const [method, operation] of Object.entries(item))
        if (HTTP_METHODS.has(method) && isObj(operation))
          walkOperation(operation);
    }
  const components = isObj(doc.components) ? doc.components : {};
  if (isObj(components.responses))
    for (const response of Object.values(components.responses))
      walkResponse(response, new Set());
  if (isObj(components.schemas))
    for (const schema of Object.values(components.schemas))
      walkSchema(schema, new Set());
}

function stripSwagger2Leftovers(doc: Obj): void {
  for (const key of SWAGGER2_LEFTOVER_KEYS.root) delete doc[key];
  if (!isObj(doc.paths)) return;
  for (const item of Object.values(doc.paths)) {
    if (!isObj(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !isObj(operation)) continue;
      for (const key of SWAGGER2_LEFTOVER_KEYS.operation) delete operation[key];
    }
  }
}

function stripQueryOnlyParameterKeys(doc: Obj): void {
  const strip = (parameter: unknown) => {
    if (!isObj(parameter) || "$ref" in parameter || parameter.in === "query")
      return;
    for (const key of QUERY_ONLY_PARAMETER_KEYS) delete parameter[key];
  };
  const stripAll = (parameters: unknown) => {
    if (Array.isArray(parameters)) parameters.forEach(strip);
  };
  if (isObj(doc.paths))
    for (const item of Object.values(doc.paths)) {
      if (!isObj(item)) continue;
      stripAll(item.parameters);
      for (const [method, operation] of Object.entries(item))
        if (HTTP_METHODS.has(method) && isObj(operation))
          stripAll(operation.parameters);
    }
  if (isObj(doc.components) && isObj(doc.components.parameters))
    Object.values(doc.components.parameters).forEach(strip);
}

/** The Spec Outline of a Normalized Form (see `SpecOutline`). */
function outlineOf(doc: Obj): SpecOutline {
  const info = isObj(doc.info) ? doc.info : {};

  const servers = Array.isArray(doc.servers)
    ? doc.servers.flatMap((server) =>
        isObj(server) && typeof server.url === "string" ? [server.url] : [],
      )
    : [];

  const schemes =
    isObj(doc.components) && isObj(doc.components.securitySchemes)
      ? doc.components.securitySchemes
      : {};
  const securitySchemes: SpecOutline["securitySchemes"] = [];
  for (const [name, value] of Object.entries(schemes)) {
    const scheme = resolveLocal(doc, value);
    if (!isObj(scheme) || typeof scheme.type !== "string") continue;
    securitySchemes.push({
      name,
      type: scheme.type,
      ...(typeof scheme.scheme === "string" ? { scheme: scheme.scheme } : {}),
      ...(typeof scheme.in === "string" ? { in: scheme.in } : {}),
    });
  }

  const operations: SpecOutline["operations"] = [];
  const paths = isObj(doc.paths) ? doc.paths : {};
  for (const [path, value] of Object.entries(paths)) {
    const item = resolveLocal(doc, value);
    if (!isObj(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !isObj(op)) continue;
      operations.push({
        method,
        path,
        ...(typeof op.operationId === "string"
          ? { operationId: op.operationId }
          : {}),
        ...(typeof op.summary === "string" ? { summary: op.summary } : {}),
        tags: Array.isArray(op.tags)
          ? op.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        ...(op.deprecated === true ? { deprecated: true as const } : {}),
      });
    }
  }

  const tagCounts = new Map<string, number>();
  if (Array.isArray(doc.tags))
    for (const tag of doc.tags)
      if (
        isObj(tag) &&
        typeof tag.name === "string" &&
        !tagCounts.has(tag.name)
      )
        tagCounts.set(tag.name, 0);
  for (const op of operations)
    for (const tag of new Set(op.tags))
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

  return {
    title: typeof info.title === "string" ? info.title : null,
    apiVersion: typeof info.version === "string" ? info.version : null,
    servers,
    securitySchemes,
    tags: [...tagCounts].map(([name, operationCount]) => ({
      name,
      operationCount,
    })),
    operations,
  };
}

/** `value`, or what its internal `$ref` points to (one hop). */
function resolveLocal(doc: Obj, value: unknown): unknown {
  if (!isObj(value) || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) return value;
  let node: unknown = doc;
  for (const segment of value.$ref.slice(2).split("/")) {
    if (!isObj(node)) return value;
    node = node[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return node ?? value;
}

function toPointer(segments: readonly string[]): string {
  return segments
    .map((s) => `/${s.replaceAll("~", "~0").replaceAll("/", "~1")}`)
    .join("");
}

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
