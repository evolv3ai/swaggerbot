import { ApiId, SpecId } from "~/domain/catalog";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { IndexedLookup } from "~/lookup/lookup";
import { nearestNames } from "./nearest";
import {
  type ExpandedOperation,
  type ExpandedSchema,
  expandOperation,
  MAX_OPERATION_BYTES,
  schemaNameOf,
  schemaNames,
  schemaOf,
} from "./operation";

/** How long a client may wait before asking again for a pending Spec's forms. */
export const PENDING_RETRY_AFTER_SECONDS = 10;

/** Parses a Normalized Form's bytes (minified JSON). */
export type NormalizedParser = (
  bytes: Uint8Array,
) => unknown | Promise<unknown>;

/**
 * The parsed Normalized Form of one Spec at a time. Parsing a 13 MB one
 * costs hundreds of megabytes, so only the last Spec asked for is kept;
 * asking for another replaces it. Concurrent requests for the same Spec
 * share one parse.
 */
export type NormalizedCache = {
  get(specId: string, load: () => Uint8Array | undefined): Promise<unknown>;
};

export function createNormalizedCache(
  parse: NormalizedParser = (bytes) =>
    JSON.parse(new TextDecoder().decode(bytes)),
): NormalizedCache {
  let held: { specId: string; doc: Promise<unknown> } | undefined;
  return {
    get(specId, load) {
      if (held?.specId === specId) return held.doc;
      // Drop the old one before loading the new, so both are never held.
      held = undefined;
      const bytes = load();
      if (!bytes) return Promise.resolve(undefined);
      const doc = Promise.resolve()
        .then(() => parse(bytes))
        .catch((error: unknown) => {
          if (held?.doc === doc) held = undefined;
          throw error;
        });
      held = { specId, doc };
      return doc;
    },
  };
}

/** The server's one parsed Normalized Form. */
export const normalizedCache = createNormalizedCache();

export type OperationDeps = {
  db: Db;
  lookup: Pick<IndexedLookup, "currentFromIndex">;
  cache: NormalizedCache;
};

/** Why a Spec's Normalized Form can't be read: the HTTP answer that says so. */
export type FormsRefusal = {
  status: 404 | 409 | 422;
  body: { error?: string; status?: "pending" | "failed" };
  headers?: Record<string, string>;
};

/**
 * The parsed Normalized Form of the API's Current Spec, or of its Spec
 * `specId` (from `cache`); else 404 for an API or Spec not in the Index,
 * 409 with `retry-after` while the Spec's forms are pending, 422 when they
 * failed.
 */
export async function openNormalized(
  apiId: string,
  requested: string | null | undefined,
  deps: OperationDeps,
): Promise<{ specId: string; doc: unknown } | FormsRefusal> {
  const specId = requested
    ? specOfApi(deps.db, apiId, requested)
    : currentSpecId(deps.lookup, apiId);
  if (!specId) return notFound(apiId, requested);

  const forms = createSpecForms(deps.db);
  const { status } = forms.getValidity(specId);
  if (status === "failed")
    return {
      status: 422,
      body: { status: "failed", error: forms.getForms(specId).error },
    };
  const doc =
    status === "ready"
      ? await deps.cache.get(specId, () => forms.getNormalizedBytes(specId))
      : undefined;
  if (doc === undefined)
    return {
      status: 409,
      body: { status: "pending" },
      headers: { "retry-after": String(PENDING_RETRY_AFTER_SECONDS) },
    };
  return { specId, doc };
}

/** One operation of a Spec, expanded, with what names it (`get_operation`). */
export type OperationAnswer = {
  apiId: string;
  specId: string;
  method: string;
  path: string;
} & ExpandedOperation;

/**
 * The operation `method` (any case) on `path` of the Normalized Form `doc`
 * of the Spec `specId`, expanded so the whole answer weighs at most
 * `maxBytes`; `undefined` when the Spec has no such operation.
 */
export function operationAnswer(
  apiId: string,
  specId: string,
  doc: unknown,
  method: string,
  path: string,
  maxBytes = MAX_OPERATION_BYTES,
): OperationAnswer | undefined {
  const envelope = { apiId, specId, method: method.toLowerCase(), path };
  const expanded = expandOperation(doc, method, path, {
    maxBytes: maxBytes - envelopeBytes(envelope),
  });
  return expanded && { ...envelope, ...expanded };
}

/** One component schema of a Spec, expanded, with what names it (`get_schema`). */
export type SchemaAnswer = { apiId: string; specId: string } & ExpandedSchema;

/**
 * The component schema `name` (bare, or as its whole reference) of the
 * Normalized Form `doc` of the Spec `specId`, expanded so the whole answer
 * weighs at most `maxBytes`; `undefined` when the Spec has no such schema.
 */
export function schemaAnswer(
  apiId: string,
  specId: string,
  doc: unknown,
  name: string,
  maxBytes = MAX_OPERATION_BYTES,
): SchemaAnswer | undefined {
  const envelope = { apiId, specId };
  const expanded = schemaOf(doc, name, {
    maxBytes: maxBytes - envelopeBytes(envelope),
  });
  return expanded && { ...envelope, ...expanded };
}

/**
 * `GET /api/apis/{apiId}/operation?method=…&path=…[&specId=…]`
 * (`get_operation`): one operation of the API's Current Spec, or of its
 * Spec `specId`, with every reference it reaches inlined (`expandOperation`).
 * 400 without `method` or `path`; 404 for an API or Spec not in the Index,
 * or an operation not in the Spec; 409 while the Spec's forms are pending
 * and 422 when they failed.
 */
export async function operationResponse(
  url: URL,
  apiId: string,
  deps: OperationDeps,
): Promise<Response> {
  const method = url.searchParams.get("method")?.toLowerCase();
  const path = url.searchParams.get("path");
  if (!method || !path)
    return Response.json(
      {
        error:
          "Give the operation as ?method=get&path=/v1/customers/{customer}, with path exactly as the Spec's paths have it.",
      },
      { status: 400 },
    );

  const requested = url.searchParams.get("specId");
  const opened = await openNormalized(apiId, requested, deps);
  if ("status" in opened) return refusalResponse(opened);
  const { specId, doc } = opened;

  const answer = operationAnswer(apiId, specId, doc, method, path);
  if (!answer) {
    const outline = `/api/apis/${apiId}/outline${requested ? `?specId=${specId}` : ""}`;
    return Response.json(
      {
        error: `This Spec has no operation ${method.toUpperCase()} ${path}.`,
        hint: `GET ${outline} lists its operations; path must equal one of them exactly.`,
      },
      { status: 404 },
    );
  }
  return Response.json(answer);
}

/**
 * `GET /api/apis/{apiId}/schema?name=…[&specId=…]` (`get_schema`): one
 * schema of the Current Spec's `components.schemas`, or of the Spec
 * `specId`'s, expanded like an operation (`schemaOf`), to follow a
 * reference an operation left. `name` is the bare name or the whole
 * `#/components/schemas/<name>` reference. 400 without `name`; 404 for an
 * API or Spec not in the Index, or with the `nearest` names for a schema
 * not in the Spec; 409 while the Spec's forms are pending and 422 when
 * they failed.
 */
export async function schemaResponse(
  url: URL,
  apiId: string,
  deps: OperationDeps,
): Promise<Response> {
  const name = url.searchParams.get("name");
  if (!name)
    return Response.json(
      {
        error:
          "Give the schema as ?name=customer, or as the whole reference ?name=%23/components/schemas/customer.",
      },
      { status: 400 },
    );

  const opened = await openNormalized(
    apiId,
    url.searchParams.get("specId"),
    deps,
  );
  if ("status" in opened) return refusalResponse(opened);
  const { specId, doc } = opened;

  const answer = schemaAnswer(apiId, specId, doc, name);
  if (!answer)
    return Response.json(
      {
        error: `This Spec has no schema ${schemaNameOf(name)} in components.schemas.`,
        nearest: nearestSchemaNames(doc, name),
      },
      { status: 404 },
    );
  return Response.json(answer);
}

/** Up to 5 of the Spec's schema names nearest to `name`. */
export function nearestSchemaNames(doc: unknown, name: string): string[] {
  return nearestNames(schemaNames(doc), schemaNameOf(name));
}

function refusalResponse({ status, body, headers }: FormsRefusal): Response {
  return Response.json(body, { status, headers });
}

/** Room for the envelope and the braces and commas around it. */
function envelopeBytes(envelope: object): number {
  return Buffer.byteLength(JSON.stringify(envelope));
}

/** `specId` when it is a Spec of the API `apiId` in the Index. */
function specOfApi(db: Db, apiId: string, specId: string): string | undefined {
  if (!ApiId.safeParse(apiId).success || !SpecId.safeParse(specId).success)
    return undefined;
  const stored = createRepo(db).getApiWithSpecs(apiId);
  return stored?.specs.some(({ spec }) => spec.id === specId)
    ? specId
    : undefined;
}

function currentSpecId(
  lookup: OperationDeps["lookup"],
  apiId: string,
): string | undefined {
  if (!ApiId.safeParse(apiId).success) return undefined;
  return lookup.currentFromIndex(apiId)?.currentSpec.id;
}

function notFound(
  apiId: string,
  specId: string | null | undefined,
): FormsRefusal {
  return {
    status: 404,
    body: {
      error: specId
        ? `The API ${apiId} has no Spec ${specId} in the Index.`
        : `The Index has no API ${apiId} with a Current Spec. A Lookup (POST /api/lookup) finds APIs.`,
    },
  };
}
