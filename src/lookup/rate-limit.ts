/** Requests a client IP may make a minute, unless `RATE_LIMIT_PER_MINUTE` says otherwise. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

/** The header whose first address is the client IP, unless `CLIENT_IP_HEADER` names another. */
export const DEFAULT_CLIENT_IP_HEADER = "x-forwarded-for";

const MINUTE_MS = 60_000;

export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      /** Whole seconds until the next request would be allowed. */
      retryAfterSeconds: number;
    };

export type RateLimiter = {
  /** Takes one request from `key`'s bucket, if it has one left. */
  take(key: string): RateLimitResult;
  /** How many buckets are kept: idle ones are evicted. */
  size(): number;
};

/**
 * An in-memory token bucket per key (a client IP): each holds `perMinute`
 * requests and refills at `perMinute` a minute. A bucket idle long enough
 * to be full again is the same as a new one, so it is evicted; the sweep
 * runs at most once a minute, on a `take`.
 */
export function createRateLimiter({
  perMinute,
  now = () => Date.now(),
}: {
  perMinute: number;
  now?: () => number;
}): RateLimiter {
  const perMs = perMinute / MINUTE_MS;
  const buckets = new Map<string, { tokens: number; at: number }>();
  let sweptAt = now();

  function sweep(at: number): void {
    if (at - sweptAt < MINUTE_MS) return;
    sweptAt = at;
    for (const [key, bucket] of buckets)
      if (at - bucket.at >= MINUTE_MS) buckets.delete(key);
  }

  return {
    take(key) {
      const at = now();
      sweep(at);
      const bucket = buckets.get(key);
      const tokens = bucket
        ? Math.min(perMinute, bucket.tokens + (at - bucket.at) * perMs)
        : perMinute;
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at });
        return { allowed: true };
      }
      buckets.set(key, { tokens, at });
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)),
      };
    },
    size: () => buckets.size,
  };
}

/** `RATE_LIMIT_PER_MINUTE` when it is a positive integer, else `DEFAULT_RATE_LIMIT_PER_MINUTE`. */
export function rateLimitPerMinute(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = console.warn,
): number {
  const raw = env.RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw) return DEFAULT_RATE_LIMIT_PER_MINUTE;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(value) && value > 0) return value;
  warn(
    `RATE_LIMIT_PER_MINUTE "${raw}" is not a positive integer; using ${DEFAULT_RATE_LIMIT_PER_MINUTE}.`,
  );
  return DEFAULT_RATE_LIMIT_PER_MINUTE;
}

/** The header named by `CLIENT_IP_HEADER`, lowercased; unset, `x-forwarded-for`. */
export function clientIpHeader(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.CLIENT_IP_HEADER?.trim().toLowerCase() || DEFAULT_CLIENT_IP_HEADER;
}

/** The first address in `header` (a list such as `x-forwarded-for`), or `"unknown"`. */
export function clientIpOf(request: Request, header: string): string {
  return request.headers.get(header)?.split(",")[0]?.trim() || "unknown";
}
