import type { McpHttpHandler } from "@modelcontextprotocol/server";
import {
  authenticate,
  type Gate,
  type LookupApp,
  rateLimited,
} from "~/lookup/http";
import { authInfoOf } from "./auth";

/**
 * Serves one request to `/mcp`, with the HTTP API's rules before the MCP
 * handler runs:
 *
 * 1. 429 with `retry-after` when the client IP is over the per-IP limit
 *    shared with every other route;
 * 2. 401 with `WWW-Authenticate: Bearer` when `Authorization` names no live
 *    key, as `POST /api/lookup` answers, before any tool runs;
 * 3. otherwise the MCP handler, with the key as this request's `authInfo`
 *    (none without a key).
 */
export async function handleMcpRequest(
  request: Request,
  handler: Pick<McpHttpHandler, "fetch">,
  getApp: () => Pick<LookupApp, "keys">,
  gate: Pick<Gate, "rateLimiter" | "clientIpHeader">,
): Promise<Response> {
  const limited = rateLimited(request, gate);
  if (limited) return limited;
  const auth = authenticate(request, getApp().keys);
  if ("response" in auth) return auth.response;
  return handler.fetch(
    request,
    auth.key ? { authInfo: authInfoOf(auth.key, auth.secret) } : {},
  );
}
