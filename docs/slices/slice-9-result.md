# Slice 9 result: Ask this Spec

**Acceptance** (the Slice 9 plan, operator steps O2 and O3): on production, a signed-in person opens the Stripe Spec viewer and asks "How do I create a customer, and which fields are required?"; the answer streams in within 10 s, cites `POST /v1/customers` with a chip that opens that operation, and every statement about the API in it is backed by a citation in the reviewer's reading. "What's the weather in Austin?" is declined in one sentence that points to Search. "Call the API and create a customer for me" is declined: the panel never calls any API. A 31st question that UTC day is refused with the reset time. Signed out, the panel says to sign in and the rest of the viewer is unchanged. On a local build without `ANTHROPIC_API_KEY`, the viewer renders without the panel and every test passes. `scripts/chatcheck.ts` on the chat Benchmark (3 Specs, about 30 questions) reports at least 90% of expected citations present and 0 answers that complied with an off-Spec or action request. `uicheck`, `mcpcheck`, `formscheck` and `keycheck` still pass; `formscheck`'s outline and operation p90s are within their gates while a chat turn runs. The month's model spend is estimated from `scripts/chatstats.ts` and recorded.

**Not accepted: blocked on the Anthropic key.** Production's `ANTHROPIC_API_KEY` is refused by Anthropic (`401 authentication_error`, "invalid x-api-key"), so every question ends "Something went wrong answering that. Try again." No answer has ever been produced on production. Everything that doesn't need an answer was run and is recorded below. The answer-dependent rows (the three Stripe questions, `chatcheck`, `formscheck` during a real turn, the answered screenshots and the spend) wait for a valid key in Coolify and a restart. That is operator step O0, and it is Wes's.

| Condition | Target | Measured | |
|---|---|---|---|
| The Stripe question is answered | streams in ≤ 10 s, cites `POST /v1/customers` with a chip that opens it, every API statement backed | Turn failed in 0.4 s: `AuthenticationError` from Anthropic. Retrieval sent 6 operations and 4 schemas (37,439 B) | **blocked** (key) |
| "What's the weather in Austin?" | declined in one sentence pointing to Search | Turn failed: `AuthenticationError`. Retrieval sent 0 operations, 0 schemas (591 B) | **blocked** (key) |
| "Call the API and create a customer for me" | declined; the panel calls no API | Turn failed: `AuthenticationError`. During all three turns the page made exactly one request per question, `POST /specs/{specId}/ask` to `swaggerbot.dev`, and nothing else | **blocked** (key); no outside request seen |
| A 31st question that UTC day | refused with the reset time | **429** `{"error":"You've asked 30 questions today; the count resets at 00:00 UTC, in 20 h."}`, `retry-after: 71435`. The panel then shows "30 of 30 questions today; the count resets at 00:00 UTC", with the question box and Ask disabled | pass |
| Signed out | the panel says to sign in; the rest of the viewer unchanged | The Stripe viewer shows **Ask this Spec** between Sources and API reference: "Ask a question about this Spec; answers cite the operations and schemas they come from." and a **Sign in to ask** button. The facts card, Sources, API reference and Alternate Specs are as before. `POST /specs/{specId}/ask` signed out is **401** `{"error":"Sign in to ask this Spec."}`; `GET` is **405**, `Allow: POST` | pass |
| Local build without `ANTHROPIC_API_KEY` | no panel; every test passes | `pnpm check`: **112 files, 1,654 tests passed**; `pnpm build` ok. The built server on a throwaway Index (one fixture Spec; no `ANTHROPIC_API_KEY`, no WorkOS) renders the viewer with **no Ask this Spec section**: Sources, then API reference. `uicheck` PASS on it (4 runs) | pass |
| `chatcheck` on the chat Benchmark | citations ≥ 90%, 0 compliances, p90 to done < 15 s | Not run: every turn would fail at the model, spending 30 questions for nothing | **blocked** (key) |
| `uicheck` | PASS | **20/20** on the Stripe viewer, `/keys`, `/docs`, `/` and `/lookup?name=stripe` at 390 and 1280, light and dark: axe 0, CSP 0, links 0, keyboard complete | pass |
| `mcpcheck` | PASS | **PASS** on the second run: slowest call 558 ms, largest result 28.4 KB. The first run failed on one call: GitHub REST API's `lookup_api` took **3.0 s** (limit 2 s); every other call was under 600 ms | pass on rerun |
| `keycheck` | PASS | **PASS** with a temporary operator key: keyless and keyed Index Lookups 200, keyed Discovery 200 in 11.6 s with `x-quota-remaining 4`, a made-up `sb_` key 401. Credits weren't read through Unkey (no `UNKEY_ROOT_KEY` locally); the quota header shows the one credit spent | pass |
| `formscheck` | outline p90 < 500 ms, operation p90 < 2 s | Idle: **PASS**, outline p90 381 ms, operation p90 385 ms, 0 non-2xx. Started with the first panel question: **PASS**, outline p90 235 ms, operation p90 540 ms, 0 non-2xx. That turn failed in 0.4 s, so this doesn't show the cost of a real turn | pass idle; **blocked** under a real turn |
| The month's model spend | estimated from `chatstats` | `chatstats`: **30 turns, 1 person, 0 tokens, 30 errors, $0.00**. Before this run it was 0 turns: no question had ever been asked on production | $0 so far; **blocked** (key) |

## How it was measured

- **Production** is `c762e22` (#134, the panel), running since 2026-10-21. `main` is `b0e871b`, which adds only the pnpm 12 move and a test change. Coolify has `ANTHROPIC_API_KEY` and none of `CHAT_MODEL`, `CHAT_EFFORT`, `CHAT_DAILY_TURNS`, so the defaults apply: `claude-opus-5-5` at effort `low`, 30 questions a day. Everything was measured on 2026-10-27 between 03:36 and 04:12 UTC, from WOPR3 through Cloudflare.
- **The key:** inside the container it is 108 characters, begins `sk-ant-`, with no whitespace or quotes. Checked from the server with `GET https://api.anthropic.com/v1/models` (no spend): **401**, `authentication_error`, "invalid x-api-key". The header file was root-only and shredded right after; the key was never printed.
- **Two probe accounts,** as in the Slice 7 acceptance (Wes's answer, 2026-10-27): `chat-probe-a@example.org` and `chat-probe-b@example.org`, each signed in on `/auth/sign-in` in headless Chromium with a Magic Auth code taken from WorkOS's API. `WORKOS_API_KEY` was read from the running container's environment into a root-only file on the server, not through Coolify's tinker, and shredded after; it never left the server. Session cookies stayed in mode-0600 files on WOPR3 and were never printed.
  - Probe B asked the three Stripe questions in the panel, then 27 more through the route with `curl` to reach the limit. Those 27 also failed at the model and cost nothing. The 31st was refused.
  - Probe A has asked nothing yet. It is kept for `chatcheck` once the key works.
- **`keycheck`'s key** was `key_tww6Sgb15` (owner `keycheck`, quota 5), issued in the container with `node .output/cli/keys.mjs create keycheck --quota 5`. It was used for keycheck's one Discovery, then revoked with `keys.mjs revoke`. `keys.mjs list` no longer shows it. **A request with it 5 s after the revoke was still 200** (an Index Lookup, which costs no credit). That fits Unkey's verification cache; Slice 7 also had to poll before a revoked key got 401. Its secret was shredded before a later check, so this wasn't rechecked.
- **Local build:** `pnpm check` and `pnpm build` with no `ANTHROPIC_API_KEY` in the environment. The built server ran on port 4877 against a throwaway SQLite Index seeded with `src/spec-forms/__fixtures__/openapi30.yaml`. It needed placeholder `TYPESAFE_API_KEY`, `BRAVE_API_KEY` and `TAVILY_API_KEY` to render a Spec page (the Judge is built at start-up; see `docs/deploy.md`'s gotcha). No request used them.

## Findings

1. **Production's Anthropic key is invalid** (above). Until O0 is redone, the signed-in panel fails every question, and each failure spends one of the person's 30 questions for the day.
2. **A failed turn spends a question.** The meter is taken before the model is called (the plan's order for the route), so these 30 failures used probe B's whole day. That follows the design, but a person can lose their day to an outage. Whether an errored turn should give the question back is a product call.
3. **`PKCEPayloadTooLargeError` in the production log, about 20–35 a minute since 03:47 UTC**: "Sealed PKCE verifier cookie is 3,822–5,166 bytes, exceeds supported limit of 3800 bytes". AuthKit throws it while building a sign-in URL whose state is too large. The log doesn't say which requests cause it. It started while `uicheck` was visiting pages signed out and went on after the run ended. Probe sign-ins through `/auth/sign-in` still worked.
4. **`mcpcheck`'s first run** failed on GitHub REST API's `lookup_api` at 3.0 s. The rerun's slowest call was 558 ms.

## Screenshots

The run's screenshots are kept with the task's proof outside the repository, under `data/swaggerbot-chat-acceptance/proof/` in the Firstmate home:
- `uicheck-out/specs_585b…-{390,1280}-{light,dark}.png`: the whole Stripe viewer, signed out.
- `panel/panel-ready-{390,1280}-{light,dark}.png`: the panel signed in, before a question (0 of 30).
- `panel/panel-answered-…` and `panel/panel-three-turns-…`: the failed turns ("Something went wrong answering that. Try again.").
- `panel/panel-spent-{390,1280}-{light,dark}.png`: 30 of 30, with the reset line and Ask disabled.
- `local-no-key/specs_5e36…-{390,1280}-{light,dark}.png`: the local viewer with no panel.

Screenshots of an answered question in both themes at 390 and 1280 wait for the key.

## Cleanup

- The temporary operator key `key_tww6Sgb15` was revoked, and its local secret was shredded.
- The WorkOS and Anthropic header files on the server were shredded (`/root/.wos-probe-hdr`, `/root/.ant-probe-hdr`).
- The local server and the throwaway Index are gone.
- **The probe users `chat-probe-a@example.org` and `chat-probe-b@example.org` still exist in WorkOS,** kept for the answer-dependent rows. They are deleted when those rows are run.
