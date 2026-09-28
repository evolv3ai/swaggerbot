# Slice 7 backlog: self-service API keys

**Status: approved by Wes, 2026-09-27** (Unkey, WorkOS, fail closed, auto-approval and one key per user his choices; D2, D5 and D7–D9 as recommended; ADR 0006 accepted). Filed on Linear as in the Order table.

The issues for self-service keys (the PRD's "Later" line, brought forward), written so the weawr factory can build them: each numbered body is filed as-is on Linear (team WTR, labels `ai` + `swaggerbot`). Capitalised terms are from [`CONTEXT.md`](../../CONTEXT.md). Conventions shared by every issue live in `.weawr/instructions.md`. The decision is [ADR 0006](../adr/0006-keys-in-unkey-accounts-in-workos.md).

**Acceptance (proposed):** on production, someone who has never had a key signs in at `swaggerbot.dev/keys` with GitHub, gets a key without anyone approving it, and uses it for a Discovery over HTTP and over MCP; the page then shows one credit used and when it resets. A second key can't be created while the first is live. After Revoke, the key gets a 401. A key issued by hand before Slice 7 still works. With Unkey unreachable (a wrong `UNKEY_ROOT_KEY` on a preview deploy), a keyed Discovery gets a 503 and a keyless Index answer still 200. `uicheck`, `mcpcheck` and `formscheck` still pass.

## Decisions

- **D1. Unkey's API management, not Unkey Deploy.** *Taken (Wes).* The free tier (1,000 keys, 150K valid verifications a month); a keyspace `swaggerbot` in Wes's `evolv3ai` workspace, beside `notra-local`; key prefix `sb` (keys read `sb_…` as today). Hosting stays on Coolify: Deploy's storage is ephemeral and its gateway would 401 keyless Index answers (ADR 0006).
- **D2. What is verified, and what it costs.** *Taken (as recommended).* A key sent on a request the Index answers: `verifyKey` with `credits.cost: 0` (a bad key is still a 401, and nothing is spent). Discovery or `fresh`: cost 1; `USAGE_EXCEEDED` is the 429 it is today, `resetsAt` the next UTC midnight. No key sent: Unkey is never called.
- **D3. Unkey unreachable: fail closed.** *Taken (Wes).* A keyed request gets 503 `{ error, hint: "retry shortly" }` with `retry-after: 30`; an SDK error, a timeout (2 s) and a 5xx all count. Keyless requests are unaffected.
- **D4. Sign-in: WorkOS AuthKit.** *Taken (Wes).* `@workos/authkit-tanstack-react-start` (0.11.x, official) with its hosted sign-in. A key's owner is its Unkey identity, `externalId` = the WorkOS user id; swagger.bot stores no users.
- **D5. Sign-in methods: GitHub and email (Magic Auth).** *Taken (as recommended).* GitHub is what the PRD named and what developers have; email covers the rest. Set in the WorkOS dashboard, not in code.
- **D6. One key per user, approved automatically.** *Taken (Wes).* Creating a key when the user has a live one is refused. Roll = Unkey's reroll (new secret, same key, credits kept); Revoke deletes it, after which the user may create a new one.
- **D7. Quota.** *Taken (as recommended).* A new key gets `credits: { remaining: Q, refill: { interval: "daily", amount: Q } }` with Q = `DAILY_QUOTA` (default 100); refills replace the balance at midnight UTC, as the Index counts today. `scripts/keys.ts create --quota N` sets a larger Q for a key issued by hand.
- **D8. Existing keys: migrate, secrets unchanged.** *Taken (as recommended).* Ask Unkey support for a `migrationId` (operator step O2), then `keys.migrateKeys` each live key with its hash re-encoded (sha256 hex → base64), its owner as `externalId: "operator.<owner>"`, and its quota as credits. If the id doesn't come in time, reissue those keys by hand and tell their owners.
- **D9. Without `UNKEY_ROOT_KEY`, the SQLite key store.** *Taken (as recommended).* Tests, factory worktrees and local dev need no Unkey account, and behave as today. The app logs `keys: unkey` or `keys: local` at start; the deploy check (O1) confirms `unkey` on production. The `/keys` page needs both Unkey and WorkOS configured; without them it says keys are issued by hand and links the `mailto:`.

## Where it stands going in

Keys since Slice 3 (`src/index-store/keys.ts`): SQLite `api_keys` (id, owner, sha256-hex `key_hash`, optional `daily_quota`, `revoked_at`) and `api_key_usage` (per key per UTC day). `findKey(secret)` and `takeQuota(keyId, day, limit)` are synchronous and are called by `handleLookupRequest` (`src/lookup/http.ts`) and the MCP auth (`src/mcp/auth.ts`, `src/mcp/http.ts`). Keys are issued by hand with `scripts/keys.ts` (also built into `.output/cli/keys.mjs` for the image). The site's "Get an API key" button (`src/components/shell/shell.tsx`), Search's "Request a key" (`src/routes/index.tsx`) and `/docs#keys` (`src/components/docs/docs-view.tsx`, `KEY_REQUEST_EMAIL` in `reference.ts`) all lead to the `mailto:`. The CSP is `default-src 'self'` with `connect-src 'self'` and `form-action 'self'` (`src/server/security-headers.ts`). There is no sign-in.

## Order

| # | Linear | Issue | Depends on | Wave |
|---|---|---|---|---|
| 1 | WTR-148 | Keys through Unkey: the async seam, verification costs, fail closed, the admin script | — | 1 |
| 2 | WTR-149 | Sign-in with WorkOS AuthKit | — | 1 |
| 3 | WTR-150 | `/keys`: get, see, roll and revoke your key | 1, 2 | 2 |
| 4 | WTR-151 | Docs, Search and the top bar lead to `/keys`; `keycheck` | 3 | 3 |

#1 and #2 touch different files and build in parallel. Wave 1 (WTR-148, WTR-149) was queued on filing; WTR-150 is queued when both merge, WTR-151 when it has.

## Operator steps (not factory issues)

- **O0. Accounts (Wes).** In Unkey: keyspace `swaggerbot`, and a root key scoped to that API alone (`api.<swaggerbot api id>.create_key`, `.verify_key`, `.read_key`, `.update_key`, `.delete_key`; not `api.*`, which would verify keys from any keyspace, such as `notra-local`), and the API's keyspace id (`ks_…`) as `UNKEY_KEYSPACE_ID`, which the store also limits verification to. In WorkOS: a production environment for swagger.bot with GitHub and Magic Auth on (D5), redirect URI `https://swaggerbot.dev/auth/callback`. Values go into Coolify's env, never the repo.
- **O1. Deploy** after waves 1, 2 and 3, keeping `docs/deploy.md` current. After wave 1 the start log says `keys: unkey`, and `mcpcheck`/`formscheck` still pass with a migrated key.
- **O2. Migrate the hand-issued keys** (D8) before wave 1 is deployed, so no existing key stops working.
- **O3. The acceptance run**, recorded in `docs/slices/slice-7-result.md`.

---

## 1. swaggerbot: keys through Unkey

## Problem
Keys are issued by hand into SQLite, and there is no way for a Caller to get one. [ADR 0006](../adr/0006-keys-in-unkey-accounts-in-workos.md) moves keys into Unkey; this issue moves verification and quota there behind the existing seam, so `/api/lookup` and `/mcp` keep their rules and messages.

## Change
- Add `@unkey/api` (v2). New `src/index-store/unkey-keys.ts` implementing the key seam against Unkey; `src/index-store/keys.ts` keeps the SQLite implementation. Choose at start (D9): Unkey when `UNKEY_ROOT_KEY` and `UNKEY_API_ID` are set, else SQLite; log `keys: unkey` or `keys: local` once.
- Make the seam async and give it the shape both stores can meet: `verify(secret, { cost: 0 | 1 })` → `{ ok: true, key: { id, owner, remaining?, limit?, resetsAt? } } | { ok: false, reason: "unknown" | "revoked" | "quota" | "unavailable" }`. SQLite's cost 1 is today's `takeQuota` upsert; cost 0 is today's `findKey`. Update `handleLookupRequest` and the MCP auth to await it. Map reasons to today's responses: unknown/revoked → 401 as now; quota → 429 as now; unavailable → **503** `{ error, hint }` with `retry-after: 30` (D3). A request with no key never calls `verify`.
- Unkey: `keys.verifyKey({ key, credits: { cost } })` with a 2 s timeout; `valid` → ok; `NOT_FOUND`/`DISABLED`/`EXPIRED` → unknown; `USAGE_EXCEEDED` → quota (`resetsAt` next UTC midnight); anything else, an error or a timeout → unavailable. Never pass Unkey's codes through to a Caller.
- The same seam also exposes what #3 needs: `create(ownerId, quota)` → `{ id, secret }` (prefix `sb`, `externalId` = ownerId, credits per D7), `liveKeyOf(ownerId)` → the key's id, start, created, remaining, limit, resetsAt, or none; `roll(id)` → new secret; `revoke(id)`. SQLite implements them too (owner = ownerId), so #3 is testable without Unkey.
- `scripts/keys.ts` (`create <owner> [--quota N] | list | revoke <id>`) works against whichever store is configured; with Unkey, `create` uses `externalId: "operator.<owner>"`. Add `migrate`: reads the live SQLite keys and calls `keys.migrateKeys` with `UNKEY_MIGRATION_ID`, the hash as base64 of the sha256 bytes (D8); prints how many moved and any it couldn't.
- Env: `UNKEY_ROOT_KEY`, `UNKEY_API_ID`, `UNKEY_KEYSPACE_ID` (verification is limited to it when set), `UNKEY_MIGRATION_ID` (only for `migrate`); already in `.env.example`.

## Tests
- A fake Unkey client (no network) covering: valid at cost 0 spends nothing; cost 1 spends one; `USAGE_EXCEEDED` → 429 with `resetsAt`; unknown → 401; a thrown error and a 2 s timeout → 503 with `retry-after`; a request with no key never calls the client, over `/api/lookup` and `/mcp`.
- The existing key tests pass unchanged against the SQLite store through the new seam.
- `migrate` re-encodes a known hex hash to the expected base64.

## Done when
`pnpm check` and `pnpm build` pass; with no Unkey env the app behaves exactly as before; with a fake client every mapping above holds; the reviewer, given a real test keyspace, verifies a key at cost 0 and 1 and sees credits drop by one.

---

## 2. swaggerbot: sign-in with WorkOS AuthKit

## Problem
A self-service key needs an owner who has proved who they are. swagger.bot has no sign-in. ADR 0006 chooses WorkOS AuthKit (D4, D5); nothing but `/keys` will be behind it.

## Change
- Add `@workos/authkit-tanstack-react-start` (0.11.x). Follow its TanStack Start setup: the middleware in the server entry, `/auth/sign-in` (redirects to AuthKit's hosted page with `returnTo`), `/auth/callback`, `/auth/sign-out`. Sessions are its sealed cookie (`WORKOS_COOKIE_PASSWORD`, at least 32 characters; `HttpOnly`, `Secure`, `SameSite=Lax`).
- A server helper `currentUser()` → `{ id, email, name? } | null` for #3; no users table.
- Sign-in and sign-out are links (GET), so `form-action 'self'` needn't change. If sign-out has to reach WorkOS's logout URL, redirect to it from the server; check the CSP still holds and `uicheck` reports CSP 0.
- The top bar shows "Sign in" when signed out and the user's initial with a menu (Your key, Sign out) when signed in, following `DESIGN.md` (navigation section). Signed-out pages render exactly as today apart from that link.
- Env: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`. Without them the "Sign in" link is not shown and `/auth/*` answers 404. They are already in `.env.example`.

## Tests
- `currentUser()` with a valid sealed session, an expired one and none (mock the package's session reader, no network).
- The top bar renders "Sign in" signed out, the menu signed in, and nothing without WorkOS env.
- `/auth/*` 404s without WorkOS env.

## Done when
`pnpm check`, `pnpm build` and `uicheck` pass (CSP 0 on every route); the reviewer signs in and out against a WorkOS staging environment on a local build.

---

## 3. swaggerbot: `/keys`, get and manage your key

## Problem
With #1 and #2 in, a signed-in person can own a key, but there is no page to get it. D6: one key per user, created on request, no approval.

## Change
- Route `/keys`, a docs page in the shell like the rest (`DESIGN.md`, extend the established world; it gets a sidebar entry under "Get started" and a surface brief).
- **Signed out:** what a key unlocks (Discovery and `fresh`; the Index answers without one), the daily quota, and "Sign in to get a key" (→ `/auth/sign-in?returnTo=/keys`).
- **Signed in, no key:** "Create your key". The server function creates it (`create(user.id, DAILY_QUOTA)`) and the page shows the secret **once**, in a `CodeBlock` with Copy, with "Store it now: it won't be shown again", plus the `curl` and `claude mcp add` lines with the key filled in. Creating is refused (409 → a message) when the user already has a live key.
- **Signed in, with a key:** its start (`sb_abcd…`), when it was created, today's credits left of the limit and when they reset (in the visitor's words: "resets at midnight UTC, in 5 h"), and two actions: **Roll** (confirm; new secret shown once, credits kept) and **Revoke** (confirm; then the page offers Create again).
- Server functions check `currentUser()` on every call and act only on that user's own key (`liveKeyOf(user.id)`); never trust a key id from the client. Rate-limit create and roll per user (5 an hour) and per IP (the existing gate).
- The page never logs or stores a secret; it is only in the one response that creates it.
- Without Unkey or WorkOS configured, `/keys` says keys are issued by hand and links the `mailto:` (D9).

## Tests
- Server functions against the SQLite store (#1's seam) and a fake `currentUser()`: create once, second create refused, roll changes the secret and returns the key's id, which the page uses from then on (Unkey's reroll issues a new id, SQLite keeps it; `roll` returns `{ id, secret }`), revoke then create works, another user's key can't be touched, signed-out calls are 401.
- The rendered views: signed out, no key, the once-only secret view, with a key (credits and reset shown).

## Done when
`pnpm check`, `pnpm build` and `uicheck` pass with `/keys` added to its routes (signed-out view at 390/1280, both themes); the reviewer runs the whole flow against a WorkOS staging environment and a test Unkey keyspace on a local build, and uses the new key for a Discovery.

---

## 4. swaggerbot: the site leads to `/keys`; `keycheck`

## Problem
Every "get a key" path still leads to the `mailto:`, and nothing checks the key flow on a deployment.

## Change
- "Get an API key" in the top bar, Search's "Request a key" and `/docs#keys` point to `/keys`. `/docs#keys` explains getting a key there (sign in with GitHub or email, one key per person, the daily quota, roll and revoke), keeps `hello@evolv3.ai` only for asking for a larger quota, and keeps the `Authorization: Bearer` examples. The 401 hint in `src/lookup/http.ts` and the MCP "a key is needed" text say "Get a key at https://swaggerbot.dev/keys".
- README: the key section describes `/keys`, the Unkey and WorkOS env vars, and `scripts/keys.ts migrate`.
- `scripts/keycheck.ts <baseUrl>` with `KEYCHECK_KEY`: a keyless Index Lookup is 200; the same with the key is 200 and doesn't change the key's credits (read through the admin API when `UNKEY_ROOT_KEY` is set); one Discovery-path Lookup with the key succeeds and spends one; a made-up `sb_` key is 401. Prints PASS/FAIL like `mcpcheck`.

## Tests
- The docs, Search and top bar link `/keys`; no `mailto:` except the larger-quota line.
- `keycheck`'s argument parsing and its PASS/FAIL report against a fake server.

## Done when
`pnpm check` and `pnpm build` pass; `uicheck` passes; `keycheck` passes against a local build with a test keyspace.
