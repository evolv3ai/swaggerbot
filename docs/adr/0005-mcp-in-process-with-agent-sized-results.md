# MCP served in-process, stateless, with results sized for agents

**Status:** accepted (Wes, 2026-09-24).

swagger.bot's MCP server is a route in the same TanStack Start app (ADR 0002), at `https://swaggerbot.dev/mcp`, built on the MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`, the stable line, implementing the 2026-07-28 spec). Its `createMcpHandler` turns a web-standard `Request` into a `Response` and builds a fresh `McpServer` per request, so the server keeps no session state and needs no sticky routing; it also answers 2025-era clients. The tools are thin adapters over the same code as the HTTP API: one rule for Index answers, API keys, quotas and the per-IP rate limit, whichever surface a Caller uses. The API key travels as `Authorization: Bearer`, is checked before the handler runs and is handed to it as `authInfo` for that request only.

What an MCP tool returns is sized for an agent's context, not for a program. Claude Code warns at 10,000 tokens of tool output and, by default, diverts anything over 25,000 to a file. Production's answers are far over that: the Spec Outline is 93 kB for Stripe and 761 kB for Cloudflare (3,600 operations, 574 tags), and every sampled Stripe `get_operation` stops at its 1 MB cap. So every MCP result is held to about 30 kB: the outline is filtered and paged, `get_operation` inlines to a smaller budget, and a fifth tool, `get_schema`, follows the references left behind. Spec content is still never returned whole through MCP (PRD): the full Spec is a download URL.

## Considered

- **SDK v1 (`@modelcontextprotocol/sdk` 1.30).** Still published, but v2 is the stable line and its handler is the web-standard `fetch` a server route needs. A spike (2026-09-24) served v2 from a TanStack Start route under Nitro, and Claude Code 2.1.281 (Haiku) connected over HTTP, listed the tool and resolved Stripe.
- **A separate MCP process, or stdio.** A second deployable, or a local install, for what is four adapters over code already in the app. No.
- **Sessions (stateful Streamable HTTP).** Nothing needs them: no tool streams, and no state spans calls.
- **Returning the HTTP answers unchanged.** Agents would get truncated files instead of answers. The spike also showed a small model reading the Outcome's `sources[].url` as the download link, so MCP results lead with a short summary and the next call, beside the full structured result.

## Consequences

- The outline's filters and paging, and `get_schema`, are shared code; the HTTP API gets them too (optional query parameters and a route), so the two surfaces stay equal.
- MCP calls count against the same per-IP limit (60 a minute by default). An agent navigating a Spec makes a handful of calls per task, well inside it.
- `@modelcontextprotocol/server` becomes a dependency, and with it its protocol updates.
