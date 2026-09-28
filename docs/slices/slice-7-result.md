# Slice 7 result: self-service API keys

**Acceptance** ([backlog](slice-7-backlog.md)): on production, someone who has never had a key signs in at `swaggerbot.dev/keys` with GitHub, gets a key without anyone approving it, and uses it for a Discovery over HTTP and over MCP; the page then shows one credit used and when it resets. A second key can't be created while the first is live. After Revoke, the key gets a 401. A key issued by hand before Slice 7 still works. With Unkey unreachable, a keyed Discovery gets a 503 and a keyless Index answer is still 200. `uicheck`, `mcpcheck` and `formscheck` still pass.

**For Wes to accept.**
- Every condition is met, with two deviations Wes chose along the way: sign-in is our own page rather than WorkOS's hosted one, and the one hand-issued key was reissued rather than migrated.
- Two conditions differ from the letter:
  - The first sign-in was with **Google**, not GitHub. GitHub is only checked as far as its consent screen.
  - "The page shows one credit used" is confirmed in Unkey, which the page reads. No one has looked at Wes's page itself since.

| Condition | Target | Measured | |
|---|---|---|---|
| A first-time user signs in on `/keys` | with GitHub | **Wes (`hello@evolv3.ai`) signed in with Google**, 00:47 CDT 2026-09-28. Email (Magic Auth) was proven on production with a probe account. `/auth/oauth/github` reaches github.com's consent screen, but no one has completed it | pass, with Google and email |
| Gets a key with no approval | issued at once | "Create your key" issued `key_X9s5OUMRt`, owner = Wes's WorkOS user | pass |
| Uses it for a Discovery over HTTP | 200, one credit | `POST /api/lookup` `{"name":"Val Town","fresh":true}` **200** in 11.4 s. Credits 100 → 99 (Unkey `verifyKey`, cost 0) | pass |
| … and over MCP | 200, one credit | `tools/call lookup_api` `{"name":"Val Town","fresh":true}` **Resolved** in 11.5 s. Credits 99 → 98 | pass |
| The page shows credits used and the reset | shown | Unkey reports 98 of 100. The page reads the same `liveKeyOf` data (unit-tested, and `/keys` renders signed in). Not looked at on Wes's page since | Wes to glance |
| A keyed Index Lookup costs nothing | 200, no credit | Stripe **200** in 0.5 s. Credits unchanged | pass |
| A second key while one is live | refused | Probe account on production: the page's own create call replayed → **409** "You already have a live key: one per person." | pass |
| After Revoke | 401 | Probe account: the key answered 200, was revoked on the page ("Your key is revoked: it no longer works"), then got **401** | pass |
| A made-up key | 401 | **401** on `/api/lookup` and `/mcp` | pass |
| A key issued by hand before Slice 7 | still works | **Reissued, not migrated** (D8: no `migrationId` came; Wes chose to reissue). The only one, the loadcheck key, is `key_6wXqiOlHo` in Unkey, and its Index Lookup is **200** | pass, as reissued |
| Unkey unreachable | keyed 503, keyless 200 | Production's build (`a5d3e78`) run locally on a copy of production's Index, with a wrong `UNKEY_ROOT_KEY`: keyed Discovery **503** `{"error":"API keys can't be checked right now.","hint":"retry shortly"}`, `retry-after: 30`; keyed Index Lookup **503**, same body; keyless Stripe **200** Resolved | pass |
| `uicheck` | PASS | **28/28** on `/`, `/keys`, `/auth/sign-in`, `/docs`, `/lookup?name=stripe`, `/vendors`, `/nope#404` (390 and 1280, light and dark): axe 0, CSP 0 everywhere | pass |
| `mcpcheck` | PASS | **PASS**: slowest call 1.9 s, largest result 28.4 KB (Cloudflare's `tools/list`) | pass |
| `formscheck` | PASS | **PASS**: outline p90 184 ms, operation p90 506 ms, 0 non-2xx | pass |

## How it was measured

- **Production:** `a5d3e78`, deployed 00:11 CDT on 2026-09-28 ([deploy.md](../deploy.md)). Everything was measured between 00:40 and 01:40 CDT, from WOPR3 through Cloudflare. The start log says `keys: unkey`.
- **Wes's key:** the checks used the secret Wes pasted. Credits were read with Unkey's `keys.verifyKey` at cost 0, which spends nothing. The checks used 2 of his 100 credits.
- **The probe account** was `signin-probe@example.org`, in a headless Playwright browser so Wes's own session was untouched:
  - It signed in with a Magic Auth code taken from WorkOS's API (`POST /user_management/magic_auth` returns it).
  - Then it created a key, replayed the page's create request, used the key, revoked it, and polled until the key got 401.
  - Afterwards its WorkOS user was deleted. Its Unkey identity may remain, holding no keys: the scoped root key may not read or delete identities.
  - `@example.com` can't be the probe: WorkOS staging's test organisation claims it for SSO (`sso_required`).
- **Unkey down** was tested locally, not on a preview deploy.
  - The build was `main` `a5d3e78`; the Index was a Litestream restore of production's database (deleted after).
  - The env was production's, except `UNKEY_ROOT_KEY` was a made-up value and WorkOS was off.

## What was built

| Issue | PR | What |
|---|---|---|
| WTR-148 | #109 | Keys through Unkey: the async key seam, cost 0 for Index answers and 1 for Discovery, fail closed with 503 and `retry-after: 30`, `scripts/keys.ts` against either store |
| WTR-149 | #110 | Sign-in with WorkOS AuthKit (`@workos/authkit-tanstack-react-start` 0.11), `currentUser()`, the top bar's account menu |
| WTR-150 | #111 | `/keys`: create, show once, roll and revoke your one key; 5 actions an hour per person |
| WTR-151 | #112 | The site leads to `/keys`; `scripts/keycheck.ts` |
| found in production | #113 | Unkey refuses `:` in an `externalId`: operator keys are `operator.<owner>` |
| found in production | #114 | AuthKit's callback redirected to `http://` behind the proxy: the request moves to `WORKOS_REDIRECT_URI`'s origin |
| found in production | #115 | The callback logs WorkOS's error when there is no code |
| found in production | #116 | **Our own sign-in page** (below) |

## The sign-in page (ADR 0006 amended, D4 changed; Wes, 2026-09-28)

- **WorkOS's hosted page never rendered.** Its sign-in layout 307'd every request, even a bare `GET /` or `/?error=foo`, to our callback without a code, for either application and with or without cookies. Nothing in the dashboard changed it.
- **Wes chose to host the page ourselves** and skip WorkOS support.
  - `/auth/sign-in` now offers GitHub and Google, which go by way of WorkOS through `/auth/oauth/:provider`, and an emailed 6-digit code (Magic Auth).
  - The code sign-in is sealed into the package's own session cookie, so the middleware, `/keys` and sign-out didn't change.
  - Our limits: 5 codes an hour per address, 20 per IP, and 10 tries per address in 10 minutes. WorkOS's reason for any refusal is logged.
- **The WorkOS dashboard needed:**
  - Magic Auth switched on (it had answered `authentication_method_not_allowed`).
  - Production moved to the environment's default application (`client_01M3JB1G…`).

## Follow-ups

- **Roll Wes's key.** Its secret was pasted into a chat. Roll keeps the credits.
- **Complete one GitHub sign-in.** It's the method the PRD named, and it's only been checked as far as github.com's consent screen.
- **Delete the old WorkOS application `swagger_DELETE`** (`client_01M3JQ7Y…`), now that sign-in works on the default one.
- **WorkOS is still the staging environment**, on purpose, because production costs money. Staging has WorkOS's test organisation, and a real visitor at `@example.com` would be refused. Move to a production environment before launch.
- **Review nits left from WTR-150/151:**
  - `keycheck` without a root key skips the credit checks silently.
  - `/docs` hardcodes the quota as "100" (three places in `docs-view.tsx`) instead of reading `DAILY_QUOTA`.
  - The client's `setKey` after a roll has no test.
- The probe's Unkey identity may linger (no keys). It's harmless, but it's visible in Unkey's dashboard.
