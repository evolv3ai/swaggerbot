import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";
import { createSpecForms } from "~/index-store/spec-forms";
import { PENDING_RETRY_AFTER_SECONDS } from "~/spec-forms/http";

/** A Spec id: the lowercase hex sha256 of its Published Form. */
const SPEC_ID = /^[0-9a-f]{64}$/;

/** Whether `specId` has a Spec id's shape (64 lowercase hex characters). */
export function isSpecId(specId: string): boolean {
  return SPEC_ID.test(specId);
}

const CONTENT_TYPES = {
  json: "application/json",
  yaml: "application/yaml",
} as const;

/**
 * `GET /api/specs/{specId}/published`: the Published Form, byte for byte.
 * A Spec id names its bytes, so the answer never changes: it is cached for
 * a year, and a matching `If-None-Match` gets 304. Readable from any origin
 * (`anyOrigin`).
 */
export function publishedResponse(
  request: Request,
  specId: string,
  getDb: () => Db,
): Response {
  return anyOrigin(published(request, specId, getDb));
}

/**
 * `GET /api/specs/{specId}/normalized`: the Normalized Form once it is
 * built; 409 while it is pending, 422 when its build failed. Cached for a
 * day only, as a later builder may rebuild it. Readable from any origin
 * (`anyOrigin`).
 */
export function normalizedResponse(specId: string, getDb: () => Db): Response {
  return anyOrigin(normalized(specId, getDb));
}

/**
 * Lets any origin read the answer. The downloads are public already; the one
 * that needs this is the Spec viewer's frame (`/embed/specs/…`), which is
 * sandboxed to an opaque origin, so its `fetch` of the Spec is cross-origin.
 */
function anyOrigin(response: Response): Response {
  response.headers.set("access-control-allow-origin", "*");
  return response;
}

function published(
  request: Request,
  specId: string,
  getDb: () => Db,
): Response {
  const bad = checkSpecId(specId);
  if (bad) return bad;
  const published = createRepo(getDb()).getPublished(specId);
  if (!published) return unknownSpec();
  const headers = {
    etag: `"${specId}"`,
    "cache-control": "public, max-age=31536000, immutable",
  };
  if (matchesEtag(request, headers.etag))
    return new Response(null, { status: 304, headers });
  const slug = published.apiId.slice(published.apiId.indexOf("/") + 1);
  return new Response(body(published.bytes), {
    headers: {
      ...headers,
      "content-type": CONTENT_TYPES[published.format],
      "content-disposition": `inline; filename="${slug}-${specId.slice(0, 12)}.${published.format}"`,
    },
  });
}

function normalized(specId: string, getDb: () => Db): Response {
  const bad = checkSpecId(specId);
  if (bad) return bad;
  const db = getDb();
  if (!createRepo(db).getPublished(specId)) return unknownSpec();
  const forms = createSpecForms(db);
  const bytes = forms.getNormalizedBytes(specId);
  if (bytes)
    return new Response(body(bytes), {
      headers: {
        "content-type": "application/json",
        etag: `"${specId}-n"`,
        "cache-control": "public, max-age=86400",
      },
    });
  const stored = forms.getForms(specId);
  if (stored.status === "failed")
    return Response.json(
      { status: "failed", error: stored.error },
      { status: 422 },
    );
  return Response.json(
    { status: "pending" },
    {
      status: 409,
      headers: { "retry-after": String(PENDING_RETRY_AFTER_SECONDS) },
    },
  );
}

/**
 * The bytes as a response body. The Index's copies are fresh `ArrayBuffer`s,
 * never shared memory, which is all `BodyInit` asks.
 */
function body(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

function checkSpecId(specId: string): Response | undefined {
  if (isSpecId(specId)) return undefined;
  return Response.json(
    { error: "A Spec id is 64 lowercase hex characters." },
    { status: 400 },
  );
}

function unknownSpec(): Response {
  return Response.json({ error: "No such Spec." }, { status: 404 });
}

/** Whether `If-None-Match` lists `etag` (weak or strong) or is `*`. */
function matchesEtag(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === etag || tag === "*");
}
