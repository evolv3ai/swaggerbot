# Unkey for "users get an API key": 2026-09-26

Researched 2026-09-26 from Unkey's live docs, changelog, roadmap, pricing, GitHub and npm. Every claim has a URL next to it. Unkey's doc pages carry no dates, so for those the date is when I read them (today). Changelog entries are dated. Context: backlog D9 (`docs/slices/slice-6-backlog.md`) deferred Unkey on 2026-09-25 because it would put an outside service in the auth path and its customer portal was unreleased. The auth seam is `findKey` / `takeQuota` in `src/index-store/keys.ts`, called from `authenticate` / `answerLookup` in `src/lookup/http.ts`. Our keys are `sb_` plus 32 random bytes in base64url, stored as a sha256 **hex** hash with an `owner` string and a nullable `dailyQuota`. Usage is counted per UTC day in `api_key_usage`.

Unkey has changed shape this year. It now calls itself "the developer platform for modern APIs": Deploy, a gateway and hosting, with keys as one feature ([introduction](https://unkey.com/docs/introduction), [changelog 2026-04-24: Deploy public beta, seed round](https://www.unkey.com/changelog)). In June 2026 "APIs" were renamed "Keyspaces" ([changelog 2026-06-05](https://unkey.com/changelog/2026-06-05)). The key-management API (v2) is still there and still usable on its own ("Use standalone or attached to a deployment", [introduction](https://unkey.com/docs/introduction)).

## 1. The Customer Portal: not released

- **Status: unreleased.** The portal quickstart opens with: "The Customer Portal has not launched. This page is unlisted, documents an unreleased API, and is subject to change without notice." ([quickstart/portal](https://unkey.com/docs/quickstart/portal.md)). The CLI pages for `create-portal`, `update-portal` and `get-portal` all say "Unreleased and subject to change without notice" ([create-portal](https://unkey.com/docs/cli/portal/create-portal.md)). The error docs say it is "in early access, and during that period portals are created by the Unkey team on request" ([portal_not_found](https://unkey.com/docs/errors/unkey/data/portal_not_found.md)). The public roadmap lists "Customer facing Portal" as **In Progress** ([feedback.unkey.com/roadmap](https://feedback.unkey.com/roadmap)). It is still being built: PR #7610 "revoke an end user's portal sessions" was opened 2026-09-25 as WIP, and PR #7522 "remove session level preview from the portal" merged 2026-09-23 ([PRs](https://github.com/unkeyed/unkey/pulls?q=portal)).
  - *The marketing homepage disagrees with the docs.* It advertises "A fully hosted developer portal… Keys and usage, self-serve" as if it were live ([unkey.com](https://www.unkey.com/)). Trust the docs and the roadmap.
- **What it does:** very little so far. It has one page, the keys page. The only scopes are `keys:read` (list your own keys), `keys:reroll` (roll a key you own) and `analytics:read` (your own usage) ([quickstart/portal § Scopes](https://unkey.com/docs/quickstart/portal.md)). **End users cannot create their first key in it, and cannot revoke or delete one.** So it would not replace the "request a key" link by itself: something still has to create the key.
- **How users sign in:** they don't sign in to Unkey. Our backend has to authenticate them first. It then calls `POST /v2/portal.createSession` with our root key and the user's `externalId`, and redirects them to `https://portal.unkey.com/?code=pst_…`. The code is single-use and lasts 15 minutes; it is exchanged for a 24-hour access token held in an httpOnly cookie ([quickstart/portal § How it works, Session lifecycle](https://unkey.com/docs/quickstart/portal.md)). **So we would still need our own user sign-in (e.g. a magic link) in front of it.**
- **Hosting and branding:** Unkey hosts it at `portal.unkey.com`. Branding is a logo URL, a six-digit hex primary colour and a display name ([quickstart/portal § Branding](https://unkey.com/docs/quickstart/portal.md), [create-portal flags](https://unkey.com/docs/cli/portal/create-portal.md)). I found no custom-domain option for the portal in any of its docs (Unkey's custom domains are for Deploy apps).
- **Cost:** not published. Neither the pricing page nor the billing docs mention the portal ([pricing](https://www.unkey.com/pricing), [API plan billing](https://unkey.com/docs/platform/workspaces/billing/api)). The only way in today is to ask Unkey.

## 2. The smallest "issue a key" flow on the v2 API

There is no usable portal, so the job needs a small sign-up page of our own. Unkey can't do email verification for us, so **the sign-up and verification part is ours whichever way we go**. The flow:

1. `/keys` page: the user enters an email; we send a magic link (e.g. Resend, whose free plan is "100 emails a day, 3 domains", [resend.com/pricing](https://resend.com/pricing)). Clicking the link proves the address.
2. On a verified click, our server (holding the root key) calls `keys.createKey` ([create-api-key](https://unkey.com/docs/api-reference/keys/create-api-key)) with:
   - `apiId`: the keyspace id
   - `prefix: "sb"`: 1–16 characters ([cli create-key](https://unkey.com/docs/cli/keys/create-key.md))
   - `externalId`: the verified email or our user id. It is "returned during verification"; identities can hold shared limits ([identities](https://unkey.com/docs/platform/identities/overview.md))
   - `credits: { remaining: 100, refill: { interval: "daily", amount: 100 } }` ([refill](https://unkey.com/docs/platform/apis/features/refill.md))
   - optional `ratelimits: [{ name, limit, duration, autoApply: true }]` ([key ratelimits](https://unkey.com/docs/platform/apis/features/ratelimiting/overview.md))
   - optional `byteLength`: 16 by default, 16–255 allowed ([cli create-key](https://unkey.com/docs/cli/keys/create-key.md))
3. Show the returned `key` once. "The key is returned only once" ([create-api-key](https://unkey.com/docs/api-reference/keys/create-api-key)). (Unkey's July dashboard feature of one-time share links is for keys made in the dashboard, not ones made through the API: [changelog 2026-07-10](https://unkey.com/changelog/2026-07-10).)
4. Revoke and roll: `keys.deleteKey` or `keys.updateKey {enabled:false}`, and `keys.rerollKey` (with an overlap period) ([delete](https://unkey.com/docs/api-reference/keys/delete-api-keys), [reroll](https://unkey.com/docs/api-reference/keys/reroll-key)). They are either behind our own "manage my key" page (signed in by magic link) or operator-only.

**What we need to provide:** an Unkey workspace, a keyspace, and a root key with only `api.<id>.create_key` / `verify_key` / `delete_key` / `update_key` (the permission names are on each endpoint page). That key goes in Coolify's env. We also need a sender domain for email, a small `signups` table (email, verified-at, keyId), and a per-email/per-IP limit on sign-up so it can't be farmed. That anti-abuse limit is ours to build either way.

## 3. Verification: local or Unkey?

- **Unkey's model is to verify every request with it.** "Use this endpoint on every incoming request to your protected resources" ([verify-api-key](https://unkey.com/docs/api-reference/keys/verify-api-key.md)). In v2, `verifyKey` itself needs a root key with `verify_key` permission (same page). It answers HTTP 200 whatever the outcome; you check `valid` and `code` (`USAGE_EXCEEDED`, `RATE_LIMITED`, `DISABLED`…).
- **Latency:** Unkey publishes no latency figure in the docs I read. From this workstation (WSL, not the Coolify box), five unauthenticated `POST api.unkey.com/v2/keys.verifyKey` calls took **~145–170 ms to first byte** (about 50–80 ms to connect, then a 400 because I sent no auth). A Coolify box in a US data centre would probably do better, but it is still a network round trip on each verified request. Measure from the box before deciding.
- **Caching:** you can't cache the credit spend: credits are decremented at Unkey on each verification ("Each verification decrements the remaining count", [remaining](https://unkey.com/docs/platform/apis/features/remaining.md)). The docs describe credits as "global consistency" ([cli create-key](https://unkey.com/docs/cli/keys/create-key.md)). Ratelimits, by contrast, are "eventually consistent… not a financial ledger" ([how-it-works](https://unkey.com/docs/platform/ratelimiting/how-it-works.md)). `@unkey/cache` exists, but it is a generic SWR cache, not a verify cache ([@unkey/cache](https://unkey.com/docs/libraries/ts/cache/overview.md)).
- **When Unkey is down:** it is up to us. Unkey's own cookbook shows both options: "Option 1: Fail closed (more secure) → 503" / "Option 2: Fail open" ([express-middleware](https://unkey.com/docs/cookbook/express-middleware.md)). The TS SDK has configurable retries/backoff and `serverURL` ([sdks/api/ts README](https://github.com/unkeyed/sdks/tree/main/api/ts)). Failing open would mean unmetered Discovery for the length of the outage.
- **Softening it for our case:** keyless callers already get Index answers, and only Discovery / `fresh` need the key. If we call Unkey **only on the Discovery path**, Index traffic never touches Unkey. Discovery already does outbound fetches, so its latency budget is large. One design point: send `credits.cost: 0` or `1` on the one `verifyKey` call, depending on whether the Index answered ([remaining § Custom cost](https://unkey.com/docs/platform/apis/features/remaining.md)). Or skip verifying bearer keys on Index answers altogether. That second option changes today's behaviour, where a bad key gets a 401 even on an Index answer (`authenticate` in `src/lookup/http.ts`).
- **"Issuance in Unkey, verification local": not a supported pattern.** Unkey has no outbound webhooks for key events: "Webhooks" is **Planned** on the roadmap ([roadmap](https://feedback.unkey.com/roadmap)), and the docs mention webhooks only as audit-log event types ([audit log](https://unkey.com/docs/audit-log/introduction)). There is also no endpoint that exports key hashes. It can be improvised: our server sees the plaintext once in the `createKey` response, so it can store `sha256hex(key)` locally. But then Unkey is only generating a random string. Any roll done in Unkey (dashboard or portal) would leave our table stale, and Unkey's credits and ratelimits would go unused. **That hybrid adds a vendor and gains nothing.**

## 4. Can credits/refill express our quota?

**Yes, exactly.** A key with `credits.remaining = N` and `refill: { interval: "daily", amount: N }` matches our quota: "Daily refills trigger at midnight UTC". A refill "replaces the current credit balance, it doesn't add to it", so unused credits don't carry over, which matches our per-day counting ([refill](https://unkey.com/docs/platform/apis/features/refill.md)). Exhaustion returns `code: USAGE_EXCEEDED`, which we map to our 429 + `retry-after`; `credits` in the response gives `x-quota-remaining` ([remaining](https://unkey.com/docs/platform/apis/features/remaining.md)). A per-key `dailyQuota` override becomes that key's own `amount`, and `DAILY_QUOTA` becomes the value we create keys with. One gap: changing `DAILY_QUOTA` later means updating every key's refill (`keys.updateCredits`, [update-key-credits](https://unkey.com/docs/api-reference/keys/update-key-credits.md)). Today a key with a null quota just follows the env var.

**Per-key ratelimits: yes.** Keys can carry several named limits (duration ≥ 1 s; `autoApply` or named per call), and limits can be shared across one identity's keys ([key ratelimits](https://unkey.com/docs/platform/apis/features/ratelimiting/overview.md), [identity ratelimits](https://unkey.com/docs/platform/identities/ratelimits.md)). They are sliding-window and eventually consistent ([how-it-works](https://unkey.com/docs/platform/ratelimiting/how-it-works.md)). Our per-IP limit for keyless callers would stay local.

## 5. Self-hosting, pricing, SDK, migration

- **Self-hosting: possible under AGPLv3, but not documented or supported.** The README says the repo is "source-available so you can read the code, fork it under the terms of the AGPL, and self-host", and that external PRs are paused ([README](https://github.com/unkeyed/unkey#readme), [LICENSE](https://github.com/unkeyed/unkey/blob/main/LICENSE)). The self-host docs issue was closed in 2025-07 without an end-to-end guide ("We currently don't have full documentation on how to host Unkey", [#1964](https://github.com/unkeyed/unkey/issues/1964)). The docs index has no self-hosting page ([llms.txt](https://unkey.com/docs/llms.txt)); the only local piece is a Docker Compose "Local gateway" for development ([local gateway](https://unkey.com/docs/platform/gateway/local-development.md)). The roadmap offers "Bring your own cloud" and "VPC / Private Link" as **Planned** ([roadmap](https://feedback.unkey.com/roadmap)). Given its current Deploy stack, self-hosting it is not realistic on one Coolify box.
- **Pricing (API management; the pages are undated):**
  - Free: $0 for **150,000 requests/month**, 1k API keys, 1-day logs, 3-day audit logs, one user ([pricing](https://www.unkey.com/pricing), [billing/api](https://unkey.com/docs/platform/workspaces/billing/api), [quotas](https://unkey.com/docs/platform/workspaces/quotas)).
  - Pro: from $25/mo for 250k up to $1,000/mo for 100M.
  - "A request is a valid key verification or a rate limit check. Failed verifications… don't count. Management API calls, such as creating a key, don't count either." Going over the quota is not blocked: "Requests are never blocked… Unkey emails the workspace admins" ([billing/api](https://unkey.com/docs/platform/workspaces/billing/api)).
  - At ≤100 Discovery a key a day, the free tier covers about 50 fully used keys (150k ÷ 30 ÷ 100), or many more lightly used ones.
- **TypeScript SDK:** `@unkey/api` **2.5.2**, published 2026-09-23 (`npm view @unkey/api`), source in [unkeyed/sdks/api/ts](https://github.com/unkeyed/sdks/tree/main/api/ts). Zod is a peer dependency ([libraries/ts/api](https://unkey.com/docs/libraries/ts/api.md)).
- **Migrating existing keys: supported, but it goes through support.**
  - `keys.migrateKeys` imports pre-hashed keys with `externalId`, `credits`, `ratelimits` and so on. You first email support@unkey.com for a `migrationId`, naming the hash algorithm ([migrations/keys](https://unkey.com/docs/platform/apis/migrations/keys.md), [migrate-api-keys](https://unkey.com/docs/api-reference/keys/migrate-api-keys.md)).
  - Unkey's native format is "SHA-256 of the full key, base64 encoded". Ours is the same SHA-256 in hex, so converting is re-encoding hex to base64 and nothing more. Our issued `sb_…` secrets keep working. Each migrated key returns a `keyId` to keep.

## 6. Alternatives, one line each

- **Build it ourselves on the existing keys table:** a `/keys` page, a Resend magic link, then call our own `createKey(owner=email)` and show the secret once, plus "revoke/roll my key" behind the same magic link. This is about the same amount of work as the Unkey flow in §2, minus the adapter, the vendor and the outage question. Verification stays local and synchronous.
- **Zuplo:**
  - Free plan: 100K requests/month. "Developer Portal — Included. Hosted on your domain — included free on every plan" ([zuplo.com/pricing](https://zuplo.com/pricing)).
  - The portal has real self-serve: consumers "create, view, and delete their own keys" ([api-key-administration](https://zuplo.com/docs/articles/api-key-administration)). There is also a Developer API for issuance ([api-key-api](https://zuplo.com/docs/articles/api-key-api)).
  - But keys are checked by Zuplo's gateway policy, with a 60 s edge cache ([api-key-management](https://zuplo.com/docs/articles/api-key-management)). That means putting Zuplo in front of the API, which is exactly "hosting the platform". I found no documented standalone verify call.
- **Better Auth's API-key plugin** (`@better-auth/api-key`): stores keys in our own DB, with per-key rate limits and remaining/refill ([better-auth docs](https://www.better-auth.com/docs/plugins/api-key)). Its refill is interval-based in milliseconds, not "at midnight UTC", and it brings a whole auth framework for one table. Only worth it if swagger.bot will get user accounts anyway.

## Recommendation

For the job "let users get a key", Unkey today doesn't remove the part we're missing:
- its portal is unreleased;
- it only lists and rolls keys;
- it can't create a user's first key;
- it can't verify an email;
- it isn't on our domain.

Using Unkey would still mean building the sign-up page and magic link. On top of that it adds an adapter that makes `findKey` async, a root key in env, a support-mediated migration and an outside dependency on every Discovery call. What Unkey does well is keys, metering and a dashboard. We already have all three locally and they are tested: `takeQuota` is atomic, and `scripts/keys.ts` issues keys.

**Recommendation:** build the self-service page on our own keys table:
- magic link via Resend;
- one live key per verified email;
- show the key once, with "roll" and "revoke" behind the same link;
- a per-IP/per-email sign-up limit.

Keep Unkey as the documented upgrade path, because it maps cleanly: daily credits, a hex→base64 hash migration, and verification on the Discovery path only. Revisit it when the Customer Portal is generally available with create/revoke and published pricing, or when we want metering analytics we don't want to build.

If the owner does want Unkey now anyway:
- call it only on the Discovery path;
- fail closed with a 503 and `retry-after`;
- create keys with `prefix: "sb"` and daily credits;
- migrate the existing keys through support rather than re-issuing them.

## Decisions for the owner

1. **Where keys live:** stay local (build the sign-up page on `api_keys`), or move issuance *and* verification to Unkey. Unkey for issuance alone, with local verification, isn't a real option (§3).
2. **How a user proves who they are:** an email magic link (needs a sender domain on Resend or similar), or keep the hand-issued `mailto:` a while longer. Plus how many keys per email, and whether sign-ups are auto-approved or queued for you.
3. **If Unkey:** what happens when it's down. Fail closed (a 503 on Discovery) or fail open (unmetered Discovery during the outage). And does a bad key sent with an Index-answerable request still get a 401 (one Unkey call per keyed request), or is it ignored (Unkey only on Discovery)?
4. **If Unkey:** do you want to wait for the Customer Portal (and ask Unkey for early access and its price), or go now with our own page on the v2 API?
