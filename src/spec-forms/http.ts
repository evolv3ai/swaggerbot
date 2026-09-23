import { ApiId, type Spec, SpecId } from "~/domain/catalog";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { IndexedLookup } from "~/lookup/lookup";
import { downloadUrl } from "./outcome";

/** How long a client may wait before asking again for a Spec whose forms are pending. */
export const PENDING_RETRY_AFTER_SECONDS = 10;

/** What `GET /api/apis/{apiId}/outline` runs on: the Index and the Lookup over it. */
export type OutlineApp = {
  db: Db;
  lookup: Pick<IndexedLookup, "currentFromIndex">;
};

const LOOKUP_HINT =
  "A Lookup (`POST /api/lookup` with a `name`) finds APIs and gives their ids.";

/**
 * `GET /api/apis/{apiId}/outline[?specId=…]`: the Spec Outline of the API's
 * Current Spec (`currentFromIndex`), or of the Spec `specId`, which must be
 * one of the API's (an Alternate, say).
 *
 * - 200 `{ apiId, specId, specVersion, normalized: "ready", outline, downloads }`;
 * - 409 `{ status: "pending" }` with `retry-after` while the Spec's forms
 *   are pending, 422 `{ status: "failed", error }` when their build failed;
 * - 404 for an `apiId` that is malformed, not in the Index, or has no
 *   Current Spec, and for a `specId` that isn't a Spec of the API; 400 for
 *   a malformed `specId`.
 *
 * Reads only the `outline` column of the stored forms, never the Normalized
 * Form. `getApp` is called once the ids are well formed.
 */
export function outlineResponse(
  request: Request,
  apiId: string,
  getApp: () => OutlineApp,
  baseUrl?: string,
): Response {
  if (!ApiId.safeParse(apiId).success) return unknownApi(apiId);
  const specId = new URL(request.url).searchParams.get("specId");
  if (specId !== null && !SpecId.safeParse(specId).success)
    return Response.json(
      { error: "A Spec id is 64 lowercase hex characters." },
      { status: 400 },
    );

  const { db, lookup } = getApp();
  let spec: Spec;
  if (specId === null) {
    const current = lookup.currentFromIndex(apiId);
    if (!current) return unknownApi(apiId);
    spec = current.currentSpec;
  } else {
    const stored = createRepo(db).getApiWithSpecs(apiId);
    if (!stored) return unknownApi(apiId);
    const found = stored.specs.find((s) => s.spec.id === specId)?.spec;
    if (!found)
      return Response.json(
        { error: `The Index holds no Spec ${specId} of the API ${apiId}.` },
        { status: 404 },
      );
    spec = found;
  }

  const stored = createSpecForms(db).getOutline(spec.id);
  if (stored.status === "pending")
    return Response.json(
      { status: "pending" },
      {
        status: 409,
        headers: { "retry-after": String(PENDING_RETRY_AFTER_SECONDS) },
      },
    );
  if (stored.status === "failed")
    return Response.json(
      { status: "failed", error: stored.error },
      { status: 422 },
    );
  return Response.json({
    apiId,
    specId: spec.id,
    specVersion: spec.specVersion,
    normalized: "ready",
    outline: stored.outline,
    downloads: {
      published: downloadUrl(spec.id, "published", baseUrl),
      normalized: downloadUrl(spec.id, "normalized", baseUrl),
    },
  });
}

function unknownApi(apiId: string): Response {
  return Response.json(
    {
      error: `The Index holds no API ${apiId}, or none with a Current Spec.`,
      hint: LOOKUP_HINT,
    },
    { status: 404 },
  );
}
