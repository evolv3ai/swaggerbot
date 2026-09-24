import { ApiId, type Spec, SpecId } from "~/domain/catalog";
import type { SpecOutline } from "~/domain/spec-forms";
import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import type { IndexedLookup } from "~/lookup/lookup";
import { downloadUrl } from "./outcome";
import {
  BadCursorError,
  MAX_HTTP_PAGE_LIMIT,
  pageOutline,
} from "./outline-page";

/** How long a client may wait before asking again for a Spec whose forms are pending. */
export const PENDING_RETRY_AFTER_SECONDS = 10;

/** What `GET /api/apis/{apiId}/outline` runs on: the Index and the Lookup over it. */
export type OutlineApp = {
  db: Db;
  lookup: Pick<IndexedLookup, "currentFromIndex">;
};

const LOOKUP_HINT =
  "A Lookup (`POST /api/lookup` with a `name`) finds APIs and gives their ids.";

/** The paging parameters of `GET /api/apis/{apiId}/outline`. */
const PAGE_PARAMS = ["tag", "query", "cursor", "limit"] as const;

/**
 * `GET /api/apis/{apiId}/outline[?specId=…]`: the Spec Outline of the API's
 * Current Spec (`currentFromIndex`), or of the Spec `specId`, which must be
 * one of the API's (an Alternate, say).
 *
 * - 200 `{ apiId, specId, specVersion, normalized: "ready", outline, downloads }`;
 *   with any of `tag`, `query`, `cursor` or `limit` (at most 500), one page
 *   of it instead (`pageOutline`), with `specVersion`, `normalized` and
 *   `downloads` beside it;
 * - 409 `{ status: "pending" }` with `retry-after` while the Spec's forms
 *   are pending, 422 `{ status: "failed", error }` when their build failed;
 * - 404 for an `apiId` that is malformed, not in the Index, or has no
 *   Current Spec, and for a `specId` that isn't a Spec of the API; 400 for
 *   a malformed `specId`, `limit` or `cursor`.
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
  const params = new URL(request.url).searchParams;
  const answer = answerOutline(apiId, params.get("specId"), getApp, baseUrl);
  if (answer.status !== 200)
    return Response.json(answer.body, {
      status: answer.status,
      headers: answer.headers,
    });
  if (!PAGE_PARAMS.some((name) => params.has(name)))
    return Response.json(answer.body);

  const limitParam = params.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);
  if (
    limit !== undefined &&
    !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_HTTP_PAGE_LIMIT)
  )
    return Response.json(
      { error: `limit is a whole number from 1 to ${MAX_HTTP_PAGE_LIMIT}.` },
      { status: 400 },
    );
  const { specVersion, normalized, downloads } = answer.body;
  try {
    const page = pageOutline(answer.body, {
      tag: params.get("tag") ?? undefined,
      query: params.get("query") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    });
    return Response.json({ ...page, specVersion, normalized, downloads });
  } catch (error) {
    if (error instanceof BadCursorError)
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** The whole outline, as `GET /api/apis/{apiId}/outline` answers without paging. */
export type OutlineBody = {
  apiId: string;
  specId: string;
  specVersion: string;
  normalized: "ready";
  outline: SpecOutline;
  downloads: { published: string; normalized: string };
};

/**
 * The outline route's answer before any surface shapes it: the HTTP status,
 * the JSON body and the headers. `GET /api/apis/{apiId}/outline` sends it
 * as a `Response`; the MCP tool `get_spec_outline` turns it into a tool
 * result.
 */
export type OutlineAnswer =
  | { status: 200; body: OutlineBody; headers: Record<string, string> }
  | {
      status: 400 | 404 | 409 | 422;
      body:
        | { error: string; hint?: string }
        | { status: "pending" }
        | { status: "failed"; error: string };
      headers: Record<string, string>;
    };

/**
 * The Spec Outline of the API `apiId`'s Current Spec, or of its Spec
 * `specId`, with the statuses `outlineResponse` documents.
 */
export function answerOutline(
  apiId: string,
  specId: string | null,
  getApp: () => OutlineApp,
  baseUrl?: string,
): OutlineAnswer {
  if (!ApiId.safeParse(apiId).success) return unknownApi(apiId);
  if (specId !== null && !SpecId.safeParse(specId).success)
    return {
      status: 400,
      body: { error: "A Spec id is 64 lowercase hex characters." },
      headers: {},
    };

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
      return {
        status: 404,
        body: {
          error: `The Index holds no Spec ${specId} of the API ${apiId}.`,
        },
        headers: {},
      };
    spec = found;
  }

  const stored = createSpecForms(db).getOutline(spec.id);
  if (stored.status === "pending")
    return {
      status: 409,
      body: { status: "pending" },
      headers: { "retry-after": String(PENDING_RETRY_AFTER_SECONDS) },
    };
  if (stored.status === "failed")
    return {
      status: 422,
      body: { status: "failed", error: stored.error },
      headers: {},
    };
  return {
    status: 200,
    body: {
      apiId,
      specId: spec.id,
      specVersion: spec.specVersion,
      normalized: "ready",
      outline: stored.outline,
      downloads: {
        published: downloadUrl(spec.id, "published", baseUrl),
        normalized: downloadUrl(spec.id, "normalized", baseUrl),
      },
    },
    headers: {},
  };
}

function unknownApi(apiId: string): OutlineAnswer {
  return {
    status: 404,
    body: {
      error: `The Index holds no API ${apiId}, or none with a Current Spec.`,
      hint: LOOKUP_HINT,
    },
    headers: {},
  };
}
