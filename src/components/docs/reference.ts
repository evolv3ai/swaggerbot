/**
 * What `/docs` says: the public origin, the HTTP API's routes with a `curl`
 * for each and the answer it gave, the MCP tools, and where to ask for a
 * key. The answers were recorded from swaggerbot.dev on the date below
 * (Val Town's API, a small Spec); ids and dates move as the Index
 * re-verifies, the shapes don't.
 */

/** Where the service is reached. */
export const BASE_URL = "https://swaggerbot.dev";

/** The day the example answers were recorded (UTC). */
export const RECORDED_AT = "2026-09-26T00:00:00Z";

/** "Request a key" (Slice 6 backlog, D9): keys are handed out by hand. */
export const KEY_REQUEST_EMAIL = "hello@evolv3.ai";
export const KEY_REQUEST_HREF = `mailto:${KEY_REQUEST_EMAIL}?subject=swagger.bot%20API%20key%20request`;

export const MCP_URL = `${BASE_URL}/mcp`;
export const MCP_ADD = `claude mcp add --transport http swaggerbot ${MCP_URL}`;
export const MCP_ADD_WITH_KEY = `${MCP_ADD} --header "Authorization: Bearer <key>"`;

const SPEC_ID =
  "4b446f57c9327311b6b68ad0a0e53b19341971a436cd9f0fda2630e3445483df";
const DOWNLOADS = `"downloads": {
      "published": "${BASE_URL}/api/specs/${SPEC_ID}/published",
      "normalized": "${BASE_URL}/api/specs/${SPEC_ID}/normalized"
    }`;

/** One line of the route table. */
export type RouteRow = { route: string; gives: string; key: string };

/** Every route of the HTTP API; all but `GET /api/health` are under the per-IP limit. */
export const ROUTES: RouteRow[] = [
  {
    route: "POST /api/lookup",
    gives: "The Outcome.",
    key: "For Discovery and fresh",
  },
  {
    route: "GET /api/vendors[?query=&cursor=&limit=]",
    gives:
      "The Vendors with at least one API in the Index, by name, 50 a page (`limit` at most 200).",
    key: "No",
  },
  {
    route: "GET /api/vendors/{vendor}/apis",
    gives: "A Vendor's APIs in the Index, each with its Current Spec.",
    key: "No",
  },
  {
    route: "GET /api/apis/{apiId}/outline",
    gives:
      "The Spec Outline, paged with `tag`, `query`, `cursor` and `limit`, with the tag list.",
    key: "No",
  },
  {
    route: "GET /api/apis/{apiId}/operation",
    gives: "One operation, with the references it reaches inlined.",
    key: "No",
  },
  {
    route: "GET /api/apis/{apiId}/schema",
    gives: "One component schema.",
    key: "No",
  },
  {
    route: "GET /api/specs/{specId}/published, …/normalized",
    gives: "The Spec's Published Form or Normalized Form.",
    key: "No",
  },
  { route: "GET /api/health", gives: '`{"ok":true}`', key: "No" },
];

/** A route's worked example: the call and what it answered. */
export type Example = {
  id: string;
  route: string;
  about: string;
  curl: string;
  answer: string;
  /** Said under the answer: what was left out, or what else it can say. */
  note?: string;
};

export const EXAMPLES: Example[] = [
  {
    id: "lookup",
    route: "POST /api/lookup",
    about:
      "Takes `{ name, apiVersion?, allowCommunity?, fresh? }` and answers with exactly one Outcome: Resolved, Ambiguous, Unconfirmed, No Spec or Unknown. A name the Index already answers needs no key.",
    curl: `curl -X POST ${BASE_URL}/api/lookup -H "Content-Type: application/json" -d '{"name":"Val Town"}'`,
    answer: `{
  "outcome": "Resolved",
  "api": { "id": "val.town/api", "vendorId": "val.town", "name": "Val API" },
  "vendor": { "id": "val.town", "name": "val.town", "domain": "val.town" },
  "currentSpec": {
    "id": "${SPEC_ID}",
    "apiId": "val.town/api",
    "specVersion": "3.1.0",
    "apiVersion": "1",
    "isPreview": false,
    "supersededAt": null,
    "format": "json",
    "byteLength": 72545,
    ${DOWNLOADS},
    "normalized": "ready"
  },
  "alternateSpecs": [],
  "provenance": "Official",
  "sources": [
    {
      "id": 29,
      "specId": "${SPEC_ID}",
      "url": "https://api.val.town/openapi.json",
      "provenance": "Official",
      "firstSeenAt": "2026-09-23T07:42:46.292Z",
      "lastVerifiedAt": "2026-09-24T00:07:16.403Z"
    }
  ],
  "verifiedAt": "2026-09-24T00:07:16.403Z",
  "validityIssues": [],
  "validityIssueCount": 0
}`,
  },
  {
    id: "lookup-no-key",
    route: "POST /api/lookup, a name the Index doesn't know",
    about:
      "Finding it on the live web is Discovery, which needs a key: send the same request with `Authorization: Bearer <key>`. So does `fresh: true`.",
    curl: `curl -X POST ${BASE_URL}/api/lookup -H "Content-Type: application/json" -d '{"name":"Not Yet Indexed"}'`,
    answer: `HTTP 401
{
  "error": "Discovery needs an API key.",
  "hint": "Send it as \`Authorization: Bearer <key>\`. Keys are issued by the operator of this service; ask them for one."
}`,
  },
  {
    id: "vendors",
    route: "GET /api/vendors",
    about:
      "The Vendors with at least one API in the Index, ordered by name. `query` is a substring of the id or name, ignoring case; `nextCursor` is `null` on the last page. A bad `limit` or `cursor` is a 400.",
    curl: `curl "${BASE_URL}/api/vendors?query=val"`,
    answer: `{
  "vendors": [{ "id": "val.town", "name": "val.town", "apiCount": 1 }],
  "total": 1,
  "nextCursor": null
}`,
  },
  {
    id: "vendor-apis",
    route: "GET /api/vendors/{vendor}/apis",
    about:
      "A Vendor's APIs in the Index, each with its Current Spec, Provenance and `verifiedAt`.",
    curl: `curl ${BASE_URL}/api/vendors/val.town/apis`,
    answer: `{
  "vendor": { "id": "val.town", "name": "val.town", "domain": "val.town" },
  "apis": [
    {
      "api": { "id": "val.town/api", "vendorId": "val.town", "name": "Val API" },
      "currentSpec": {
        "id": "${SPEC_ID}",
        "apiId": "val.town/api",
        "specVersion": "3.1.0",
        "apiVersion": "1",
        "isPreview": false,
        "supersededAt": null,
        "format": "json",
        "byteLength": 72545,
        ${DOWNLOADS.replaceAll("\n", "\n    ")},
        "normalized": "ready"
      },
      "alternateSpecs": [],
      "provenance": "Official",
      "verifiedAt": "2026-09-24T00:07:16.403Z"
    }
  ]
}`,
  },
  {
    id: "outline",
    route: "GET /api/apis/{apiId}/outline",
    about:
      "The Current Spec's operations, 100 a page by default (`limit` up to 500), filtered by `tag` or by `query` (a word of the path, `operationId` or summary), with the tag list. The API id keeps its slash.",
    curl: `curl "${BASE_URL}/api/apis/val.town/api/outline?tag=me"`,
    answer: `{
  "apiId": "val.town/api",
  "specId": "${SPEC_ID}",
  "title": "Val Town API",
  "apiVersion": "1",
  "servers": ["https://api.val.town"],
  "securitySchemes": [{ "name": "bearerAuth", "type": "http", "scheme": "bearer" }],
  "tags": [
    { "name": "vals", "operationCount": 20 },
    { "name": "alias", "operationCount": 2 },
    { "name": "me", "operationCount": 2 },
    …
  ],
  "operations": [
    { "method": "get", "path": "/v1/me", "operationId": "meGet", "tags": ["me"] },
    { "method": "get", "path": "/v2/me/vals", "operationId": "meVals2", "tags": ["me"] }
  ],
  "totalOperations": 52,
  "matchedOperations": 2,
  "nextCursor": null,
  "specVersion": "3.1.0",
  "normalized": "ready",
  ${DOWNLOADS.replaceAll("\n    ", "\n  ")}
}`,
    note: "Abridged: … stands for the other eleven tags.",
  },
  {
    id: "operation",
    route: "GET /api/apis/{apiId}/operation",
    about:
      "One operation of the Current Spec (or of `specId`): `method` in any case, `path` exactly as the Spec writes it, URL-encoded. Its parameters, effective `security` and every `$ref` it reaches are inlined, to 1 MB. 404 for an unknown operation, 409 while the Spec's forms are still being built.",
    curl: `curl "${BASE_URL}/api/apis/val.town/api/operation?method=delete&path=/v1/blob/%7Bkey%7D"`,
    answer: `{
  "apiId": "val.town/api",
  "specId": "${SPEC_ID}",
  "method": "delete",
  "path": "/v1/blob/{key}",
  "operation": {
    "operationId": "v1blobsDelete",
    "tags": ["blobs"],
    "description": "Delete a blob",
    "parameters": [
      {
        "schema": { "type": "string", "minLength": 1, "maxLength": 512 },
        "in": "path",
        "name": "key",
        "required": true,
        "description": "Key that uniquely identifies this blob"
      }
    ],
    "security": [{ "bearerAuth": [] }],
    "responses": { "204": { "description": "Blob successfully deleted" } }
  },
  "circular": {},
  "securitySchemes": {
    "bearerAuth": {
      "type": "http",
      "scheme": "bearer",
      "description": "Endpoints that support authorization expect Bearer authentication, using an API token provided from Val Town."
    }
  },
  "truncated": false
}`,
  },
  {
    id: "schema",
    route: "GET /api/apis/{apiId}/schema",
    about:
      "One component schema by name, to follow a reference an operation left.",
    curl: `curl "${BASE_URL}/api/apis/val.town/api/schema?name=PaginationLinks"`,
    answer: `{
  "apiId": "val.town/api",
  "specId": "${SPEC_ID}",
  "name": "PaginationLinks",
  "schema": {
    "type": "object",
    "required": ["self"],
    "properties": {
      "self": { "type": "string", "format": "uri", "description": "URL of this page" },
      "prev": { "type": "string", "format": "uri", "description": "URL of the previous page, if any" },
      "next": { "type": "string", "format": "uri", "description": "URL of the next page, if any" }
    },
    "description": "Links to use for pagination"
  },
  "circular": {},
  "truncated": false
}`,
  },
  {
    id: "published",
    route: "GET /api/specs/{specId}/published",
    about:
      "The Spec's Published Form, byte for byte as the Vendor serves it, so its sha256 is the Spec id.",
    curl: `curl -s ${BASE_URL}/api/specs/${SPEC_ID}/published | sha256sum`,
    answer: `${SPEC_ID}  -`,
  },
  {
    id: "normalized",
    route: "GET /api/specs/{specId}/normalized",
    about:
      "The Spec's Normalized Form: bundled and converted to OpenAPI 3.1, JSON. 409 while it is still being built.",
    curl: `curl -s ${BASE_URL}/api/specs/${SPEC_ID}/normalized | head -c 19`,
    answer: `{"openapi":"3.1.0",`,
  },
  {
    id: "health",
    route: "GET /api/health",
    about: "Whether the service is up. Not rate-limited.",
    curl: `curl ${BASE_URL}/api/health`,
    answer: `{"ok":true}`,
  },
];

/** One of the five MCP tools. */
export type McpToolRow = {
  name: string;
  args: string;
  gives: string;
  over: string;
};

export const MCP_TOOL_ROWS: McpToolRow[] = [
  {
    name: "lookup_api",
    args: "{ name, apiVersion?, allowCommunity?, fresh? }",
    gives:
      "The Outcome, with the Spec's download URLs (the Spec itself is never returned inline).",
    over: "POST /api/lookup",
  },
  {
    name: "list_vendor_apis",
    args: "{ vendor }",
    gives: "A Vendor's APIs in the Index, each with its Current Spec.",
    over: "GET /api/vendors/{vendor}/apis",
  },
  {
    name: "get_spec_outline",
    args: "{ apiId, specId?, tag?, query?, cursor? }",
    gives:
      "One page (at most 100) of the Spec Outline's operations, with the tag list and `nextCursor`.",
    over: "GET /api/apis/{apiId}/outline",
  },
  {
    name: "get_operation",
    args: "{ apiId, method, path, specId? }",
    gives:
      "One operation with the references it reaches inlined; a path that isn't in the Spec gets the nearest ones.",
    over: "GET /api/apis/{apiId}/operation",
  },
  {
    name: "get_schema",
    args: "{ apiId, name, specId? }",
    gives:
      "One component schema, to follow a reference `get_operation` or `get_schema` left.",
    over: "GET /api/apis/{apiId}/schema",
  },
];
