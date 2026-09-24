/**
 * `get_operation`'s expansion: one operation of a Normalized Form with every
 * reference it reaches inlined, so a Caller can call it without chasing
 * `$ref`s (PRD "Surfaces"; slice 4, #6).
 */

/** The most a `get_operation` response may weigh, serialized, in bytes. */
export const MAX_OPERATION_BYTES = 1_000_000;

/** The HTTP methods an OpenAPI Path Item holds operations under. */
export const OPERATION_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

type Obj = Record<string, unknown>;

/** An operation with its references inlined (`expandOperation`). */
export type ExpandedOperation = {
  /**
   * The operation, with its Path Item's `parameters` merged in and its
   * effective `security`, every reference it reaches inlined.
   */
  operation: Obj;
  /**
   * Each schema that recurs within itself, once, expanded under the same
   * rule, by name (`X` for `#/components/schemas/X`; any other target by its
   * whole `$ref`). Where it recurs it is `{ $ref, "x-circular": true }`.
   */
  circular: Record<string, unknown>;
  /** The security schemes the effective `security` names, by name. */
  securitySchemes: Record<string, unknown>;
  /**
   * Whether inlining stopped at the byte cap. Every reference left then is
   * `{ $ref, "x-truncated": true }`.
   */
  truncated: boolean;
};

export type ExpandOptions = {
  /**
   * The most the serialized result may weigh, in bytes (UTF-8); the caller
   * leaves room for what it adds around it. `MAX_OPERATION_BYTES` by default.
   */
  maxBytes?: number;
};

/** A reference waiting to be inlined, and where its result goes. */
type Slot = {
  parent: Obj | unknown[];
  key: string | number;
  ref: string;
  /** The keys beside `$ref`, which override the target's. */
  siblings: Obj;
  /** The references being expanded above this one, on its branch. */
  above: ReadonlySet<string>;
};

/**
 * The operation `method` (any case) on `path` (a key of `paths`, exactly) of
 * the Normalized Form `doc`, with every internal reference it reaches inlined
 * at any depth: parameters, request bodies, responses, headers, schemas.
 * `undefined` when the Spec has no such operation.
 *
 * A reference already being expanded higher on the same branch becomes
 * `{ $ref, "x-circular": true }`, and its target is listed once in
 * `circular`. One that merely appears on two branches is inlined on both.
 * References are expanded breadth-first, and inlining stops when the result
 * would pass `maxBytes`, so what is cut is the deepest detail. Neither `doc`
 * nor anything in it is changed.
 */
export function expandOperation(
  doc: unknown,
  method: string,
  path: string,
  options: ExpandOptions = {},
): ExpandedOperation | undefined {
  if (!isObj(doc) || !isObj(doc.paths)) return undefined;
  const verb = method.toLowerCase();
  if (!(OPERATION_METHODS as readonly string[]).includes(verb))
    return undefined;
  if (!Object.hasOwn(doc.paths, path)) return undefined;
  const pathItem = follow(doc, doc.paths[path]);
  const found = isObj(pathItem) ? pathItem[verb] : undefined;
  if (!isObj(found)) return undefined;

  const merged: Obj = { ...found };
  const parameters = mergeParameters(
    doc,
    asArray(pathItem?.parameters),
    asArray(found.parameters),
  );
  if (parameters.length > 0) merged.parameters = parameters;
  const security = found.security ?? doc.security;
  if (security !== undefined) merged.security = security;

  const queue: Slot[] = [];
  const operation = copy(merged, new Set(), queue) as Obj;
  const securitySchemes = schemesOf(doc, security, queue);
  return inlineQueued(
    doc,
    { operation, circular: {}, securitySchemes, truncated: false },
    queue,
    options.maxBytes ?? MAX_OPERATION_BYTES,
  );
}

/** A component schema with its references inlined (`schemaOf`). */
export type ExpandedSchema = {
  /** The schema's name: `X` for `#/components/schemas/X`. */
  name: string;
  /** The schema, every reference it reaches inlined. */
  schema: unknown;
  /** As `ExpandedOperation.circular`; the schema itself when it recurs. */
  circular: Record<string, unknown>;
  /** As `ExpandedOperation.truncated`. */
  truncated: boolean;
};

/**
 * `components.schemas[name]` of the Normalized Form `doc`, expanded as
 * `expandOperation` expands an operation: breadth-first, a schema that
 * recurs within itself as `{ $ref, "x-circular": true }` and listed in
 * `circular`, inlining stopped at `maxBytes`. `name` is the bare name or
 * the whole `#/components/schemas/<name>` reference. `undefined` when the
 * Spec has no such schema.
 */
export function schemaOf(
  doc: unknown,
  name: string,
  options: ExpandOptions = {},
): ExpandedSchema | undefined {
  if (!isObj(doc)) return undefined;
  const bare = schemaNameOf(name);
  const schemas = componentSchemas(doc);
  if (!Object.hasOwn(schemas, bare)) return undefined;
  const ref = `#/components/schemas/${encodePointer(bare)}`;
  const result: ExpandedSchema = {
    name: bare,
    schema: marker(ref, "x-truncated"),
    circular: {},
    truncated: false,
  };
  // The schema itself is the first reference inlined, so one that refers
  // to itself is circular, and one that is only a reference is followed.
  const queue: Slot[] = [
    {
      parent: result as Obj,
      key: "schema",
      ref,
      siblings: {},
      above: new Set(),
    },
  ];
  return inlineQueued(
    doc,
    result,
    queue,
    options.maxBytes ?? MAX_OPERATION_BYTES,
  );
}

/** The names of the Normalized Form's `components.schemas`, in document order. */
export function schemaNames(doc: unknown): string[] {
  return isObj(doc) ? Object.keys(componentSchemas(doc)) : [];
}

/** `X` for `#/components/schemas/X` (pointer-decoded); any other string as it is. */
export function schemaNameOf(nameOrRef: string): string {
  const segments = pointerSegments(nameOrRef);
  return segments?.length === 3 &&
    segments[0] === "components" &&
    segments[1] === "schemas"
    ? (segments[2] as string)
    : nameOrRef;
}

/**
 * The distinct references an expansion left as
 * `{ $ref, "x-truncated": true }`, in the order they are met.
 */
export function truncatedReferences(expanded: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isObj(node)) {
      if (typeof node.$ref === "string" && node["x-truncated"] === true)
        found.add(node.$ref);
      else Object.values(node).forEach(walk);
    }
  };
  walk(expanded);
  return [...found];
}

/**
 * Inlines each queued reference into `result`, breadth-first, until the
 * queue is empty or the next would take the serialized result past
 * `maxBytes`. `result.circular` lists each reference found within itself.
 */
function inlineQueued<
  R extends { circular: Record<string, unknown>; truncated: boolean },
>(doc: Obj, result: R, queue: Slot[], maxBytes: number): R {
  const { circular } = result;
  const none = new Set<string>();
  let next = 0;
  // The serialized size, with every pending reference as its marker.
  let size = bytes(result);

  while (next < queue.length) {
    const slot = queue[next++] as Slot;
    if (slot.above.has(slot.ref)) {
      set(slot, marker(slot.ref, "x-circular"));
      size -= 1; // "x-circular" is a byte shorter than "x-truncated".
      const name = circularName(slot.ref);
      if (!Object.hasOwn(circular, name)) {
        // Listed once, then expanded like any other reference.
        const entry = marker(slot.ref, "x-truncated");
        size +=
          bytes(name) +
          1 +
          bytes(entry) +
          (Object.keys(circular).length > 0 ? 1 : 0);
        circular[name] = entry;
        queue.push({
          parent: circular,
          key: name,
          ref: slot.ref,
          siblings: {},
          above: none,
        });
      }
      continue;
    }
    const target = resolve(doc, slot.ref);
    if (target === undefined) {
      // Nothing to inline: the reference stays as the document has it.
      const plain = copy(
        { $ref: slot.ref, ...slot.siblings },
        slot.above,
        queue,
      );
      size += bytes(plain) - bytes(marker(slot.ref, "x-truncated"));
      set(slot, plain);
      continue;
    }
    const above = new Set(slot.above).add(slot.ref);
    if (
      isObj(target) &&
      typeof target.$ref === "string" &&
      target.$ref.startsWith("#")
    ) {
      // A reference to a reference: follow it in the same place.
      const { $ref: ref, ...siblings } = target;
      const followed = marker(ref, "x-truncated");
      size += bytes(followed) - bytes(marker(slot.ref, "x-truncated"));
      set(slot, followed);
      queue.push({
        ...slot,
        ref,
        siblings: { ...siblings, ...slot.siblings },
        above,
      });
      continue;
    }
    const pending = queue.length;
    const inlined = copy(
      isObj(target) ? { ...target, ...slot.siblings } : target,
      above,
      queue,
    );
    const grown =
      size - bytes(marker(slot.ref, "x-truncated")) + bytes(inlined);
    if (grown > maxBytes) {
      // Stop inlining: this and every reference still queued stay markers.
      queue.length = pending;
      result.truncated = true;
      break;
    }
    size = grown;
    set(slot, inlined);
  }
  return result;
}

/**
 * The Path Item's parameters followed by the operation's, where an operation
 * parameter replaces the Path Item's with the same `name` and `in`.
 */
function mergeParameters(
  doc: Obj,
  fromPath: unknown[],
  fromOperation: unknown[],
): unknown[] {
  const identity = (p: unknown): string | undefined => {
    const param = follow(doc, p);
    return isObj(param) &&
      typeof param.name === "string" &&
      typeof param.in === "string"
      ? `${param.in}\u0000${param.name}`
      : undefined;
  };
  const own = new Set(fromOperation.map(identity).filter((k) => k));
  return [
    ...fromPath.filter((p) => {
      const key = identity(p);
      return key === undefined || !own.has(key);
    }),
    ...fromOperation,
  ];
}

/** The security schemes `security`'s requirements name, each expanded. */
function schemesOf(
  doc: Obj,
  security: unknown,
  queue: Slot[],
): Record<string, unknown> {
  const components = isObj(doc.components) ? doc.components : {};
  const all = isObj(components.securitySchemes)
    ? components.securitySchemes
    : {};
  const schemes: Record<string, unknown> = {};
  for (const requirement of asArray(security)) {
    if (!isObj(requirement)) continue;
    for (const name of Object.keys(requirement))
      if (Object.hasOwn(all, name) && !Object.hasOwn(schemes, name))
        schemes[name] = copy(follow(doc, all[name]), new Set(), queue);
  }
  return schemes;
}

/**
 * A copy of `node` down to its references, each replaced by
 * `{ $ref, "x-truncated": true }` and queued to be inlined in its place.
 */
function copy(
  node: unknown,
  above: ReadonlySet<string>,
  queue: Slot[],
): unknown {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    node.forEach((item, i) => {
      out.push(copyChild(item, out, i, above, queue));
    });
    return out;
  }
  if (!isObj(node)) return node;
  const out: Obj = {};
  for (const [key, value] of Object.entries(node))
    out[key] = copyChild(value, out, key, above, queue);
  return out;
}

function copyChild(
  value: unknown,
  parent: Obj | unknown[],
  key: string | number,
  above: ReadonlySet<string>,
  queue: Slot[],
): unknown {
  if (isObj(value) && typeof value.$ref === "string") {
    const { $ref: ref, ...siblings } = value;
    if (ref.startsWith("#")) {
      queue.push({ parent, key, ref, siblings, above });
      return marker(ref, "x-truncated");
    }
  }
  return copy(value, above, queue);
}

function set(slot: Slot, value: unknown): void {
  if (Array.isArray(slot.parent)) slot.parent[slot.key as number] = value;
  else slot.parent[slot.key as string] = value;
}

function marker(ref: string, flag: "x-circular" | "x-truncated"): Obj {
  return { $ref: ref, [flag]: true };
}

/** `X` for `#/components/schemas/X`, else the whole reference. */
function circularName(ref: string): string {
  return schemaNameOf(ref);
}

function componentSchemas(doc: Obj): Obj {
  const components = isObj(doc.components) ? doc.components : {};
  return isObj(components.schemas) ? components.schemas : {};
}

/** `name` as one JSON pointer segment of a reference. */
function encodePointer(name: string): string {
  return encodeURI(name.replaceAll("~", "~0").replaceAll("/", "~1"));
}

/** `node`, or what it refers to when it is an internal reference (followed through chains). */
function follow(doc: Obj, node: unknown): Obj | undefined {
  let current = node;
  const seen = new Set<string>();
  while (isObj(current) && typeof current.$ref === "string") {
    const ref = current.$ref;
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    current = resolve(doc, ref);
  }
  return isObj(current) ? current : undefined;
}

/** The value an internal reference (`#/…`) points at in `doc`; `undefined` if none. */
function resolve(doc: Obj, ref: string): unknown {
  const segments = pointerSegments(ref);
  if (!segments) return undefined;
  let node: unknown = doc;
  for (const segment of segments) {
    if (Array.isArray(node)) node = node[Number(segment)];
    else if (isObj(node) && Object.hasOwn(node, segment)) node = node[segment];
    else return undefined;
  }
  return node;
}

/** The decoded JSON pointer segments of an internal reference; `undefined` if it isn't one. */
function pointerSegments(ref: string): string[] | undefined {
  if (!ref.startsWith("#")) return undefined;
  let pointer: string;
  try {
    pointer = decodeURIComponent(ref.slice(1));
  } catch {
    return undefined;
  }
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** The UTF-8 length of `value` as JSON. */
function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
