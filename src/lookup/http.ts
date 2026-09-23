import { z } from "zod";
import { type Keys, utcDay } from "~/index-store/keys";
import type { IndexedLookup } from "./lookup";
import { clientIpOf, type RateLimiter } from "./rate-limit";

/** The body of `POST /api/lookup`. */
export const LookupBody = z.object({
  name: z.string().trim().min(1).max(200),
  apiVersion: z.string().trim().min(1).optional(),
  allowCommunity: z.boolean().optional(),
  fresh: z.boolean().optional(),
});

/** What `POST /api/lookup` runs on: the Lookup and the API keys. */
export type LookupApp = {
  lookup: IndexedLookup;
  keys: Pick<Keys, "findKey" | "takeQuota">;
};

/** The limits `POST /api/lookup` enforces, and its clock. */
export type Gate = {
  rateLimiter: RateLimiter;
  /** The header whose first address is the client IP, lowercased. */
  clientIpHeader: string;
  /** A key's daily quota when it has none of its own. */
  dailyQuota: number;
  now?: () => Date;
};

const KEY_HINT =
  "Send it as `Authorization: Bearer <key>`. Keys are issued by the operator of this service; ask them for one.";

/**
 * Handles `POST /api/lookup`, in this order:
 *
 * 1. 429 when the client IP is over its rate limit;
 * 2. 400 with the zod issues for a bad body;
 * 3. 401 when an `Authorization` header is sent but names no live key, even
 *    when the Index could answer;
 * 4. 200 with the answer from the Index, unless `fresh`: open to anyone, no
 *    quota used;
 * 5. otherwise (Discovery or `fresh`), 401 without a key, 429 when the key's
 *    daily quota is used, else 200 with the Lookup's Outcome and the quota
 *    headers.
 *
 * `getApp` is called once a valid request needs it, so the real dependencies
 * are built only then.
 */
export async function handleLookupRequest(
  request: Request,
  getApp: () => LookupApp,
  gate: Gate,
): Promise<Response> {
  const now = gate.now?.() ?? new Date();
  const limited = gate.rateLimiter.take(
    clientIpOf(request, gate.clientIpHeader),
  );
  if (!limited.allowed)
    return Response.json(
      { error: "Rate limit exceeded." },
      {
        status: 429,
        headers: { "retry-after": String(limited.retryAfterSeconds) },
      },
    );

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const body = LookupBody.safeParse(json);
  if (!body.success)
    return Response.json(
      { error: "Invalid lookup request.", issues: body.error.issues },
      { status: 400 },
    );

  const { lookup, keys } = getApp();
  const secret = bearerOf(request);
  const key = secret === undefined ? undefined : keys.findKey(secret);
  if (secret !== undefined && !key)
    return unauthorized({ error: "Unknown or revoked API key." });

  const indexed = lookup.fromIndex(body.data);
  if (indexed) return Response.json(indexed);

  if (!key)
    return unauthorized({
      error: "Discovery needs an API key.",
      hint: KEY_HINT,
    });
  const quota = keys.takeQuota(
    key.id,
    utcDay(now),
    key.dailyQuota ?? gate.dailyQuota,
  );
  const quotaHeaders = {
    "x-quota-limit": String(quota.limit),
    "x-quota-remaining": String(Math.max(0, quota.limit - quota.used)),
  };
  if (!quota.allowed)
    return Response.json(
      { error: "Daily quota used.", limit: quota.limit, used: quota.used },
      {
        status: 429,
        headers: {
          ...quotaHeaders,
          "retry-after": String(secondsToUtcMidnight(now)),
        },
      },
    );
  return Response.json(await lookup(body.data), { headers: quotaHeaders });
}

/**
 * The secret in `Authorization: Bearer <secret>`; undefined without the
 * header. A header in any other form is an empty secret, which names no key.
 */
function bearerOf(request: Request): string | undefined {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return undefined;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? "";
}

function unauthorized(body: Record<string, string>): Response {
  return Response.json(body, {
    status: 401,
    headers: { "www-authenticate": "Bearer" },
  });
}

/** Whole seconds from `now` until the next UTC midnight, when quotas reset. */
export function secondsToUtcMidnight(now: Date): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}
