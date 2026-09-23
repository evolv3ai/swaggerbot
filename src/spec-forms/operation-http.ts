import { ApiId, SpecId } from "~/domain/catalog";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { IndexedLookup } from "~/lookup/lookup";
import { expandOperation, MAX_OPERATION_BYTES } from "./operation";

/** How long a client may wait before asking again for a pending Spec's forms. */
const PENDING_RETRY_AFTER_SECONDS = 10;

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
  const specId = requested
    ? specOfApi(deps.db, apiId, requested)
    : currentSpecId(deps.lookup, apiId);
  if (!specId) return notFound(apiId, requested);

  const forms = createSpecForms(deps.db);
  const { status } = forms.getValidity(specId);
  if (status === "failed")
    return Response.json(
      { status: "failed", error: forms.getForms(specId).error },
      { status: 422 },
    );
  const doc =
    status === "ready"
      ? await deps.cache.get(specId, () => forms.getNormalizedBytes(specId))
      : undefined;
  if (doc === undefined)
    return Response.json(
      { status: "pending" },
      {
        status: 409,
        headers: { "retry-after": String(PENDING_RETRY_AFTER_SECONDS) },
      },
    );

  const envelope = { apiId, specId, method, path };
  const expanded = expandOperation(doc, method, path, {
    // Room for the envelope and the braces and commas around it.
    maxBytes: MAX_OPERATION_BYTES - Buffer.byteLength(JSON.stringify(envelope)),
  });
  if (!expanded) {
    const outline = `/api/apis/${apiId}/outline${requested ? `?specId=${specId}` : ""}`;
    return Response.json(
      {
        error: `This Spec has no operation ${method.toUpperCase()} ${path}.`,
        hint: `GET ${outline} lists its operations; path must equal one of them exactly.`,
      },
      { status: 404 },
    );
  }
  return Response.json({ ...envelope, ...expanded });
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

function notFound(apiId: string, specId: string | null): Response {
  return Response.json(
    {
      error: specId
        ? `The API ${apiId} has no Spec ${specId} in the Index.`
        : `The Index has no API ${apiId} with a Current Spec. A Lookup (POST /api/lookup) finds APIs.`,
    },
    { status: 404 },
  );
}
