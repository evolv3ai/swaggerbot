# Slice 4 backlog: Spec forms and navigation

The issues for [Slice 4](../PRD.md#slice-4--spec-forms-and-navigation), written so the weawr factory can build them: each numbered body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue live in `.weawr/instructions.md`.

**Acceptance:** the Normalized Form (with Swagger 2 → OpenAPI conversion and bundling), Validity Issues, download URLs for both forms, `get_spec_outline`, `get_operation` and `list_vendor_apis` work on the largest Benchmark Specs without timeouts. The PRD names GitHub and Stripe; we also hold Cloudflare to it, because at 26 MB it is the largest Spec in the Index. Measured in production by `scripts/formscheck.ts` (#8). Nothing may cost what Slice 3 bought: False Resolution stays < 2% on `pnpm bench`, and Discovery p90 stays < 15 s.

## Decisions going in (Wes, 2026-09-23)

Recorded in [ADR 0004](../adr/0004-normalized-form-built-in-background-with-scalar.md). **The backlog and ADR 0004 were approved by Wes, 2026-09-23.**

- **Library and target:** `@scalar/openapi-parser` (with `@scalar/json-magic` for bundling), converting to **OpenAPI 3.1**.
- **Stored, not computed per request.** The Normalized Form, the Validity Issues and the Spec Outline are stored in the Index.
- **Built in the background, one Spec at a time.** A Lookup answers at once, and a new Spec's Normalized Form is `pending` until the worker has built it. Existing Specs are backfilled.
- **Downloads are open, addressed by Spec id:** `GET /api/specs/{specId}/published` and `…/normalized`, under the per-IP rate limit like Index answers.
- **External `$ref`s** are fetched only from the Spec's own origin, through the polite fetcher. Any other is a Validity Issue.
- **A Validity Issue** is a validator finding on the Published Form, or an unresolved external reference. Identical messages are grouped as `{message, path, count}`, and the Outcome carries at most 50 of them plus a total count.
- **`list_vendor_apis`** lists only the Vendor's APIs in the Index. Storing the Vendor-API crawl's candidates (WTR-51) as APIs is a later decision.
- **`get_operation`** inlines every schema the operation reaches. A schema that recurs within itself stays a `$ref` marked `x-circular`, and is listed once beside the operation. Responses are capped at 1 MB.

## Where it stands going in

Slice 3 is accepted (`024bc88`; [result](slice-3-result.md)). Production (`b7c880b`) holds **20 Vendors with one API each**, and 27 Specs, all OpenAPI 3.0.x or 3.1.0: **no Swagger 2 Spec is in the Index**, so conversion is proven on fixtures, not on production data. The largest Specs are Cloudflare (26.0 MB JSON, 2,241 paths), Infisical (13.5 MB), GitHub (13.0 MB, stored twice under two Spec ids) and Stripe (6.4 MB YAML).

The Index stores only `published_bytes` (`src/index-store/schema.ts`). The Resolved Outcome has `validityIssues: z.array(z.never())`, always `[]` (`src/domain/outcome.ts`), and no download URLs. There are no routes but `POST /api/lookup` and `GET /api/health`. The per-IP rate limiter and the lazily built app are local to `src/routes/api/lookup.ts`. The rule that picks the Current Spec (`currentAndFull`, and `answerFromIndex` around it) is private to `src/lookup/lookup.ts`.

### Scalar spike (2026-09-23, `@scalar/openapi-parser` 0.29.5, Node 24, throwaway)

| Spec | as published | upgrade | validate | dereference | findings | peak RSS |
|---|---|---|---|---|---|---|
| Cloudflare, 26.0 MB | 3.0.3 | 0.21 s | 0.36 s | 0.55 s | 3 (`allowReserved` where it isn't allowed) | ~830 MB |
| GitHub, 13.0 MB | 3.1.1 | 0.11 s | 0.27 s | 0.24 s | 0 | ~400 MB |
| Kubernetes, 4.5 MB | **2.0** | 0.12 s | 0.16 s | 0.13 s | 1 as published; **1,202 after upgrade** | ~330 MB |

What it taught, and the issues must respect:
- **`upgrade` mutates its input.** Work on a copy.
- **The upgrader leaves Swagger 2 fields behind.** All 1,202 of Kubernetes' new findings are `Property schemes is not expected to be here` on operations. Validity Issues are therefore measured on the Published Form, and the builder strips such leftovers and validates its own output. What remains is our defect, not the Vendor's.
- **Speed is fine and memory is the constraint.** One build at a time, and a size ceiling above which a build is refused rather than risking the 2 GB container.
- A build is roughly a second of synchronous work for the largest Spec. O1 measures Index latency while the backfill runs.

## Order

Filed 2026-09-23 as WTR-104..111 (Backlog, `swaggerbot` only), with Linear "blocked by" relations mirroring this table.

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-104 | `src/spec-forms/`: build the Normalized Form, Validity Issues and Spec Outline with Scalar | — | 1 |
| 2 | WTR-105 | Store the forms: `spec_forms` table, background build worker, backfill | 1 | 2 |
| 3 | WTR-106 | The Outcome carries download URLs, the Normalized Form's status and real Validity Issues | 2 | 3 |
| 4 | WTR-107 | Download routes, and one shared app and per-IP gate for every route | 2 | 3 |
| 5 | WTR-108 | `get_spec_outline`: `GET /api/apis/{apiId}/outline` | 3, 4 | 4 |
| 6 | WTR-109 | `get_operation`: `GET /api/apis/{apiId}/operation` | 3, 4 | 4 |
| 7 | WTR-110 | `list_vendor_apis`: `GET /api/vendors/{vendor}/apis` | 3, 4 | 4 |
| 8 | WTR-111 | `scripts/formscheck.ts`: the acceptance check against a deployed URL | 5, 6, 7 | 5 |
| 9 | WTR-112 | The Normalized Form drops `allowReserved` from parameters that aren't `query` (added 2026-09-23 after WTR-104: Cloudflare's 3 normalized findings) | 1 | 2 |

#3 and #4 touch different files (`lookup.ts` and `outcome.ts`; routes and `src/server/`), so they run together. #5, #6 and #7 each add a route file, and TanStack's generated `src/routeTree.gen.ts` changes with each. That's a mechanical conflict, so wave 4 is merged one PR at a time, regenerating the route tree (`pnpm build`) on each rebase.

## Operator steps (not factory issues)

- **O1.** After #2 merges and deploys, watch the backfill in production: every Spec gets a `spec_forms` row, and none fails. Record the build times and the container's peak memory (`docker stats`) in `docs/deploy.md`. While it runs, run `scripts/loadcheck.ts`'s Index phase: Index p90 must stay < 200 ms (ADR 0004 accepts builds on the event loop only on that condition; otherwise file moving the build to a worker thread).
- **O2.** Set `PUBLIC_BASE_URL=https://swaggerbot.dev` in Coolify before #3 deploys, so download URLs are absolute.
- **O3.** Deploy after each wave that changes production behaviour (waves 2, 3 and 4), keeping `docs/deploy.md` current.
- **O4.** Run `scripts/formscheck.ts https://swaggerbot.dev` and `pnpm bench --concurrency 1` (twice), and record both in `docs/slices/slice-4-result.md`.

---

## 1. swaggerbot: `src/spec-forms/` — build the Normalized Form, Validity Issues and Spec Outline with Scalar

## Problem
Slice 4 delivers every Spec in two forms, with its Validity Issues and a Spec Outline (PRD "Spec delivery"; `CONTEXT.md`: Normalized Form, Validity Issue, Spec Outline). Nothing builds any of them yet. ADR 0004 settles the library (`@scalar/openapi-parser`, plus `@scalar/json-magic` for bundling) and the target (OpenAPI 3.1). This issue is the pure building block. Storing its output is #2, and serving it is #3–#7.

## Change
Add the dependencies `@scalar/openapi-parser` and `@scalar/json-magic` (current versions; `@scalar/openapi-parser` was 0.29.5 on 2026-09-23). Only `src/spec-forms/` may import them.

**Types** (`src/domain/spec-forms.ts`, zod like the rest of `src/domain/`):
- `ValidityIssue = { message: string; path: string; count: number }`. `path` is the JSON pointer of the first finding with that message. `count` is how many findings share the message.
- `SpecOutline = { title: string | null; apiVersion: string | null; servers: string[]; securitySchemes: { name: string; type: string; scheme?: string; in?: string }[]; tags: { name: string; operationCount: number }[]; operations: { method: string; path: string; operationId?: string; summary?: string; tags: string[]; deprecated?: true }[] }`. `method` is lowercase, and `operations` follows the order of the Normalized Form's `paths`. Tags come in the order of the document's `tags` array, then any that only appear on operations. Every field comes mechanically from the Normalized Form, never from a Judge (ADR 0001).

**Builder** (`src/spec-forms/build.ts`):
```ts
buildSpecForms(input: {
  bytes: Uint8Array;           // the Published Form
  format: "json" | "yaml";
  sourceUrl: string;           // where it was found; external $refs resolve against it
  fetchRef?: (url: string) => Promise<Uint8Array>;  // same-origin external $refs; omitted → none are fetched
}): Promise<SpecForms>
// SpecForms = { normalized: Uint8Array (minified JSON); normalizedSpecVersion: string;
//               validityIssues: ValidityIssue[] (all groups); validityFindingCount: number;
//               normalizedFindingCount: number; outline: SpecOutline }
```
The steps, in order:
1. **Parse** the bytes (JSON, or YAML with the existing `yaml` dependency). A document that doesn't parse, or isn't OpenAPI or Swagger, throws a `SpecFormsError` with a message saying so.
2. **Bundle** external `$ref`s with `@scalar/json-magic`'s `bundle` and a plugin of our own. It resolves a reference only when its absolute URL has the same origin as `sourceUrl`, by calling `fetchRef`. Every other external reference, and every fetch that fails, stays unresolved and becomes a Validity Issue (`Unresolved external reference: <url>`, at the `$ref`'s pointer). Internal (`#/…`) references are never fetched.
3. **Validate the Published Form** (bundled, at its own version) with `validate`. Group its findings, plus step 2's, by message into `validityIssues`. `validityFindingCount` is the total before grouping.
4. **Upgrade a copy** (`structuredClone`) with `upgrade`. It mutates its input.
5. **Strip what the upgrader leaves behind.** Swagger 2 keys that have no place in OpenAPI 3.1: on operations at least `schemes`, `consumes` and `produces`, and at the root `host`, `basePath`, `schemes`, `consumes`, `produces`, `securityDefinitions` and `definitions` if still present. Keep the list in one exported constant with a comment citing ADR 0004.
6. **Validate the Normalized Form.** `normalizedFindingCount` is how many findings remain. They are our defect, not a Validity Issue. The builder doesn't throw on them.
7. **Outline** from the Normalized Form (see the type above).
8. Serialize the Normalized Form as minified JSON. `normalizedSpecVersion` is its `openapi` field.

**Size ceiling.** `buildSpecForms` refuses Published bytes over `MAX_FORMS_BYTES` (env, a positive integer; default 32 MB; read like `MAX_SPEC_BYTES` in `src/fetch/fetcher.ts`) with a `SpecFormsError("too large")`. This protects the 2 GB container (ADR 0004: a 26 MB Spec peaks near 830 MB).

**Fixtures** (`src/spec-forms/__fixtures__/`, small and hand-written): a Swagger 2.0 JSON document with operation-level `schemes`/`consumes`/`produces`, `definitions`, a `body` parameter and `securityDefinitions`; an OpenAPI 3.0 YAML document with tags and a circular schema; a 3.1 document whose `$ref` points to a second file on the same origin, and one whose `$ref` points to another origin; and a document with a known validator finding.

**`scripts/forms-bench.ts [--out <dir>] <file>…`:** builds each file (JSON or YAML, by extension) and prints the timings of each step, the finding counts and the peak RSS. With `--out`, it also writes each Normalized Form as `<dir>/<basename>.normalized.json`. It's for the reviewer to run on real large Specs, which are not committed.

## Done when
- `src/spec-forms/build.test.ts`:
  - The Swagger 2 fixture comes out as OpenAPI 3.1.x with `components.schemas`, a `requestBody` and `components.securitySchemes`, **no** operation-level `schemes`/`consumes`/`produces`, and `normalizedFindingCount` 0.
  - Every fixture that is valid as published has `normalizedFindingCount` 0.
  - The input bytes are unchanged after a build.
  - The same-origin `$ref` is fetched through `fetchRef` and bundled. The other-origin one isn't fetched and is reported as an unresolved external reference. Without `fetchRef`, nothing is fetched.
  - The fixture with a known finding reports it grouped with the right `count`, and a Spec with no findings has `validityIssues: []`.
  - The outline of the 3.0 fixture lists its tags with operation counts, its operations in order, and its security schemes.
  - Unparseable bytes, a non-OpenAPI document and bytes over `MAX_FORMS_BYTES` each throw `SpecFormsError`.
- In the PR description, as a manual check for the reviewer: `pnpm tsx scripts/forms-bench.ts` on Cloudflare's Spec (`https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json`) and Kubernetes' Swagger 2 Spec (`https://raw.githubusercontent.com/kubernetes/kubernetes/master/api/openapi-spec/swagger.json`). Expected: each builds in under 3 s, and Kubernetes has `normalizedFindingCount` 0 (it was 1,202 before stripping).
- `pnpm check` and `pnpm build` green.

---

## 2. swaggerbot: store the forms — `spec_forms` table, background build worker, backfill

## Problem
ADR 0004: the Normalized Form, Validity Issues and Spec Outline are stored in the Index, and built by an in-process worker one Spec at a time, so a Lookup never waits for a build and two large builds never share the container. #1 built `buildSpecForms`, but nothing calls it.

## Change
**Schema** (`src/index-store/schema.ts`, and a Drizzle migration generated with `drizzle-kit generate`, which will be `0007_*`). `spec_forms`, one row per Spec:
- `spec_id` (text PK, FK → `specs.id`)
- `status` (text enum `building` | `ready` | `failed`)
- `normalized_bytes` (blob, nullable) and `normalized_spec_version` (text, nullable)
- `validity_issues` (text JSON, nullable) and `validity_finding_count` (integer, nullable)
- `normalized_finding_count` (integer, nullable)
- `outline` (text JSON, nullable)
- `attempts` (integer, default 0), `last_error` (text, nullable)
- `started_at`, `built_at` (nullable)

A Spec with no row, or a `building` row left by a stopped process, is **pending**.

**Repo** (`src/index-store/spec-forms.ts`, taking the same `Db`, beside `keys.ts`):
- `nextToBuild()`: the oldest Spec (by `specs.created_at`) that has no row, or has a row that is neither `ready` nor `failed`.
- `markBuilding(specId, at)`, `saveBuilt(specId, forms, at)`, `saveFailure(specId, error, at)`. A failure increments `attempts` and sets `failed` once `attempts` reaches `MAX_FORMS_ATTEMPTS = 3`. A `SpecFormsError("too large")`, or a document that isn't OpenAPI, fails at once.
- `getForms(specId)`: `{ status: "ready" | "pending" | "failed", normalized?, normalizedSpecVersion?, validityIssues?, validityFindingCount?, outline? }`, parsing the JSON columns through #1's zod types.
- `getNormalizedBytes(specId)`, separately, so callers that don't need the bytes never load them.

**Worker** (`src/spec-forms/worker.ts`), shaped like the Verification worker in `src/lookup/verify.ts`:
- `runOnce()` builds `nextToBuild()` and returns `false` when there was nothing to build.
- `start()` loops, one build at a time, polling every `FORMS_POLL_MS = 5_000` while there's nothing to build, on a timer that never keeps the process alive. `stop()` stops it.
- It reads the Spec's bytes and format, and a Source URL (the best-Provenance Source, as `resolved` picks it), and calls `buildSpecForms` with a `fetchRef` that uses the app's fetcher (so robots.txt, the per-host rate limit and the User-Agent apply) and a 30 s total budget for all external references of one Spec.
- Yield to the event loop (`await setImmediate()` from `node:timers/promises`) between the build's steps, so a pending HTTP request can run between them. Adding an optional `onStep` callback to `buildSpecForms` for this is fine.
- Backfill needs no extra code: every Spec stored before this migration has no row, so it's pending.

**Wiring:** `createApp` in `src/lookup/app.ts` starts the worker beside the Verification worker, over the same `db` and fetcher, and returns it. `createAppLookup` (bench, scripts) starts no worker.

`README.md`: `MAX_FORMS_BYTES`, and a sentence on the background build.

## Done when
- `src/index-store/spec-forms.test.ts`, on a temp database: a Spec with no row is next to build; after `saveBuilt` it's `ready` and `getForms` returns what was saved; three failures make it `failed`, and it's no longer next; a "too large" failure is `failed` at once; a `building` row is picked again (the process stopped mid-build).
- `src/spec-forms/worker.test.ts`: `runOnce` on an Index with two Specs builds the older one first, then the other, then returns `false`. A Spec whose bytes don't parse ends `failed` without stopping the worker. `fetchRef` goes through the injected fetcher (a local `node:http` server on port 0).
- The migration is generated, not hand-written, and applies on an existing Index.
- `pnpm check` and `pnpm build` green.

---

## 3. swaggerbot: the Outcome carries download URLs, the Normalized Form's status and real Validity Issues

## Problem
PRD "Lookup": a Resolved answer returns "Validity Issues … and download URLs for the Published Form and Normalized Form". Today `validityIssues` is typed `never[]` and always empty, and there are no download URLs. #2 stores the forms. Also, #5–#7 need "the Current Spec of this API, from the Index" with the exact rule a Lookup uses, which is private to `src/lookup/lookup.ts` today.

## Change
**Outcome** (`src/domain/outcome.ts`):
- Every Spec in an Outcome (`currentSpec`, each of `alternateSpecs`, Unconfirmed's `spec`) becomes a `SpecAnswer`: the domain `Spec` plus `downloads: { published: string; normalized: string }` and `normalized: "ready" | "pending" | "failed"`. Keep `Spec` itself unchanged, because the repo uses it.
- Resolved: `validityIssues: ValidityIssue[]` (from #1's types), at most `MAX_OUTCOME_VALIDITY_ISSUES = 50`, taking the groups with the highest `count` first; and `validityIssueCount: number`, the Current Spec's `validity_finding_count`, 0 while pending. Unconfirmed gains the same two fields for its Spec.

**Download URLs:** `${PUBLIC_BASE_URL}/api/specs/{specId}/published` and `…/normalized`. `PUBLIC_BASE_URL` is an env var with no trailing slash. When it's unset, the URLs are paths starting with `/api/`.

**Where:** add the fields in one function, e.g. `withSpecForms(outcome, forms, baseUrl)` in `src/spec-forms/outcome.ts`. Apply it at the Lookup's two public entry points in `createLookup` (the Lookup itself and `fromIndex`), so HTTP answers, `pnpm bench` and the scripts all carry it. Don't thread it through the pipeline. It reads only the small columns (status, Validity Issues, finding count), never the Normalized bytes.

**The Current Spec from the Index:** export an `IndexedLookup` method, e.g. `currentFromIndex(apiId): { api, vendor, currentSpec, alternateSpecs, provenance, sources, verifiedAt } | null`. Build it from the **same** code `answerFromIndex` uses (`currentAndFull` and what surrounds it), with Community excluded and no Preview Versions, exactly as a default Lookup answers. It returns Specs as `SpecAnswer`s too. Refactor `answerFromIndex` to use it where they overlap. Don't duplicate the rule. It runs no Discovery and queues no Verification.

`README.md`: the new Outcome fields, and `PUBLIC_BASE_URL`.

## Done when
- `src/lookup/lookup.test.ts`: a Resolved answer from the Index carries both download URLs for the Current Spec and each Alternate, with `normalized: "pending"` before a build and `"ready"` after `saveBuilt`. It carries the stored Validity Issues, capped at 50 with the largest `count` first, and `validityIssueCount`. With `PUBLIC_BASE_URL` set the URLs are absolute, and without it they are paths. An Unconfirmed answer has the same fields for its Spec.
- `currentFromIndex` returns the same Current Spec and Alternates as `fromIndex` for a name that resolves to that API, including a case where `currentAndFull` passes over a partial or deprecated Spec. It returns `null` for an unknown `apiId`, and for an API whose only Spec is unconfirmed or Community.
- `src/domain/outcome.test.ts` updated for the new shape.
- `pnpm check` and `pnpm build` green.

---

## 4. swaggerbot: download routes, and one shared app and per-IP gate for every route

## Problem
PRD "Spec delivery": the Published Form is returned byte for byte by default, and the Normalized Form on request. ADR 0004: downloads are open, addressed by Spec id, under the per-IP rate limit. Slice 4 adds five routes, and today the per-IP limiter and the lazily built app live inside `src/routes/api/lookup.ts`. Each new route would otherwise build its own app (a second database connection and a second pair of workers) and its own limiter (a Caller would get 60 a minute **per route**, not 60 in all, as Slice 3 decided).

## Change
**Shared server state** (`src/server/app-instance.ts`): move the lazily built `app` and the `gate` (rate limiter, client-IP header, daily quota) out of `src/routes/api/lookup.ts`, and export `getApp()` and `gate`. `POST /api/lookup` uses them, and behaves exactly as before. Add a helper for open GET routes, e.g. `openGet(request, handler)`: it applies the per-IP limit (429 with `retry-after`, as `handleLookupRequest` does) and then calls the handler. Keep `handleLookupRequest`'s order and responses unchanged.

**Routes** (TanStack Start server routes, like `src/routes/api/health.ts`):
- `GET /api/specs/{specId}/published`: the stored bytes, byte for byte.
  - `content-type: application/json` or `application/yaml`, by the Spec's `format`.
  - `content-disposition: inline; filename="<api-slug>-<first 12 of specId>.<json|yaml>"`.
  - `etag: "<specId>"` and `cache-control: public, max-age=31536000, immutable`. `If-None-Match` with that ETag gets 304.
- `GET /api/specs/{specId}/normalized`:
  - Ready: the Normalized bytes, `content-type: application/json`, `etag: "<specId>-n"`, `cache-control: public, max-age=86400` (not immutable; the Normalized Form may be rebuilt by a later builder).
  - Pending: 409 `{ status: "pending" }` with `retry-after: 10`.
  - Failed: 422 `{ status: "failed", error }`.
- A `specId` that isn't 64 lowercase hex characters gets 400, and an unknown one 404.

These need no API key and use no quota. Send the bytes as a `Uint8Array` body, not through `Response.json`.

## Done when
- `src/routes/api/specs.test.ts` (or beside each route), with an Index built in a temp database:
  - The Published bytes round-trip exactly, for a JSON Spec and a YAML one, with the right headers, and 304 on a matching `If-None-Match`.
  - The Normalized download returns 409 while pending, 200 when ready and 422 when failed.
  - A malformed id gets 400 and an unknown one 404.
  - The 61st request in a minute from one IP gets 429 **across** `POST /api/lookup` and the download routes together.
- `src/routes/api/lookup.test.ts` still passes unchanged, apart from imports.
- `pnpm check` and `pnpm build` green.

---

## 5. swaggerbot: `get_spec_outline` — `GET /api/apis/{apiId}/outline`

## Problem
PRD "Surfaces": `get_spec_outline(apiId)` returns the Spec Outline, a compact table of contents of a Spec, so a Caller (above all an agent over MCP, in Slice 5) can navigate a Spec without reading all of it (`CONTEXT.md`). #2 stores each Spec's Outline, #3 gives the Current Spec of an API, and #4 gives the shared gate.

## Change
**Route:** `GET /api/apis/{apiId}/outline[?specId=…]`, an open GET under #4's per-IP gate. An `apiId` contains a slash (`stripe.com/stripe-api`), so use a splat route and parse the id with `ApiId` from `src/domain/catalog.ts`.
- Without `specId`: the Current Spec, from #3's `currentFromIndex`. With it: that Spec, which must belong to the API (else 404). This is how an Alternate's outline is reached.
- 200: `{ apiId, specId, specVersion, normalized: "ready", outline: SpecOutline, downloads }`.
- 409 `{ status: "pending" }` with `retry-after: 10` while the Spec's forms are pending, and 422 when they failed.
- 404 for an API not in the Index, or with no Current Spec. The message says a Lookup (`POST /api/lookup`) finds APIs.
- Read only the `outline` column. The response must not load the Normalized bytes.

Put the handler logic in a plain function (e.g. `src/spec-forms/http.ts`) that the route calls, so it's tested without the router, as `handleLookupRequest` is.

## Done when
- Tests with an Index in a temp database, a Spec and its saved forms: the outline of the Current Spec by `apiId`; of an Alternate by `specId`; 404 for a `specId` of another API; 409 pending; 422 failed; 404 for an unknown or malformed `apiId`.
- The route resolves `stripe.com/stripe-api` through the splat (a request-level test, like `src/routes/api/lookup.test.ts`).
- `pnpm check` and `pnpm build` green.

---

## 6. swaggerbot: `get_operation` — `GET /api/apis/{apiId}/operation`

## Problem
PRD "Surfaces": `get_operation(apiId, method, path)` returns one operation "with its schemas fully expanded", so a Caller can call it without chasing `$ref`s. The largest Specs (GitHub, Stripe, Cloudflare) have circular schemas and operations whose full expansion is huge. Decided (Wes, 2026-09-23): inline everything the operation reaches, leave a schema that recurs within itself as a `$ref` marked `x-circular`, list those schemas once beside the operation, and cap the response at 1 MB.

## Change
**Route:** `GET /api/apis/{apiId}/operation?method=get&path=/v1/customers/{customer}[&specId=…]`, an open GET under #4's gate, with a splat route for `apiId` as in #5. The path goes in the query because it contains slashes and braces. `method` is case-insensitive, and `path` must equal a key of the Normalized Form's `paths` exactly.

**Expansion** (`src/spec-forms/operation.ts`, a pure function over the parsed Normalized Form):
- The result is the operation object, with the path-level `parameters` merged in (an operation-level parameter with the same `name` and `in` wins), and the effective `security` (the operation's, else the document's).
- Every `$ref` into `#/components/…` that the operation reaches is inlined: parameters, request bodies, responses, headers and schemas, at any depth.
- **Cycles:** while expanding, a schema already being expanded higher on the **same** branch is not inlined again. It becomes `{ "$ref": "#/components/schemas/X", "x-circular": true }`, and `X` is added to a `circular` map, which holds each such schema once, itself expanded under the same rule. A schema that merely appears twice on different branches is inlined both times.
- **Cap:** when the serialized response would exceed `MAX_OPERATION_BYTES = 1_000_000`, stop inlining. Leave remaining references as `{ "$ref": …, "x-truncated": true }` and set `truncated: true`. Expand breadth-first, so what's cut is the deepest detail, not a whole response.
- Also return the `securitySchemes` the effective security names.

**Response:** `{ apiId, specId, method, path, operation, circular, securitySchemes, truncated }`. Otherwise:
- 404 `{ error, hint }` when the path or method isn't in the Spec. The hint names the outline route.
- 409/422 while the forms are pending or failed, as in #5.
- 400 without `method` or `path`.

**Memory:** parsing a 13 MB Normalized Form costs hundreds of megabytes. Keep **one** parsed Normalized Form in memory, keyed by Spec id, and make concurrent requests for the same Spec share one parse (single-flight). A request for another Spec replaces it. Don't cache expanded operations.

Handler logic in a plain function, as in #5.

## Done when
- `src/spec-forms/operation.test.ts`:
  - Path-level parameters are merged, and an operation-level one wins.
  - Nested `$ref`s are inlined.
  - A self-referencing schema (`Node.children: Node[]`) comes out as one inlined level with an `x-circular` `$ref`, plus `Node` in `circular`.
  - The same schema on two branches is inlined twice.
  - A response that would exceed the cap is `truncated` with `x-truncated` refs, and is under 1 MB.
  - Effective security falls back to the document's.
- Handler tests: an unknown path or method gets 404 with the hint; `GET` and `get` both work; pending gets 409; two concurrent requests for one Spec parse it once (count the parses through an injected parser).
- In the PR description, as a manual check: the expansion of GitHub's `GET /repos/{owner}/{repo}/pulls` and Stripe's `POST /v1/customers`, with its size and time. Expand them from the Normalized Forms that `scripts/forms-bench.ts --out` writes.
- `pnpm check` and `pnpm build` green.

---

## 7. swaggerbot: `list_vendor_apis` — `GET /api/vendors/{vendor}/apis`

## Problem
PRD "Surfaces": `list_vendor_apis(vendor)` returns "the Vendor's APIs, from the Index". Decided (Wes, 2026-09-23): only APIs in the Index; no live crawl and no Discovery. Storing the WTR-51 Vendor-API crawl's candidates is a later decision. Today every Vendor in production has one API, and the list grows as Lookups add APIs.

## Change
**Route:** `GET /api/vendors/{vendor}/apis`, an open GET under #4's gate. `{vendor}` is matched in this order:
1. a Vendor id (`stripe.com`);
2. a domain or URL, reduced with `vendorIdFromDomain` (`https://www.stripe.com/docs` → `stripe.com`);
3. a Vendor name, case-insensitively and exactly (`Stripe`).

Several Vendors matching by name is answered as 300 `{ vendors: [{ id, name }] }`. No match is 404, with a hint that a Lookup finds APIs.

**Response:** `{ vendor, apis: [{ api, currentSpec, alternateSpecs, provenance, verifiedAt }] }`, one entry per API of the Vendor, ordered by API name. Each API's fields come from #3's `currentFromIndex`, so the Specs carry their download URLs and `normalized` status. An API with no Current Spec (only unconfirmed or Community Specs) is listed with `currentSpec: null` and `alternateSpecs: []`. This makes no Lookup, no Discovery and no Verification.

Handler logic in a plain function, as in #5.

## Done when
- Tests with an Index in a temp database, holding a Vendor with two APIs and another Vendor:
  - The list by id, by domain and by URL, and by name in any case.
  - Both APIs, ordered, each with its Current Spec and download URLs.
  - An API with only an unconfirmed Spec has `currentSpec: null`.
  - Two Vendors with the same name get 300.
  - An unknown Vendor gets 404 with the hint.
- `pnpm check` and `pnpm build` green.

---

## 8. swaggerbot: `scripts/formscheck.ts` — the acceptance check against a deployed URL

## Problem
Slice 4 is accepted when the forms and the navigation work on the largest Benchmark Specs without timeouts (PRD). That has to be shown in production, on GitHub, Stripe and Cloudflare, as `scripts/loadcheck.ts` showed Slice 3's latencies. Also, ADR 0004 accepts that a build runs on the server's event loop, as long as it doesn't show in Index latency, and that needs measuring.

## Change
`scripts/formscheck.ts <baseUrl> [--names GitHub,Stripe,Cloudflare] [--json]`, with its logic in `src/benchmark/formscheck.ts`, beside `loadcheck.ts`, reusing `percentile` from `src/benchmark/latency.ts`. For each name:
1. `POST /api/lookup` (Index answer; with `LOADCHECK_KEY` as the bearer when it's set, so a name missing from the Index can be found). It must be Resolved.
2. If the Current Spec's `normalized` is `pending`, poll the outline every 5 s for up to 2 minutes.
3. Download both forms from the Outcome's `downloads` and check them:
   - The Published bytes' sha256 equals the Spec id.
   - The Normalized Form parses as JSON with `openapi` 3.1.x.
   - Record the size and time of each download.
4. `GET` the outline and record its time and size.
5. `GET` 5 operations: the first, the last and 3 evenly spaced between them in the outline's `operations`. Record each one's time and size, and whether it was `truncated`.
6. `GET /api/vendors/{vendorId}/apis`, which must list the API.

It paces its requests under the per-IP limit (60 a minute) and retries a 429 after `retry-after`.

**Report:** per name, the numbers above; overall, outline p90 and operation p90 in ms, and any non-2xx. **Pass** (exit 0) when every step succeeded, outline p90 < 500 ms, operation p90 < 2 s, and every download finished within 60 s. Otherwise it exits 1, naming what failed.

`README.md`: how to run it.

## Done when
- `src/benchmark/formscheck.test.ts`, against a local `node:http` server on port 0 that serves canned responses:
  - The pass/fail rules, including a sha256 mismatch.
  - A 409 then 200 on the outline is waited out.
  - A 429 is retried after `retry-after`.
  - The 5 operations are chosen as described.
- In the PR description, as a manual check for the reviewer: a run against a local `pnpm start` with an Index that holds at least one Resolved API.
- `pnpm check` and `pnpm build` green.

---

## 9. swaggerbot: the Normalized Form drops `allowReserved` from parameters that aren't `query`

## Problem
WTR-104's builder leaves Cloudflare's Normalized Form with `normalizedFindingCount` 3. All three are `allowReserved: true` on a `path` parameter (`object_key` on `GET`, `PUT` and `DELETE /accounts/{account_id}/r2/buckets/{bucket_name}/objects/{object_key}`). OpenAPI 3.0's schema tolerates `allowReserved` on any parameter, but its text says it "only applies to parameters with an `in` value of `query`" and is ignored elsewhere. OpenAPI 3.1's schema rejects it outside `query`. So the finding is a 3.0 → 3.1 difference the upgrader doesn't handle, and it counts as our defect under ADR 0004, not the Vendor's. Decided (Wes, 2026-09-23): strip it.

## Change
In `src/spec-forms/build.ts`, step 5 (`stripSwagger2Leftovers`, or a sibling function called in the same step) also deletes `allowReserved` from every Parameter Object whose `in` isn't `query`:
- path-level `parameters` and operation-level `parameters`, inline;
- `components.parameters` entries.

Parameters that are `$ref`s are left alone (the referenced component is handled in `components.parameters`). `query` parameters keep `allowReserved`. The Published Form and the Validity Issues are unchanged: this touches only the Normalized Form.

Name the rule beside `SWAGGER2_LEFTOVER_KEYS` (e.g. `QUERY_ONLY_PARAMETER_KEYS = ["allowReserved"]`), with a comment citing ADR 0004 and the 3.0/3.1 difference above.

## Done when
- `src/spec-forms/build.test.ts`: a 3.0 fixture with `allowReserved: true` on an inline `path` parameter, on a `header` parameter in `components.parameters`, and on a `query` parameter. The Normalized Form has no `allowReserved` on the first two, keeps it on the `query` one, and has `normalizedFindingCount` 0. The Published Form's Validity Issues are `[]`.
- Manual check in the PR description: `pnpm tsx scripts/forms-bench.ts` on Cloudflare's Spec (`https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json`). Expected: `normalized findings 0` (it was 3), and the same path and operation counts as before (2,254 paths, 3,594 operations).
- `pnpm check` and `pnpm build` green.
