# API keys in Unkey, accounts in WorkOS

**Status:** accepted (Wes, 2026-09-27, with the [Slice 7 backlog](../slices/slice-7-backlog.md)).

Anyone can get their own API key at `swaggerbot.dev/keys`. They sign in with **WorkOS AuthKit**; the page creates, shows and revokes their one key in **Unkey**, which then holds every key and its daily quota. swagger.bot keeps no users table and no key hashes: a key's owner is its Unkey identity (`externalId` = the WorkOS user id), and its quota is Unkey credits refilled daily at midnight UTC, the day the Index already counts in. The app still runs where it runs (ADR 0002): only key issuance and verification move out. This is the pattern Notra uses (a keys page behind its own WorkOS sign-in, Unkey behind it).

The key seam stays where Slice 3 put it (`findKey`, `takeQuota`, used by `/api/lookup` and `/mcp`); it becomes async and gets an Unkey implementation:
- **A key sent on a request the Index answers** is verified at credit cost 0, so a bad key is still a 401 (the rule since Slice 3) and costs nothing.
- **Discovery or `fresh`** verifies at cost 1. `USAGE_EXCEEDED` is the 429 it is today, with the reset at the next UTC midnight.
- **When Unkey can't be reached, keyed requests fail closed** with a 503 and a retry hint. Requests with no key never call Unkey, so every Index answer, the outline, operations and schemas keep working through an Unkey outage.

## Considered

- **Keys in our own table, with our own sign-up page** (recommended in the 2026-09-26 research, `.jez/research/unkey-key-issuance-2026-09-26.md`). No outside service in the auth path, but we would build key management, usage display and revocation ourselves, and move later anyway if paid tiers come. Wes chose Unkey.
- **Unkey's customer portal.** Unlaunched ("The Customer Portal has not launched", docs, 2026-09-27), and even then it can't create a first key or revoke one, and it has no sign-in of its own. Revisit when it launches.
- **Unkey Deploy** (hosting behind Unkey's gateway, $5 Starter). Instance storage is ephemeral (`/data` "is created when the instance starts and destroyed when it stops"), so the SQLite Index would not survive a deploy, and the gateway's key policy 401s keyless requests that the Index should answer. No.
- **GitHub sign-in on our own** (the PRD's "Later" line). AuthKit gives GitHub plus email sign-in, sessions and a hosted UI, free for the first 1M monthly active users (workos.com/pricing, 2026-09-27), with an official TanStack Start package.
- **Failing open when Unkey is down.** A Discovery costs money (Jev, web search) and would go unmetered. Wes chose closed.

## Consequences

- Two outside services: Unkey in the path of every keyed request (a round trip of ~150 ms measured from the workstation; Discovery takes seconds anyway), WorkOS only at sign-in. New env vars: `UNKEY_ROOT_KEY`, `UNKEY_API_ID`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`.
- Unkey's free tier: 1,000 keys and 150K valid verifications a month. Past that, Pro starts at $25 a month.
- Existing hand-issued keys move into Unkey with their secrets unchanged (`keys.migrateKeys`; our sha256 hex becomes Unkey's base64), or are reissued.
- Without `UNKEY_ROOT_KEY` the app uses the SQLite key store as today, so tests, factory worktrees and local dev need no account. Production must have it: the app logs which store it uses at start, and the deploy check confirms Unkey.
- The PRD's "not in v1: user accounts" gives way to sign-in for keys only. Nothing else is behind a sign-in.
