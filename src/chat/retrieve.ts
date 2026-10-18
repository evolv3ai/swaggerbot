/**
 * A question's grounding: the part of one Spec a chat turn sends the model,
 * chosen by code from what the Index already stores (Slice 9, D3). Pure:
 * it takes the parsed Normalized Form and the stored Spec Outline, and
 * neither reads the Index nor calls a model.
 */
import type { SpecOutline } from "~/domain/spec-forms";
import { nearestNames } from "~/spec-forms/nearest";
import { expandOperation, schemaNames, schemaOf } from "~/spec-forms/operation";
import { stemOf, tokensOf, wordsOf } from "./words";

/** The most bytes of `text` one turn sends, the facts included. */
export const DEFAULT_BUDGET_BYTES = 48_000;

/** The most operations one turn sends. */
export const MAX_OPERATIONS = 6;

/** The most schemas one turn sends. */
export const MAX_SCHEMAS = 4;

/** The most one operation's `text` may weigh, in bytes. */
export const OPERATION_TEXT_BYTES = 6_000;

/** The most one schema's `text` may weigh, in bytes. */
export const SCHEMA_TEXT_BYTES = 4_000;

/** The most the facts' `text` may weigh, in bytes. */
export const FACTS_TEXT_BYTES = 8_000;

/** Below this many bytes left, no further operation or schema is tried. */
const MIN_DOCUMENT_BYTES = 400;

/** An operation (`method` lowercase) or a component schema, by name. */
export type GroundingRef = { method: string; path: string } | { name: string };

/**
 * One document of a turn's grounding, sent to the model as a document
 * block with citations enabled. `text` is pretty JSON: the expanded
 * operation or schema, or for `facts` the Spec's title, API Version,
 * servers, security schemes and tags with their counts.
 *
 * Wave 1 defines this shape here; the route (Slice 9, #5) reconciles it
 * with the model seam's.
 */
export type GroundingDocument =
  | { kind: "facts"; title: string; ref: null; text: string }
  | {
      kind: "operation";
      title: string;
      ref: { method: string; path: string };
      text: string;
    }
  | { kind: "schema"; title: string; ref: { name: string }; text: string };

/** A turn of the conversation so far, as the browser sends it back. */
export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  /** What the turn's answer cited. */
  cited?: readonly GroundingRef[];
};

/** The Spec a question is about. */
export type GroundingSpec = {
  outline: SpecOutline;
  /** The parsed Normalized Form. */
  doc: unknown;
  apiId: string;
  specId: string;
};

/** What a grounding holds, for the turn's log line and `chat_turns` row. */
export type GroundingStats = {
  operations: number;
  schemas: number;
  /** Bytes of `text`, all documents together. */
  bytes: number;
  factsBytes: number;
  operationBytes: number;
  schemaBytes: number;
  /** How many expansions were cut short: inlining stopped, or shrunk to fit. */
  truncated: number;
  /** The question's words that matched no operation and no schema. */
  unmatchedWords: string[];
};

export type Grounding = {
  documents: GroundingDocument[];
  stats: GroundingStats;
};

/**
 * Words that ask for an operation by what it does, and the methods they
 * stand for. A hit on the method counts as much as one on the summary.
 */
const VERB_METHODS: Readonly<Record<string, readonly string[]>> = {
  create: ["post", "put"],
  add: ["post", "put"],
  new: ["post"],
  make: ["post"],
  list: ["get"],
  get: ["get"],
  fetch: ["get"],
  retrieve: ["get"],
  read: ["get"],
  find: ["get"],
  show: ["get"],
  update: ["patch", "put", "post"],
  modify: ["patch", "put", "post"],
  change: ["patch", "put", "post"],
  edit: ["patch", "put", "post"],
  replace: ["put"],
  delete: ["delete"],
  remove: ["delete"],
};

type OutlineOperation = SpecOutline["operations"][number];

/**
 * The grounding for `question` about one Spec, within `budget` bytes of
 * `text`. The facts come first, always. Then the operations and schemas
 * cited earlier in `history` (most recent turn first), then the outline's
 * operations that best match the question's words, then the schemas whose
 * names do, at most `MAX_OPERATIONS` and `MAX_SCHEMAS`, each expanded to
 * fit its own cap and what is left of the budget. An operation or schema
 * that can't fit even cut short is passed over.
 *
 * An operation scores, for each word, the word's rarity across the
 * outline's operations, times 3 when the word is a whole literal segment of
 * the path, 2 when it is a word within one, and 1 when it hits the
 * `operationId`, summary, tags or (for a verb such as "create") the method.
 * Ties go to the shorter path, then to outline order. `apiId` and `specId`
 * are not read: they travel with the grounding so the caller can map
 * citations back to links.
 */
export function groundingFor(
  question: string,
  history: readonly ChatTurn[],
  spec: GroundingSpec,
  budget = DEFAULT_BUDGET_BYTES,
): Grounding {
  const { outline, doc } = spec;
  const words = wordsOf(question);
  const stems = words.map(stemOf);
  const facts = factsDocument(outline, doc);
  let left = budget - bytes(facts.text);

  const ranked = rankOperations(outline.operations, words, stems);
  const names = schemaNames(doc);
  const schemaRanked = rankSchemas(names, words, stems);
  const matched = new Set([...ranked.matched, ...schemaRanked.matched]);

  const cited = citedRefs(history);
  const operationRefs = uniqueRefs([
    ...cited.filter(isOperationRef),
    ...ranked.operations.map(({ method, path }) => ({ method, path })),
  ]);
  const schemaRefs = uniqueRefs([
    ...cited.filter(isSchemaRef),
    ...schemaRanked.names.map((name) => ({ name })),
  ]);

  let truncated = 0;
  const operations: GroundingDocument[] = [];
  for (const ref of operationRefs) {
    if (operations.length >= MAX_OPERATIONS) break;
    const limit = Math.min(OPERATION_TEXT_BYTES, left);
    if (limit < MIN_DOCUMENT_BYTES) break;
    const fitted = expandToFit((maxBytes) => {
      const expanded = expandOperation(doc, ref.method, ref.path, {
        maxBytes,
      });
      if (!expanded) return undefined;
      const { operation, circular, truncated } = expanded;
      return {
        value: {
          operation,
          ...(Object.keys(circular).length > 0 ? { circular } : {}),
        },
        truncated,
      };
    }, limit);
    if (!fitted) continue;
    const method = ref.method.toLowerCase();
    operations.push({
      kind: "operation",
      title: `${method.toUpperCase()} ${ref.path} (operation)`,
      ref: { method, path: ref.path },
      text: fitted.text,
    });
    left -= bytes(fitted.text);
    if (fitted.truncated) truncated += 1;
  }

  const schemas: GroundingDocument[] = [];
  for (const ref of schemaRefs) {
    if (schemas.length >= MAX_SCHEMAS) break;
    const limit = Math.min(SCHEMA_TEXT_BYTES, left);
    if (limit < MIN_DOCUMENT_BYTES) break;
    const fitted = expandToFit((maxBytes) => {
      const expanded = schemaOf(doc, ref.name, { maxBytes });
      if (!expanded) return undefined;
      const { schema, circular, truncated } = expanded;
      // The schema itself didn't fit: it is only its marker.
      if (isObj(schema) && schema["x-truncated"] === true) return null;
      return {
        value: {
          schema,
          ...(Object.keys(circular).length > 0 ? { circular } : {}),
        },
        truncated,
      };
    }, limit);
    if (!fitted) continue;
    schemas.push({
      kind: "schema",
      title: `${ref.name} (schema)`,
      ref: { name: ref.name },
      text: fitted.text,
    });
    left -= bytes(fitted.text);
    if (fitted.truncated) truncated += 1;
  }

  const documents = [facts, ...operations, ...schemas];
  const sum = (docs: GroundingDocument[]) =>
    docs.reduce((n, d) => n + bytes(d.text), 0);
  return {
    documents,
    stats: {
      operations: operations.length,
      schemas: schemas.length,
      bytes: sum(documents),
      factsBytes: bytes(facts.text),
      operationBytes: sum(operations),
      schemaBytes: sum(schemas),
      truncated,
      unmatchedWords: words.filter((w) => !matched.has(w)),
    },
  };
}

/**
 * The facts document: the Spec's title, API Version, servers, security
 * schemes (as the Normalized Form defines them) and tags with their counts,
 * held to `FACTS_TEXT_BYTES` by keeping only the largest tags, then the
 * outline's short form of the security schemes, then the first servers.
 */
function factsDocument(outline: SpecOutline, doc: unknown): GroundingDocument {
  const fullSchemes = securitySchemesOf(doc);
  const facts: Record<string, unknown> = {
    title: outline.title,
    apiVersion: outline.apiVersion,
    servers: outline.servers,
    securitySchemes: fullSchemes ?? outline.securitySchemes,
    tags: outline.tags,
  };
  const fits = () => bytes(pretty(facts)) <= FACTS_TEXT_BYTES;

  if (!fits()) {
    // A stable sort: tags with the same count keep the outline's order.
    const largest = [...outline.tags].sort(
      (a, b) => b.operationCount - a.operationCount,
    );
    let keep = largest.length;
    facts.tagsCut = true;
    while (keep > 0 && !fits()) {
      keep = Math.floor(keep / 2);
      facts.tags = largest.slice(0, keep);
    }
  }
  if (!fits()) facts.securitySchemes = outline.securitySchemes;
  if (!fits()) facts.servers = outline.servers.slice(0, 5);
  if (!fits())
    facts.securitySchemes = outline.securitySchemes.map(({ name }) => name);

  return {
    kind: "facts",
    title: "About this Spec",
    ref: null,
    text: pretty(facts),
  };
}

function securitySchemesOf(doc: unknown): Record<string, unknown> | undefined {
  if (!isObj(doc) || !isObj(doc.components)) return undefined;
  const schemes = doc.components.securitySchemes;
  return isObj(schemes) ? schemes : undefined;
}

/**
 * The outline's operations that some word hits, best first, and the words
 * that hit at least one.
 */
function rankOperations(
  operations: readonly OutlineOperation[],
  words: readonly string[],
  stems: readonly string[],
): { operations: OutlineOperation[]; matched: Set<string> } {
  const indexed = operations.map((op, index) => {
    const literal = op.path
      .split("/")
      .filter((s) => s !== "" && !/^\{[^}]*\}$/.test(s));
    const segmentStems = new Set(literal.map((s) => stemOf(s.toLowerCase())));
    const pathStems = new Set(tokensOf(literal.join(" ")).map(stemOf));
    const otherStems = new Set(
      tokensOf(
        [op.operationId ?? "", op.summary ?? "", ...op.tags].join(" "),
      ).map(stemOf),
    );
    const method = op.method.toLowerCase();
    // Per word: 3 for a whole path segment, 2 for a word within one, 1 for
    // any other hit, 0 for none.
    const hits = words.map((word, i): number => {
      const stem = stems[i] as string;
      if (segmentStems.has(stem)) return 3;
      if (pathStems.has(stem)) return 2;
      if (otherStems.has(stem)) return 1;
      if (VERB_METHODS[word]?.includes(method)) return 1;
      return 0;
    });
    return { op, index, hits, segments: literal.length };
  });

  // A word that hits few operations says more than one that hits many.
  const total = operations.length;
  const weights = words.map((_, i) => {
    const df = indexed.filter((x) => (x.hits[i] as number) > 0).length;
    return df === 0 ? 0 : Math.log(1 + total / df);
  });
  const matched = new Set(words.filter((_, i) => (weights[i] as number) > 0));

  const scored = indexed
    .map((x) => ({
      ...x,
      score: x.hits.reduce((s, h, i) => s + h * (weights[i] as number), 0),
    }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.segments - b.segments || a.index - b.index,
    );
  return { operations: scored.map((x) => x.op), matched };
}

/**
 * The schema names one of whose words (`tokensOf`, stemmed) is a word of
 * the question, best first, and the words that hit at least one. Verbs
 * (`VERB_METHODS`) are not matched against names. A name all of whose
 * words the question holds comes first, the one with more words first;
 * then a name scores the rarity of each word it holds, and ties go to the
 * name with fewer words, then to the one `nearestNames` puts nearer the
 * first word it holds.
 */
function rankSchemas(
  names: readonly string[],
  words: readonly string[],
  stems: readonly string[],
): { names: string[]; matched: Set<string> } {
  const matched = new Set<string>();
  const found = new Map<string, { score: number; order: number }>();
  const stemsByName = new Map<string, Set<string>>();
  const stemsOf = (name: string) => {
    let set = stemsByName.get(name);
    if (!set) {
      set = new Set(tokensOf(name).map(stemOf));
      stemsByName.set(name, set);
    }
    return set;
  };

  let order = 0;
  words.forEach((word, i) => {
    // A verb says what to do, not which schema.
    if (Object.hasOwn(VERB_METHODS, word)) return;
    const stem = stems[i] as string;
    const holding = names.filter((name) => stemsOf(name).has(stem));
    if (holding.length === 0) return;
    matched.add(word);
    const weight = Math.log(1 + names.length / holding.length);
    for (const name of nearestNames(holding, word, holding.length)) {
      const entry = found.get(name) ?? { score: 0, order: order++ };
      entry.score += weight;
      found.set(name, entry);
    }
  });

  // A name every word of which the question holds ("PaymentIntent" for
  // `payment_intent`) is the schema it names: those come first, longest
  // first.
  const asked = new Set(stems);
  const named = (name: string) =>
    [...stemsOf(name)].every((stem) => asked.has(stem))
      ? stemsOf(name).size
      : 0;
  const ranked = [...found]
    .sort(
      ([a, x], [b, y]) =>
        named(b) - named(a) ||
        y.score - x.score ||
        stemsOf(a).size - stemsOf(b).size ||
        x.order - y.order,
    )
    .map(([name]) => name);
  return { names: ranked, matched };
}

/** Every operation and schema cited in `history`, the most recent turn first. */
function citedRefs(history: readonly ChatTurn[]): GroundingRef[] {
  return [...history].reverse().flatMap((turn) => turn.cited ?? []);
}

function uniqueRefs<T extends GroundingRef>(refs: readonly T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key =
      "name" in ref
        ? `schema ${ref.name}`
        : `${ref.method.toLowerCase()} ${ref.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isOperationRef(
  ref: GroundingRef,
): ref is { method: string; path: string } {
  return "method" in ref;
}

function isSchemaRef(ref: GroundingRef): ref is { name: string } {
  return "name" in ref;
}

/**
 * How far an expansion is shrunk to fit: as it is; descriptions cut to
 * `SHORT_DESCRIPTION_CHARS`; descriptions and `x-` extensions dropped; then
 * that, and nesting cut below 12, then 8 down to 3 levels. At 3 a schema's
 * properties are still named, each as `{ "x-cut": true }`.
 */
const SHRINK_LEVELS = [
  { descriptions: "keep", depth: Infinity },
  { descriptions: "short", depth: Infinity },
  { descriptions: "drop", depth: Infinity },
  { descriptions: "drop", depth: 12 },
  { descriptions: "drop", depth: 8 },
  { descriptions: "drop", depth: 7 },
  { descriptions: "drop", depth: 6 },
  { descriptions: "drop", depth: 5 },
  { descriptions: "drop", depth: 4 },
  { descriptions: "drop", depth: 3 },
] as const;

type ShrinkLevel = (typeof SHRINK_LEVELS)[number];

const SHORT_DESCRIPTION_CHARS = 200;

/** The most an expansion that will be shrunk may inline, in bytes. */
const MAX_SHRINK_CAP = 256_000;

/** What an expansion gives `expandToFit`: `null` when it won't fit under `maxBytes`. */
type Expansion = { value: Record<string, unknown>; truncated: boolean };

/**
 * The pretty JSON of what `expand` returns, at most `limit` bytes. An
 * expansion is capped on its minified size, and its pretty form is larger,
 * so the cap is lowered in proportion until the text fits; failing that,
 * the next `SHRINK_LEVELS` level is tried, from a cap high enough to inline
 * what it then cuts (raised, up to `MAX_SHRINK_CAP`, while `expand` says
 * the object itself doesn't fit). `undefined` when there is nothing to expand (`expand`
 * returns `undefined`), or it won't fit even shrunk.
 */
function expandToFit(
  expand: (maxBytes: number) => Expansion | null | undefined,
  limit: number,
): { text: string; truncated: boolean } | undefined {
  for (const level of SHRINK_LEVELS) {
    let cap = level.descriptions === "keep" ? limit : limit * 4;
    for (let attempt = 0; attempt < 5 && cap > 0; attempt++) {
      const expanded = expand(cap);
      if (expanded === undefined) return undefined;
      if (expanded === null) {
        // Too little to inline even the object itself: shrinking needs more.
        if (level === SHRINK_LEVELS[0] || cap >= MAX_SHRINK_CAP) break;
        cap = Math.min(cap * 4, MAX_SHRINK_CAP);
        continue;
      }
      const asIs = level === SHRINK_LEVELS[0];
      const value = asIs
        ? expanded.value
        : (shrink(expanded.value, level, 0) as Record<string, unknown>);
      const truncated = expanded.truncated || !asIs;
      const text = pretty({ ...value, truncated });
      const size = bytes(text);
      if (size <= limit) return { text, truncated };
      cap = Math.floor((cap * limit * 0.95) / size);
    }
  }
  return undefined;
}

/** A copy of `node` shrunk to `level`; `depth` is how deep `node` is. */
function shrink(node: unknown, level: ShrinkLevel, depth: number): unknown {
  if (Array.isArray(node))
    return depth >= level.depth
      ? { "x-cut": true }
      : node.map((item) => shrink(item, level, depth + 1));
  if (!isObj(node)) return node;
  if (depth >= level.depth) return { "x-cut": true };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "description" && typeof value === "string") {
      if (level.descriptions === "drop") continue;
      out[key] =
        value.length > SHORT_DESCRIPTION_CHARS
          ? `${value.slice(0, SHORT_DESCRIPTION_CHARS - 1)}…`
          : value;
      continue;
    }
    if (
      level.descriptions === "drop" &&
      key.startsWith("x-") &&
      key !== "x-circular" &&
      key !== "x-truncated"
    )
      continue;
    out[key] = shrink(value, level, depth + 1);
  }
  return out;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** The UTF-8 length of `text`. */
function bytes(text: string): number {
  return Buffer.byteLength(text);
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
