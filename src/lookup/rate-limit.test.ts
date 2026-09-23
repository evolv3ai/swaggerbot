import { describe, expect, it, vi } from "vitest";
import {
  clientIpHeader,
  clientIpOf,
  createRateLimiter,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  rateLimitPerMinute,
} from "./rate-limit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows the limit, then refuses the next with the seconds until a token is back", () => {
    const c = clock();
    const limiter = createRateLimiter({ perMinute: 3, now: c.now });

    expect([1, 2, 3].map(() => limiter.take("1.2.3.4").allowed)).toEqual([
      true,
      true,
      true,
    ]);
    // 3 a minute: one token every 20 s.
    expect(limiter.take("1.2.3.4")).toEqual({
      allowed: false,
      retryAfterSeconds: 20,
    });
    c.advance(5_000);
    expect(limiter.take("1.2.3.4")).toEqual({
      allowed: false,
      retryAfterSeconds: 15,
    });
  });

  it("refills over time", () => {
    const c = clock();
    const limiter = createRateLimiter({ perMinute: 60, now: c.now });
    for (let i = 0; i < 60; i++) limiter.take("a");
    expect(limiter.take("a").allowed).toBe(false);

    c.advance(1_000);
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);

    c.advance(60_000);
    for (let i = 0; i < 60; i++) expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("keeps IPs separate", () => {
    const limiter = createRateLimiter({ perMinute: 1, now: clock().now });

    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
    expect(limiter.take("b").allowed).toBe(true);
  });

  it("evicts buckets idle long enough to be full again", () => {
    const c = clock();
    const limiter = createRateLimiter({ perMinute: 2, now: c.now });
    limiter.take("a");
    limiter.take("b");
    c.advance(30_000);
    limiter.take("c");
    expect(limiter.size()).toBe(3);

    c.advance(30_000);
    limiter.take("d");

    // a and b idled a minute; c only 30 s.
    expect(limiter.size()).toBe(2);
    limiter.take("a");
    limiter.take("a");
    expect(limiter.take("a").allowed).toBe(false);
  });
});

describe("rateLimitPerMinute", () => {
  it("reads RATE_LIMIT_PER_MINUTE, defaulting to 60", () => {
    expect(rateLimitPerMinute({})).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    expect(rateLimitPerMinute({ RATE_LIMIT_PER_MINUTE: " 120 " })).toBe(120);
  });

  it("warns and defaults on a value that isn't a positive integer", () => {
    const warn = vi.fn();
    expect(rateLimitPerMinute({ RATE_LIMIT_PER_MINUTE: "0" }, warn)).toBe(60);
    expect(rateLimitPerMinute({ RATE_LIMIT_PER_MINUTE: "1.5" }, warn)).toBe(60);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("client IP", () => {
  it("is the first address in CLIENT_IP_HEADER, default x-forwarded-for", () => {
    expect(clientIpHeader({})).toBe("x-forwarded-for");
    expect(clientIpHeader({ CLIENT_IP_HEADER: "CF-Connecting-IP" })).toBe(
      "cf-connecting-ip",
    );
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": " 203.0.113.9, 10.0.0.1" },
    });
    expect(clientIpOf(request, "x-forwarded-for")).toBe("203.0.113.9");
    expect(clientIpOf(request, "cf-connecting-ip")).toBe("unknown");
  });
});
