import type { AuthInfo } from "@modelcontextprotocol/server";
import type { VerifiedKey } from "~/index-store/keys";
import type { LookupKey } from "~/lookup/http";

/**
 * The `authInfo` a request to `/mcp` is served with when its bearer names a
 * live key: the secret as `token` (a Discovery verifies it again, at cost
 * 1) and the key's id as `clientId`. Built per request and handed to
 * `handler.fetch`, never kept.
 */
export function authInfoOf(key: VerifiedKey, secret: string): AuthInfo {
  return {
    token: secret,
    clientId: key.id,
    scopes: [],
  };
}

/** The key a tool call runs under, from its request's `authInfo`; none without one. */
export function lookupKeyOf(
  authInfo: AuthInfo | undefined,
): LookupKey | undefined {
  if (!authInfo) return undefined;
  return { secret: authInfo.token };
}
