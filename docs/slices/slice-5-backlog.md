# Slice 5 backlog: MCP server

**Status: approved by Wes, 2026-09-24** (D1–D8 as recommended; ADR 0005 accepted). Filed on Linear as in the Order table; all five merged and deployed the same day. Result: [`slice-5-result.md`](slice-5-result.md).

The issues for [Slice 5](../PRD.md#slice-5--mcp-server), written so the weawr factory can build them: each numbered body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue live in `.weawr/instructions.md`.

**Acceptance (PRD):** Claude Code, given only the MCP server, can find and call three operations of a Benchmark API it hasn't seen before. Proposed concretely (decision D7): **Val Town** (long-tail, Resolved, Official, 52 operations), with Claude Code allowed the swagger.bot MCP tools and Bash to call the API, but no web search or fetch. It must make three successful calls to three different Val Town operations that need no key (`/v1/alias/{username}`, `/v1/users/{user_id}`, `/v1/users/{user_id}/vals` all answer 200 without one), once on the default model and once on Haiku as the canary for unclear tool descriptions. Every MCP result it received stays under 30 kB. Nothing may cost what Slices 3 and 4 bought: `formscheck` still passes, and the HTTP API answers as before.

## Decisions

All eight taken as recommended by Wes on 2026-09-24, and recorded in [ADR 0005](../adr/0005-mcp-in-process-with-agent-sized-results.md).

- **D1. SDK:** *Taken.* `@modelcontextprotocol/server` **2.1.0** (v2, the stable line; 2026-07-28 spec), its stateless `createMcpHandler`. *Spiked 2026-09-24:* served from a TanStack Start route and built with Nitro; Claude Code 2.1.281 on Haiku connected over HTTP, listed `lookup_api` and resolved Stripe.
- **D2. Endpoint:** *Taken.* `https://swaggerbot.dev/mcp`, one route, every method (`ANY`). Added in Claude Code with `claude mcp add --transport http swaggerbot https://swaggerbot.dev/mcp --header "Authorization: Bearer <key>"`.
- **D3. Auth: the same rules as the HTTP API.** *Taken.* The key is optional: Index answers, the outline, operations, schemas and vendor lists are open under the per-IP limit; Discovery and `fresh` need a key and use its quota. A key that is sent but unknown is a 401 at the HTTP level, before any tool runs. The alternative was to require a key for every MCP call; this was chosen because one rule is simpler to explain and test, an agent without a key still gets every Index answer, and the acceptance run uses a key either way. The PRD's Slice 5 line is amended to match.
- **D4. Five tools, not four:** *Taken.* the PRD's `lookup_api`, `list_vendor_apis`, `get_spec_outline` and `get_operation`, plus **`get_schema(apiId, name)`**, which returns one component schema. With results held to ~30 kB, `get_operation` leaves deep references as `{ $ref, "x-truncated": true }`, and without `get_schema` those are dead ends for an agent that has only the MCP server.
- **D5. Results sized for agents, ~30 kB each** *Taken.* (Claude Code warns at 10,000 tokens and diverts results over 25,000 tokens to a file by default). Measured in production: Stripe's outline 93 kB, GitHub's 239 kB, Cloudflare's 761 kB (3,600 operations, 574 tags); every sampled Stripe operation hits its 1 MB cap.
  - `get_spec_outline` takes optional `tag` and `query` (substring of path, `operationId` or summary) and pages at most 100 operations with a `cursor`. Without a filter on a Spec over 100 operations, the first page carries the tag list with counts and says to filter.
  - `get_operation` inlines breadth-first to 24 kB (today's `expandOperation` with `maxBytes`).
  - The same filters, paging and a `GET /api/apis/{apiId}/schema?name=` route are added to the HTTP API, whose defaults stay as they are.
- **D6. Result shape:** *Taken; amended by Wes 2026-09-24 (#6, ADR 0005's amendment): the summary and next calls go in `structuredContent` too, because Claude Code shows the model only that.* each tool returns `structuredContent` (the JSON, with an `outputSchema`) and one `text` block that begins with a sentence for the agent and the next call to make (for example *"Resolved: Stripe API, Official Spec. Download: … Next: get_spec_outline(apiId: "stripe.com/stripe-api", query: "customers")."*). An error is `isError` with what went wrong and the call that fixes it (a wrong `path` gets the nearest paths from the outline). Spec content is never returned whole (PRD): the full Spec is its download URL.
- **D7. Acceptance target:** *Taken.* Val Town, as above. Alternatives: GitHub REST (unauthenticated reads work, but Claude knows it well, so it proves less), or Stripe with a test-mode key you'd provide.
- **D8. Docs:** *Taken.* a README "MCP" section and one "Use it from Claude Code" block on the landing page (still the interim page; Slice 6 replaces it).

## Where it stands going in

Slice 4 is accepted with its follow-ups (production `d0175c1`). The four operations exist as HTTP routes, each returning a `Response`: `handleLookupRequest` (`src/lookup/http.ts`: rate limit, body, key, Index answer, quota), `outlineResponse` (`src/spec-forms/http.ts`), `operationResponse` (`src/spec-forms/operation-http.ts`, `expandOperation` with `MAX_OPERATION_BYTES` 1 MB in `src/spec-forms/operation.ts`) and `vendorApisResponse` (`src/server/vendor-apis.ts`). One app and one per-IP gate are shared by every route (`src/server/app-instance.ts`). Unknown `/api/…` paths are a JSON 404 (`src/routes/api/$.ts`); `/mcp` is outside `/api/`, so it needs its own route. There is no MCP code or dependency.

## Order

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-129 | `/mcp`: the MCP endpoint, auth, and `lookup_api` | — | 1 |
| 2 | WTR-130 | `get_spec_outline` for agents: filters and paging (MCP and HTTP) | 1 | 2 |
| 3 | WTR-131 | `get_operation` and `get_schema` for agents | 1 | 2 |
| 4 | WTR-132 | `list_vendor_apis` over MCP | 1 | 2 |
| 5 | WTR-133 | `scripts/mcpcheck.ts`, the README section and the landing-page block | 2, 3, 4 | 3 |
| 6 | WTR-134 | The agent's guidance in `structuredContent` (after the acceptance) | 1–5 | 4 |

Wave 1 was queued on filing; wave 2 (WTR-130–132) is queued when WTR-129 merges, wave 3 when all three have. #2, #3 and #4 each add a file under `src/mcp/tools/` and one line to the tool list in `src/mcp/server.ts`, a mechanical conflict: wave 2 is merged one PR at a time, rebasing each on the last.

## Operator steps (not factory issues)

- **O1.** Deploy after waves 1, 2 and 3, keeping `docs/deploy.md` current. After wave 1, check from outside: `claude mcp add` the production URL and resolve Stripe.
- **O2.** The acceptance run (D7), recorded in `docs/slices/slice-5-result.md` with each MCP result's size: the default model, then Haiku. Then `scripts/mcpcheck.ts https://swaggerbot.dev` and `scripts/formscheck.ts https://swaggerbot.dev`.

---

## 1. swaggerbot: `/mcp`, the MCP endpoint, with auth and `lookup_api`

## Problem
The PRD's primary Caller is an agent over MCP, and swagger.bot has no MCP server. [ADR 0005](../adr/0005-mcp-in-process-with-agent-sized-results.md) decides how it is served; this issue builds the endpoint and the first tool.

## Change
- Add `@modelcontextprotocol/server` 2.1.0. `src/mcp/server.ts` exports `createSwaggerbotMcpHandler(deps)`: `createMcpHandler` with a factory that builds a fresh `McpServer({ name: "swagger.bot", version })` and registers the tools in a list (this issue: `lookup_api`). `src/routes/mcp.ts`: `createFileRoute("/mcp")` with an `ANY` handler.
- **Auth, before the handler:** take one token from the per-IP gate (429 JSON with `retry-after` when over). Read `Authorization: Bearer`. A key that is sent but names no live key → HTTP 401 with `WWW-Authenticate: Bearer` and the same JSON as `/api/lookup`. Otherwise call `handler.fetch(request, { authInfo })`, with `authInfo` carrying the key's id (or none). Never keep request state outside the call.
- **Share the Lookup's rules, don't copy them:** split `handleLookupRequest` so that its core (Index answer, else key required, quota, Lookup) is a function returning `{ status, body, headers }`, used by both `/api/lookup` and `lookup_api`. `/api/lookup`'s behaviour and tests stay the same.
- **`lookup_api`**: input `{ name, apiVersion?, allowCommunity?, fresh? }` (the `LookupBody` schema). Returns `structuredContent` = the Outcome, and a `text` block that starts with one sentence per Outcome (see ADR 0005 and D6 in the backlog): for Resolved, the API id, Provenance and both download URLs, then the next call, `get_spec_outline`. Ambiguous lists the candidate names to retry with; Discovery without a key says a key is needed and how it is sent; a used quota says when it resets. The tool description is written for an agent: what the tool is for, that the Spec itself is a download URL, never inline, and what to call next.
- An error the Lookup returns (401, 429, 400) is a tool result with `isError: true`, its message and hint, not a protocol error.

## Done when
- Tests (the SDK's in-memory client, or `handler.fetch` with JSON-RPC bodies): `tools/list` has `lookup_api` with its input schema; an Index name resolves without a key; Discovery without a key is `isError` with the key hint; an unknown key is HTTP 401 before any tool runs; the rate limit is shared with `/api/lookup`; two concurrent requests with different keys each see their own key.
- `pnpm check` and `pnpm build` green.
- The manual check in the PR: start the built server on a copy of an Index, then `claude -p "Using only the swaggerbot MCP tools, find the Stripe API's Spec and give its download URL" --mcp-config <file> --strict-mcp-config --allowedTools "mcp__swaggerbot__*" --model haiku` answers with the `/api/specs/…/published` URL. Paste the output.

## 2. swaggerbot: `get_spec_outline` for agents, with filters and paging

## Problem
The Spec Outline is too big for an agent: 93 kB for Stripe, 239 kB for GitHub and 761 kB for Cloudflare (3,600 operations, 574 tags), against Claude Code's 10,000-token warning. An agent needs the part of the outline for its task.

## Change
- Shared, in `src/spec-forms/`: `pageOutline(outline, { tag?, query?, cursor?, limit? })` → `{ apiId, specId, title, apiVersion, servers, securitySchemes, tags, operations, totalOperations, matchedOperations, nextCursor }`. `tag` matches a tag name ignoring case. `query` matches a substring (ignoring case) of the path, `operationId` or summary. Operations stay in outline order; `limit` defaults to 100 (at most 500 over HTTP, 100 over MCP); `cursor` is opaque (an offset is fine). `tags` is always the full list with counts, unless the list alone is over 20 kB, in which case the first 200 tags by count, with a flag.
- HTTP: `GET /api/apis/{apiId}/outline` takes the same optional parameters. **Without any of them it answers exactly as today** (the whole outline), so existing Callers and `formscheck` don't change.
- MCP: `get_spec_outline({ apiId, specId?, tag?, query?, cursor? })`. Without `tag` or `query`, on a Spec over 100 operations, the result is the tag list and the first page, and its text says to filter by `tag` or `query`. The text names the next call (`get_operation` for one of the rows; `cursor` when there is more). A pending Normalized Form is `isError` with "retry in 10 s", as the HTTP route's 409.
- Every MCP result stays under 30 kB (`JSON.stringify` of `structuredContent` plus the text).

## Done when
- Tests: filtering by tag and by query, paging across the end, the 30 kB bound on a generated outline of 4,000 operations and 600 tags, the HTTP route unchanged without parameters.
- `pnpm check` and `pnpm build` green.
- The manual check in the PR, on a copy of an Index with Cloudflare, GitHub and Stripe: the size of `get_spec_outline` with no filter, with `query: "customers"` (Stripe) and with `tag: "repos"` (GitHub), each under 30 kB.

## 3. swaggerbot: `get_operation` and `get_schema` for agents

## Problem
Every sampled Stripe operation stops at `get_operation`'s 1 MB cap, 40 times what an agent can take in one result. At an agent-sized budget, the references left are `{ $ref, "x-truncated": true }`, and an agent with only the MCP server can't follow them.

## Change
- MCP `get_operation({ apiId, method, path, specId? })`: the same answer as `GET /api/apis/{apiId}/operation`, with `expandOperation`'s `maxBytes` at 24 kB. `method` is any case. A `path` that isn't a key of the Normalized Form's `paths` is `isError` with up to 5 nearest paths from the outline (same method first), so a typo or a filled-in parameter (`/v1/customers/cus_123`) recovers in one call. The text says how many references were left and that `get_schema` follows them.
- Shared: `schemaOf(normalized, name)` returns `components.schemas[name]` expanded the same way (breadth-first, `x-circular`, `maxBytes`), from the cached Normalized Form. `name` may be the bare name or the whole `#/components/schemas/<name>` reference.
- HTTP `GET /api/apis/{apiId}/schema?name=…[&specId=…]` (open, per-IP limit, 1 MB cap as `operation`); MCP `get_schema({ apiId, name, specId? })` at 24 kB. An unknown name is 404 / `isError` with the nearest names.

## Done when
- Tests: a truncated operation's reference is followed with `get_schema`; the path suggestions (a typo, a filled-in parameter, a wrong method); the 30 kB bound; `x-circular` kept.
- `pnpm check` and `pnpm build` green.
- The manual check in the PR: Stripe `GET /v1/account` and `POST /v1/customers` over MCP, each under 30 kB, and one reference they leave followed with `get_schema`.

## 4. swaggerbot: `list_vendor_apis` over MCP

## Problem
The fourth PRD operation, `GET /api/vendors/{vendor}/apis`, has no MCP tool.

## Change
MCP `list_vendor_apis({ vendor })`, over `vendorApisResponse`'s rules (id, domain, remembered API name, brand label, Vendor name, first word of a remembered name). 200 → the Vendor and its APIs, each with its Current Spec's id, Provenance and download URLs; the text lists them and names `get_spec_outline` as the next call. 300 (several Vendors) → `isError` listing them, to retry with an id. 404 → `isError` with the hint to use `lookup_api`, which adds an API to the Index.

## Done when
- Tests: one Vendor, several, none.
- `pnpm check` and `pnpm build` green.
- The manual check in the PR: `list_vendor_apis({ vendor: "Jira" })` and `({ vendor: "stripe.com" })` on a copy of an Index.

## 5. swaggerbot: `scripts/mcpcheck.ts`, the README's MCP section and the landing page's block

## Problem
Slice 5's acceptance needs a repeatable check of the deployed MCP server, and Callers need to know how to add it.

## Change
- `scripts/mcpcheck.ts <baseUrl> [--names Stripe,GitHub REST API,Cloudflare] [--json]`: connects with the SDK's HTTP client (`LOADCHECK_KEY` as the bearer when set), lists the tools (all five must be there), and for each name runs `lookup_api` (must be Resolved), `get_spec_outline` unfiltered and with a `query` taken from its first page, `get_operation` on 3 operations of that page, and `get_schema` on one reference they left. Prints each call's time and result size; exits 1 on any error, any result over 30 kB, or a call over 2 s (Lookups from the Index included).
- README: an "MCP" section: the endpoint, the `claude mcp add` command, the five tools, the key rules (D3), result sizes.
- The landing page (`src/routes/index.tsx`): one short "Use it from Claude Code" block with the `claude mcp add` command, and `/mcp` in the route table.

## Done when
- `pnpm check` and `pnpm build` green; the script's `--help`.
- The manual check in the PR: `mcpcheck` against the built server on a copy of an Index passes, output pasted.

## 6. swaggerbot: MCP guidance reaches Claude Code, in `structuredContent`

## Problem
D6 put the guidance an agent needs in each MCP result's `text` block: what was found, what was left out, and the call to make next. Claude Code (2.1.281) shows the model only `structuredContent` when a result has it. The text never arrives. Checked on production: asked to quote what `lookup_api` returned, Haiku quoted the Outcome JSON, not the "Resolved: … Next: get_spec_outline(…)" sentence. Wes chose to put the guidance in the structured result ([ADR 0005](../adr/0005-mcp-in-process-with-agent-sized-results.md), amendment).

## Change
- `src/mcp/result.ts`: one helper that builds every successful tool result from `{ summary, next, data }`:
  - `structuredContent` = `{ summary, next, ...data }`, with `summary` and `next` as the object's first keys, so they come first in the JSON.
  - The `text` block = `summary`, then `Next: ` and the `next` calls joined with "; or ". This keeps what each tool writes in its text today.
  - `summary` is a string: today's text up to the "Next:" sentence.
  - `next` is a list of call strings, for example `get_spec_outline(apiId: "stripe.com/stripe-api")`. It is empty when there is nothing to call.
- All five tools use it: `lookup_api`, `list_vendor_apis`, `get_spec_outline`, `get_operation`, `get_schema`. Each keeps its current sentences, and moves each "Next: …" call into `next`.
- Every tool declares an `outputSchema`: the answer's schema extended with `summary` and `next`. `lookup_api`'s answer is the Outcome, a union; `z.intersection` or a per-member `.extend` is fine. SDK 2.1.0 adds `type: "object"` to such a root and doesn't wrap it as `{ result }`.
- Error results (`isError`) stay as they are: text only, with no `structuredContent`, which Claude Code shows.
- The HTTP API does not change, including the bodies of `/api/lookup` and `/api/apis/…`.
- Also:
  - Add tool-level tests for the pending and failed Normalized Form texts of `get_operation`, `get_schema` and `get_spec_outline`.
  - When a name has no near match, `get_schema` gives no "Next:" name. It points to `get_spec_outline` or `get_operation` instead.

## Done when
- Tests: for each tool's success, `structuredContent`'s first two keys are `summary` and `next`, and the text equals the summary followed by the next calls. The result validates against the tool's `outputSchema`. The 30 kB bound still holds, counting the new fields. The errors are unchanged. The new tests for pending, failed and no-match pass.
- `pnpm check` and `pnpm build` green.
- Manual check in the PR: start the built server on a copy of an Index, then run `claude -p "Call the swaggerbot lookup_api tool once with name Stripe, then quote verbatim the first 300 characters of exactly what the tool returned to you." --mcp-config <file> --strict-mcp-config --allowedTools "mcp__swaggerbot__*" --model haiku`. The quote must begin with `{"summary":"Resolved:`. Also run `scripts/mcpcheck.ts` against it and paste the output.

