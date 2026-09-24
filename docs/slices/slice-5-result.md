# Slice 5 result: MCP server

**Acceptance** ([backlog](slice-5-backlog.md), D7): Claude Code, given only the swagger.bot MCP server and Bash to call the API (no web search or fetch), makes three successful calls to three different Val Town operations that need no key. It runs once on the default model and once on Haiku, as the canary for unclear tool descriptions. Every MCP result it receives stays under 30 kB. Nothing may cost what Slices 3 and 4 bought: `formscheck` still passes, and the HTTP API answers as before.

**Awaiting Wes's acceptance (2026-09-24).**
- The default model passed on its first run.
- Haiku passed on 1 of 4 runs. The failures were not tool-size problems: two runs never called the MCP tools, and one guessed a val name that doesn't exist. See below.
- Every other condition passes.

| Condition | Target | Measured | |
|---|---|---|---|
| Default model (Opus 5.5) on Val Town | 3 different no-key operations, each 2xx | `GET /v1/alias/{username}`, `GET /v1/users/{user_id}`, `GET /v2/alias/vals/{username}/{val_name}`, all **200**. 6 swagger.bot calls, 11 turns | pass |
| Haiku on Val Town | the same | **Run 3 passed:** the same three operations, all 200. Run 4 got 2 of 3 (its third call was a 404 on a guessed val name). Runs 1 and 2 didn't count (see below) | 1 of 4 |
| Every MCP result the agents received | < 30 kB | **largest 6.6 kB** (Val Town's outline); `lookup_api` 1.0 kB, `get_operation` 0.4–3.2 kB | pass |
| `scripts/mcpcheck.ts https://swaggerbot.dev` (Stripe, GitHub REST API, Cloudflare) | 5 tools, no error, every result < 30 kB, every call ≤ 2 s | **PASS** on the first run: largest 26.9 kB (Cloudflare's outline, 76 of 3,600 operations), slowest 543 ms. With `--names "Val Town"`: PASS, largest 12.2 kB (`tools/list`), slowest 501 ms | pass |
| `scripts/formscheck.ts https://swaggerbot.dev` | PASS | **PASS**: outline p90 190 ms, operation p90 319 ms, 0 non-2xx; Cloudflare's 26.1 MB download in 584 ms | pass |
| The HTTP API answers as before | unchanged | `/api/apis/{apiId}/outline` without parameters matches the old build byte for byte on Cloudflare, Stripe, GitHub and Val Town. It was checked on a copy of the Index before WTR-130 merged. `formscheck` passes | pass |

## How it was measured

- **Production** `5acb32d` (deployed 12:25 CDT, 2026-09-24); the MCP code is unchanged since `3a41d89`, which the agent runs used (12:10–12:20). Claude Code 2.1.281, from WOPR3 through Cloudflare, with no API key: Val Town is in the Index, so no Discovery ran.
- **The agent runs:**
  - The command was `claude -p "<task>" --mcp-config <swaggerbot at https://swaggerbot.dev/mcp> --strict-mcp-config --allowedTools "mcp__swaggerbot__*,Bash" --disallowedTools "WebSearch,WebFetch" --output-format stream-json --verbose`, once with the default model and four times with `--model haiku`.
  - The task: "You have never used the Val Town API. Use the swaggerbot MCP tools to find its OpenAPI Spec and learn its operations, then use curl in Bash to make three successful calls to three different Val Town API operations that need no API key (you have no Val Town key). For each call, report the operation (method and path template), the exact URL you called, and the HTTP status. Don't use web search or web fetch."
  - Sizes are the tool_result bytes in the transcript.
  - Each claimed status was checked against the transcript's curl output. Run 3's third URL, `/v2/alias/vals/tmcw/test`, was re-checked by hand and answered 200.
- **The path the tools gave the default model:** `lookup_api("Val Town API")` returned Resolved, Official, 1.0 kB. Then `get_spec_outline` (52 operations, 6.6 kB), then `get_operation` on four candidates, which showed they need no security. Then curl.

## What the Haiku runs showed

- **Runs 1 and 2 never called a swagger.bot tool.** Each loaded the tools with ToolSearch, then echoed "calling swaggerbot via Bash…" and curled `https://api.val.town/openapi.json` directly. That is a web fetch through Bash, so these runs don't count either way. It's Haiku not using loaded deferred tools, which swagger.bot's results can't change. Earlier Haiku smoke tests that said "Using only the swaggerbot MCP tools" did call them.
- **Run 4** used the tools well: `lookup_api`, the outline, 3 × `get_operation`, then more outline queries when stuck. It couldn't find a public val name, and reported a 404 as a success.
- **Claude Code shows the model `structuredContent`, not the text block** (confirmed on production `lookup_api`). D6's lead sentence and "Next:" call don't reach it, and the agents navigated from the JSON and its self-explaining fields (`downloads`, `x-truncated`). Filed as **WTR-134** (Backlog) with options A/B/C for Wes.

## Follow-ups

- **WTR-134** (Backlog, not queued): the D6 guidance in `structuredContent`, plus small items from the reviews:
  - `list_vendor_apis` paging before multi-API Vendors: about 1.5 kB per API, over 30 kB at about 20.
  - Tool-level tests for the pending and failed Normalized Form texts.
  - `get_schema`'s no-match hint.
- `mcpcheck` passes even if every name skips `get_schema` (true today for Cloudflare and Val Town). A fallback to any schema reference would guarantee `get_schema` is exercised.
- `fetcher.test.ts`'s host-spacing tests are timing-sensitive and failed once each in two verifier runs under load; they passed on rerun.
