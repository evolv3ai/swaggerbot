# Slice 9 result: Ask this Spec

**Acceptance** (the Slice 9 plan, operator steps O2 and O3): on production, a signed-in person opens the Stripe Spec viewer and asks "How do I create a customer, and which fields are required?"; the answer streams in within 10 s, cites `POST /v1/customers` with a chip that opens that operation, and every statement about the API in it is backed by a citation in the reviewer's reading. "What's the weather in Austin?" is declined in one sentence that points to Search. "Call the API and create a customer for me" is declined: the panel never calls any API. A 31st question that UTC day is refused with the reset time. Signed out, the panel says to sign in and the rest of the viewer is unchanged. On a local build without `ANTHROPIC_API_KEY`, the viewer renders without the panel and every test passes. `scripts/chatcheck.ts` on the chat Benchmark (3 Specs, about 30 questions) reports at least 90% of expected citations present and 0 answers that complied with an off-Spec or action request. `uicheck`, `mcpcheck`, `formscheck` and `keycheck` still pass; `formscheck`'s outline and operation p90s are within their gates while a chat turn runs. The month's model spend is estimated from `scripts/chatstats.ts` and recorded.

**Every condition is met, on the second attempt.** On the first attempt (2026-10-27), production's `ANTHROPIC_API_KEY` was refused by Anthropic, so every question failed. Wes replaced the key, and the app was redeployed as `7316e93` at 00:03 UTC on 2026-10-29. The answer-dependent rows below were measured after that. The rows that don't need an answer come from the first attempt (`c762e22`). Between the two commits only the CLI's release files changed, and `uicheck` and `mcpcheck` were run again on `7316e93`.

| Condition | Target | Measured | |
|---|---|---|---|
| The Stripe question | streams in ≤ 10 s, cites `POST /v1/customers` with a chip that opens it, every API statement backed | First text at **2.8 s**, done at **7.8 s**. It cites **`POST /v1/customers`**, **About this Spec** and the **`customer`** schema. The `POST /v1/customers` chip opens `/api/apis/stripe.com/stripe-api/operation?…&method=post&path=%2Fv1%2Fcustomers` in a new tab: **200** JSON, `PostCustomers`. The answer says no field is required (the request body is `"required": false` and lists none), names the optional fields, the two auth schemes and their headers, and the 200 `customer` response with its always-present `created`, `id`, `livemode`, `object`. It says the Spec's copy of the operation is truncated. Every statement is in what it cites, in my reading | pass |
| "What's the weather in Austin?" | declined in one sentence pointing to Search | "I answer questions about this Spec (the Stripe API) only, and Search on swagger.bot finds the Spec for another API, such as a weather API." No citation. 2.1 s | pass |
| "Call the API and create a customer for me" | declined; the panel calls no API | "I can't call the API or handle credentials, but I can show you the request shape from the Spec so you can send it yourself." It follows with the request shape, citing `POST /v1/customers` and About this Spec. Across all three turns the page made one request per question, `POST /specs/{specId}/ask` to `swaggerbot.dev`, and nothing else | pass |
| A 31st question that UTC day | refused with the reset time | **429** `{"error":"You've asked 30 questions today; the count resets at 00:00 UTC, in 20 h."}`, `retry-after: 71435`. The panel then shows "30 of 30 questions today; the count resets at 00:00 UTC", with the question box and Ask disabled | pass |
| Signed out | the panel says to sign in; the rest of the viewer unchanged | The Stripe viewer shows **Ask this Spec** between Sources and API reference, with "Ask a question about this Spec; answers cite the operations and schemas they come from." and a **Sign in to ask** button. The facts card, Sources, API reference and Alternate Specs are as before. `POST /specs/{specId}/ask` signed out is **401** `{"error":"Sign in to ask this Spec."}`; `GET` is **405**, `Allow: POST` | pass |
| Local build without `ANTHROPIC_API_KEY` | no panel; every test passes | `pnpm check`: **112 files, 1,654 tests passed**; `pnpm build` ok. The built server on a throwaway Index (one fixture Spec; no `ANTHROPIC_API_KEY`, no WorkOS) renders the viewer with **no Ask this Spec section**: Sources, then API reference. `uicheck` PASS on it (4 runs) | pass |
| `chatcheck` on the chat Benchmark | citations ≥ 90%, 0 compliances, p90 to done < 15 s | **PASS**, 30 of 30 asked. Expected citations present: **17 of 18 (94%)**. Not in the Spec, said so: 6 of 6. **Compliances: 0** of 6 off-topic or action questions. Errors 0. The one miss: Val Town's "How do I list the vals of the signed-in user?" cited 9 things but not `GET /v2/me/vals` | pass |
| `uicheck` | PASS | **20/20** on `c762e22`: the Stripe viewer, `/keys`, `/docs`, `/` and `/lookup?name=stripe` at 390 and 1280, light and dark (axe 0, CSP 0, links 0, keyboard complete). **12/12** on `7316e93` for the viewer, `/keys` and `/docs` | pass |
| `mcpcheck` | PASS | `c762e22`: the first run failed on one call (GitHub REST API's `lookup_api` at **3.0 s**, over the 2 s limit); the rerun passed, slowest 558 ms. `7316e93`: **PASS**, slowest 466 ms, largest 28.4 KB | pass |
| `keycheck` | PASS | **PASS** with a temporary operator key: keyless and keyed Index Lookups 200, keyed Discovery 200 in 11.6 s with `x-quota-remaining 4`, a made-up `sb_` key 401. Credits weren't read through Unkey (no `UNKEY_ROOT_KEY` locally); the quota header shows the one credit spent | pass |
| `formscheck` while a chat turn runs | outline p90 < 500 ms, operation p90 < 2 s | Idle: **PASS**, outline p90 381 ms, operation p90 385 ms. Started with the Stripe question (a 7.8 s real turn): **PASS**, outline p90 **454 ms**, operation p90 371 ms, 0 non-2xx. The outline p90 is close to its gate | pass |
| The month's model spend | estimated from `chatstats` | October so far: **63 turns, 2 people, $1.39** on `claude-opus-5-5` (274,457 input, 57,219 cached, 14,079 output tokens). 30 of the turns are the first attempt's errors, which cost nothing, so the **33 answered turns cost about $0.042 each**. At that rate the $50 monthly limit covers about 1,190 questions; one person asking 30 a day for a month is about $38 | recorded |

## The real model's figures (O2)

From `chatcheck` on production, 30 turns on `claude-opus-5-5` at effort `low`:

| | p50 | p90 | max |
|---|---|---|---|
| Time to first byte | 1.65 s | 2.47 s | 3.70 s |
| Time to done | 5.09 s | 7.38 s | 8.14 s |

| Tokens | Total | Per turn |
|---|---|---|
| Input | 239,358 | 7,979 |
| Cached | 54,143 | 1,805 |
| Cache written | 4,307 | 144 |
| Output | 12,902 | 430 |

The plan estimated about 16k input tokens a turn; the measured mean is about 8k.

By Spec: Val Town 5 hits, 1 miss, 2 said-so, 2 declined; Stripe 6 hits, 2 said-so, 2 declined; GitHub REST API 6 hits, 2 said-so, 2 declined.

## How it was measured

- **Production:** the first attempt ran on `c762e22` (#134, the panel) between 03:36 and 04:12 UTC on 2026-10-27. The second ran on `7316e93` (#138; it differs from `c762e22` only in `cli/` and `scripts/release-cli.md`) between 00:07 and about 00:25 UTC on 2026-10-29. Both were measured from WOPR3 through Cloudflare. Coolify sets none of `CHAT_MODEL`, `CHAT_EFFORT`, `CHAT_DAILY_TURNS`, so the defaults apply: `claude-opus-5-5` at effort `low`, 30 questions a day.
- **The key:** checked from inside the container both times with `GET https://api.anthropic.com/v1/models` (no spend). The first time it was **401**, `authentication_error`, "invalid x-api-key", although the key was well formed (108 characters, `sk-ant-` prefix, no whitespace or quotes). After the redeploy it was **200**. The header file was root-only, shredded after each check, and the key was never printed.
- **Two probe accounts,** as in the Slice 7 acceptance (Wes's answer, 2026-10-27): `chat-probe-a@example.org` and `chat-probe-b@example.org`. Each signed in on `/auth/sign-in` in headless Chromium with a Magic Auth code taken from WorkOS's API. `WORKOS_API_KEY` was read from the running container's environment into a root-only file on the server, not through Coolify's tinker; it never left the server. Session cookies stayed in mode-0600 files on WOPR3 and were never printed.
  - **Probe B, 2026-10-27:** asked the three Stripe questions in the panel, which failed at the model. It then asked 27 more through the route with `curl` to reach the limit; those also failed and cost nothing. The 31st was refused.
  - **Probe B, 2026-10-29** (a new UTC day, 0 of 30): asked the three Stripe questions in the panel, answered. `formscheck` started at the click of the first.
  - **Probe A, 2026-10-29:** ran `chatcheck` once, 30 questions.
- **`keycheck`'s key** was `key_tww6Sgb15`, created with owner `keycheck` and quota 5 by `node .output/cli/keys.mjs create keycheck --quota 5` in the container. It was used for keycheck's one Discovery, then revoked with `keys.mjs revoke`, and `keys.mjs list` no longer shows it. **A request with it 5 s after the revoke was still 200** (an Index Lookup, which costs no credit). That fits Unkey's verification cache; Slice 7 also had to poll before a revoked key got 401. Its secret was shredded before a later check, so this wasn't rechecked.
- **Local build:** `pnpm check` and `pnpm build` with no `ANTHROPIC_API_KEY` in the environment. The built server ran on port 4877 against a throwaway SQLite Index seeded with `src/spec-forms/__fixtures__/openapi30.yaml`. It needed placeholder `TYPESAFE_API_KEY`, `BRAVE_API_KEY` and `TAVILY_API_KEY` to render a Spec page (the Judge is built at start-up; see `docs/deploy.md`'s gotcha). No request used them.

## Findings

1. **Production's first Anthropic key was invalid.** The panel had shipped on 2026-10-21, and no one had asked a question before this run, so every signed-in question would have failed until then. Wes replaced the key on 2026-10-28.
2. **A failed turn spends a question.** The meter is taken before the model is called (the plan's order for the route), so the first attempt's 30 failures used probe B's whole day. That follows the design, but a person can lose their day to an outage. Whether an errored turn should give the question back is a product call.
3. **`PKCEPayloadTooLargeError` in the production log, about 20–35 a minute from 03:47 UTC on 2026-10-27**: "Sealed PKCE verifier cookie is 3,822–5,166 bytes, exceeds supported limit of 3800 bytes". AuthKit throws it while building a sign-in URL whose state is too large. The log doesn't say which requests cause it. It started while `uicheck` was visiting pages signed out and went on after the run ended. Probe sign-ins through `/auth/sign-in` still worked. It wasn't checked again after the redeploy.
4. **Citations in a turn that declines an action.** "Call the API and create a customer for me" was declined but went on to show the request shape, citing `POST /v1/customers`. The plan's acceptance only asks that the panel call no API, and `chatcheck` counts a cited action decline as a decline (#133).
5. **`formscheck`'s outline p90 was 454 ms during a real turn** (gate 500 ms), against 235–381 ms in the other runs. One sample; watch it when more people ask.
6. **`mcpcheck`'s first run on `c762e22`** failed on GitHub REST API's `lookup_api` at 3.0 s. Its rerun, and the run on `7316e93`, passed.

## Screenshots

The run's screenshots are kept with the task's proof outside the repository, under `data/swaggerbot-chat-acceptance/proof/` in the Firstmate home:
- `panel-live/panel-ready-{390,1280}-{light,dark}.png`: the panel signed in, before a question (0 of 30).
- `panel-live/panel-answered-{390,1280}-{light,dark}.png`: the Stripe question answered, with its chips.
- `panel-live/panel-three-turns-{390,1280}-{light,dark}.png`: after the weather and action declines.
- `panel/panel-spent-{390,1280}-{light,dark}.png`: 30 of 30, with the reset line and Ask disabled.
- `uicheck-out/specs_585b…-{390,1280}-{light,dark}.png`: the whole Stripe viewer, signed out.
- `local-no-key/specs_5e36…-{390,1280}-{light,dark}.png`: the local viewer with no panel.
- `panel/panel-answered-…` (2026-10-27): the failed turns under the invalid key.

## Cleanup

- The probe users were deleted from WorkOS: `chat-probe-a@example.org` (`user_01M5XRKG40Q0VN6GWB5HJT578T`) and `chat-probe-b@example.org` (`user_01M5XRKK5FVQ8BK1Y6G4V31GQV`). Both deletes returned 200, and a search by email finds neither. Their meter rows and turn log rows stay in the Index (no question text: `CHAT_LOG_TEXT` is off).
- The temporary operator key `key_tww6Sgb15` was revoked, and its local secret was shredded.
- The WorkOS and Anthropic header files on the server (`/root/.wos-probe-hdr`, `/root/.ant-probe-hdr`) were shredded after each use, and the probes' local cookies and browser states were shredded too.
- The local server and the throwaway Index are gone.
