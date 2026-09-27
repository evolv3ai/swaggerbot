import { z } from "zod";
import type { Outcome } from "~/domain/outcome";
import type { KeyStore, Verification, VerifiedKey } from "~/index-store/keys";
import type { IndexedLookup, LookupRequest } from "./lookup";
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
  keys: Pick<KeyStore, "verify">;
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

/** Where a Caller gets an API key: the `/keys` page (Slice 7). */
export const KEYS_URL = "https://swaggerbot.dev/keys";

/** How a Caller sends its API key, and where it gets one, for the answers that need one. */
export const KEY_HINT = `Send it as \`Authorization: Bearer <key>\`. Get a key at ${KEYS_URL}.`;

/** The body of every 401 for a key that is sent but names no live key. */
export const UNKNOWN_KEY = { error: "Unknown or revoked API key." };

/** The body of every 503 for a key that can't be checked because the key store isn't answering (D3). */
export const KEYS_UNAVAILABLE = {
  error: "API keys can't be checked right now.",
  hint: "retry shortly",
};

/** Seconds a Caller is told to wait when keys can't be checked. */
export const KEYS_RETRY_AFTER_SECONDS = 30;

/** The body of a Lookup's refusal: what went wrong, and what fixes it. */
export type LookupError = {
  error: string;
  hint?: string;
  limit?: number;
  used?: number;
};

/**
 * A Lookup's answer, before any surface shapes it: the HTTP status, the JSON
 * body (the Outcome when 200) and the headers. `POST /api/lookup` sends it
 * as a `Response`; the MCP tool `lookup_api` turns it into a tool result.
 */
export type LookupAnswer =
  | { status: 200; body: Outcome; headers: Record<string, string> }
  | {
      status: 401 | 429 | 503;
      body: LookupError;
      headers: Record<string, string>;
    };

/** The key a Lookup runs under: its secret, verified again at cost 1 for Discovery. */
export type LookupKey = { secret: string };

/**
 * Handles `POST /api/lookup`, in this order:
 *
 * 1. 429 when the client IP is over its rate limit;
 * 2. 400 with the zod issues for a bad body;
 * 3. 401 when an `Authorization` header is sent but names no live key, even
 *    when the Index could answer (verified at cost 0); 503 when the key
 *    store can't say;
 * 4. then `answerLookup`: the Index's answer, or Discovery under the key.
 *
 * `getApp` is called once a valid request needs it, so the real dependencies
 * are built only then.
 */
export async function handleLookupRequest(
  request: Request,
  getApp: () => LookupApp,
  gate: Gate,
): Promise<Response> {
  const limited = rateLimited(request, gate);
  if (limited) return limited;

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

  const app = getApp();
  const auth = await authenticate(request, app.keys);
  if ("response" in auth) return auth.response;

  const answer = await answerLookup(
    body.data,
    auth.key ? { secret: auth.secret } : undefined,
    app,
    gate,
  );
  return Response.json(answer.body, {
    status: answer.status,
    headers: answer.headers,
  });
}

/**
 * The Lookup's rules, shared by every surface (ADR 0005), for a valid
 * request whose key, if any, is live:
 *
 * 1. 200 with the answer from the Index, unless `fresh`: open to anyone, no
 *    quota used;
 * 2. otherwise (Discovery or `fresh`), 401 without a key; the key verified
 *    at cost 1: 401 when it is no longer live, 429 when its daily quota is
 *    used, 503 when the key store can't say; else 200 with the Lookup's
 *    Outcome and the quota headers.
 */
export async function answerLookup(
  request: LookupRequest,
  key: LookupKey | undefined,
  { lookup, keys }: LookupApp,
  gate: Pick<Gate, "dailyQuota" | "now">,
): Promise<LookupAnswer> {
  const now = gate.now?.() ?? new Date();
  const indexed = lookup.fromIndex(request);
  if (indexed) return { status: 200, body: indexed, headers: {} };

  if (!key)
    return {
      status: 401,
      body: { error: "Discovery needs an API key.", hint: KEY_HINT },
      headers: { "www-authenticate": "Bearer" },
    };
  const verified = await keys.verify(key.secret, {
    cost: 1,
    now,
    dailyQuota: gate.dailyQuota,
  });
  if (!verified.ok) return refusal(verified, now);
  const quotaHeaders = quotaHeadersOf(verified.key);
  return { status: 200, body: await lookup(request), headers: quotaHeaders };
}

/**
 * The live key a request names in `Authorization: Bearer`, verified at cost
 * 0, with its secret; no key when the header isn't sent (the key store is
 * never called); or `{ response }`, a 401 when a key is sent but names no
 * live key, a 503 when the key store can't say.
 */
export async function authenticate(
  request: Request,
  keys: Pick<KeyStore, "verify">,
): Promise<
  | { key: VerifiedKey; secret: string }
  | { key: undefined }
  | { response: Response }
> {
  const secret = bearerOf(request);
  if (secret === undefined) return { key: undefined };
  // A header that isn't a Bearer names no key: not worth asking the store.
  const verified: Verification = secret
    ? await keys.verify(secret, { cost: 0 })
    : { ok: false, reason: "unknown" };
  if (verified.ok) return { key: verified.key, secret };
  const { status, body, headers } = refusal(verified);
  return { response: Response.json(body, { status, headers }) };
}

/**
 * A failed verification as the answer a Caller gets: 401 for a key that
 * isn't live, 429 for a used quota (as Slice 3 answers it), 503 with
 * `retry-after` when the key store can't say. The store's own reasons stay
 * here.
 */
export function refusal(
  verified: Extract<Verification, { ok: false }>,
  now: Date = new Date(),
): Extract<LookupAnswer, { status: 401 | 429 | 503 }> {
  switch (verified.reason) {
    case "unknown":
    case "revoked":
      return {
        status: 401,
        body: UNKNOWN_KEY,
        headers: { "www-authenticate": "Bearer" },
      };
    case "quota": {
      const { limit, used, resetsAt } = verified;
      const resets = resetsAt ? new Date(resetsAt) : undefined;
      const retryAfter =
        resets && resets > now
          ? Math.ceil((resets.getTime() - now.getTime()) / 1000)
          : secondsToUtcMidnight(now);
      return {
        status: 429,
        body: {
          error: "Daily quota used.",
          ...(limit === undefined ? {} : { limit }),
          ...(used === undefined ? {} : { used }),
        },
        headers: {
          ...quotaHeadersOf({ limit, remaining: 0 }),
          "retry-after": String(retryAfter),
        },
      };
    }
    case "unavailable":
      return {
        status: 503,
        body: KEYS_UNAVAILABLE,
        headers: { "retry-after": String(KEYS_RETRY_AFTER_SECONDS) },
      };
  }
}

/** `x-quota-limit` and `x-quota-remaining`, each when the key store knows it. */
function quotaHeadersOf({
  limit,
  remaining,
}: Pick<VerifiedKey, "limit" | "remaining">): Record<string, string> {
  return {
    ...(limit === undefined ? {} : { "x-quota-limit": String(limit) }),
    ...(remaining === undefined
      ? {}
      : { "x-quota-remaining": String(Math.max(0, remaining)) }),
  };
}

/**
 * Takes one request from the client IP's bucket: a 429 with `retry-after`
 * when it is over its rate limit, else `undefined`. Every route shares
 * one `gate`, so the limit is per IP across all of them.
 */
export function rateLimited(
  request: Request,
  gate: Pick<Gate, "rateLimiter" | "clientIpHeader">,
): Response | undefined {
  const limited = gate.rateLimiter.take(
    clientIpOf(request, gate.clientIpHeader),
  );
  if (limited.allowed) return undefined;
  return Response.json(
    { error: "Rate limit exceeded." },
    {
      status: 429,
      headers: { "retry-after": String(limited.retryAfterSeconds) },
    },
  );
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

/** Whole seconds from `now` until the next UTC midnight, when quotas reset. */
export function secondsToUtcMidnight(now: Date): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}
