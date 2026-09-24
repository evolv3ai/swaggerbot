import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ApiKey } from "~/index-store/keys";
import type { LookupKey } from "~/lookup/http";

/**
 * The `authInfo` a request to `/mcp` is served with when its bearer names a
 * live key: the key's id as `clientId`, and its own daily quota. Built per
 * request and handed to `handler.fetch`, never kept.
 */
export function authInfoOf(key: ApiKey, secret: string): AuthInfo {
  return {
    token: secret,
    clientId: key.id,
    scopes: [],
    extra: { dailyQuota: key.dailyQuota },
  };
}

/** The key a tool call runs under, from its request's `authInfo`; none without one. */
export function lookupKeyOf(
  authInfo: AuthInfo | undefined,
): LookupKey | undefined {
  if (!authInfo) return undefined;
  const dailyQuota = authInfo.extra?.dailyQuota;
  return {
    id: authInfo.clientId,
    dailyQuota: typeof dailyQuota === "number" ? dailyQuota : null,
  };
}
