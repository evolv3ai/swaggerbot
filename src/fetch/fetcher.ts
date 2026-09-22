import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import zlib from "node:zlib";
import robotsParser from "robots-parser";

export const USER_AGENT =
  "swagger.bot/0.1 (+https://github.com/evolv3ai/swaggerbot)";
/** The product token robots.txt groups are matched against. */
const ROBOTS_AGENT = "swagger.bot";
/** RFC 9309 lets crawlers ignore robots.txt content past 500 KiB. */
const ROBOTS_MAX_BYTES = 500 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchErrorKind =
  | "robots-disallowed"
  | "timeout"
  | "too-large"
  | "http-error"
  | "network"
  /** Not an `http:`/`https:` URL, or a private, loopback or link-local address. */
  | "refused";

export class FetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly url: string;
  /** The HTTP status, for `http-error`. */
  readonly status?: number;

  constructor(
    kind: FetchErrorKind,
    url: string,
    message: string,
    opts: { status?: number; cause?: unknown } = {},
  ) {
    super(`${kind}: ${message} (${url})`, { cause: opts.cause });
    this.name = "FetchError";
    this.kind = kind;
    this.url = url;
    this.status = opts.status;
  }
}

export type FetchResult = {
  /** The URL that was asked for. */
  url: string;
  /** The URL the body came from, after redirects. */
  finalUrl: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
};

export type Fetcher = {
  /** Fetches a URL politely; throws a `FetchError` on any failure. */
  fetchUrl(url: string, opts?: { signal?: AbortSignal }): Promise<FetchResult>;
};

export type FetcherOptions = {
  /** Minimum spacing between requests to one host. Default 1000 ms. */
  minIntervalMs?: number;
  /** Per request, headers and body included. Default 10 s. */
  timeoutMs?: number;
  /** Cap on the (decoded) body. Default 10 MB. */
  maxBytes?: number;
  /** Default 5. */
  maxRedirects?: number;
  /** How long a robots.txt verdict is kept per origin. Default one hour. */
  robotsTtlMs?: number;
  /** Allow private, loopback and link-local addresses. Tests only. */
  allowPrivate?: boolean;
  /** Replaces DNS resolution. Tests use it to point fixture hosts at 127.0.0.1. */
  lookup?: LookupFunction;
};

type Robots = { isAllowed(url: string, ua?: string): boolean | undefined };
type RobotsVerdict = Robots | "allow-all" | "disallow-all";

type RawResponse = {
  status: number;
  location: string | null;
  contentType: string | null;
  bytes: Uint8Array;
};

export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const minIntervalMs = opts.minIntervalMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 5;
  const robotsTtlMs = opts.robotsTtlMs ?? 60 * 60 * 1000;
  const allowPrivate = opts.allowPrivate ?? false;
  const lookup = guardLookup(
    opts.lookup ?? (dnsLookup as LookupFunction),
    allowPrivate,
  );

  const nextSlot = new Map<string, number>();
  const robotsCache = new Map<
    string,
    { expiresAt: number; verdict: Promise<RobotsVerdict> }
  >();

  /** Reserves the next slot for a host and waits for it. */
  async function waitTurn(host: string, signal?: AbortSignal) {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + minIntervalMs);
    if (at > now) await sleep(at - now, undefined, { signal });
  }

  function checkTarget(url: URL, original: string): URL {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new FetchError("refused", original, `scheme ${url.protocol}`);
    }
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (!allowPrivate && isIP(literal) && isPrivateAddress(literal)) {
      throw new FetchError("refused", original, `private address ${literal}`);
    }
    return url;
  }

  /** One HTTP request, no redirect following. */
  async function requestOnce(
    url: URL,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RawResponse> {
    await waitTurn(url.hostname, signal);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const client = url.protocol === "https:" ? https : http;

    try {
      return await new Promise<RawResponse>((resolve, reject) => {
        const req = client.request(url, {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "application/json, application/yaml, text/yaml, text/html;q=0.9, */*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
          },
          lookup,
          signal: combined,
        });
        req.on("error", reject);
        req.on("response", (res) => {
          const status = res.statusCode ?? 0;
          const location = headerValue(res.headers.location);
          const contentType = headerValue(res.headers["content-type"]);
          if (REDIRECT_STATUSES.has(status) && location) {
            res.resume();
            resolve({ status, location, contentType, bytes: new Uint8Array() });
            return;
          }
          readBody(res, limit, url.href).then(
            (bytes) => resolve({ status, location, contentType, bytes }),
            reject,
          );
        });
        req.end();
      });
    } catch (error) {
      if (error instanceof FetchError) {
        if (error.kind !== "refused" || error.url === url.href) throw error;
        throw new FetchError("refused", url.href, error.message, {
          cause: error,
        });
      }
      if (timeout.aborted) {
        throw new FetchError(
          "timeout",
          url.href,
          `no answer in ${timeoutMs} ms`,
        );
      }
      throw new FetchError("network", url.href, describe(error), {
        cause: error,
      });
    }
  }

  async function fetchRobots(origin: string): Promise<RobotsVerdict> {
    let url = new URL("/robots.txt", origin);
    try {
      for (let hop = 0; ; hop++) {
        const res = await requestOnce(url, ROBOTS_MAX_BYTES);
        if (REDIRECT_STATUSES.has(res.status) && res.location) {
          if (hop >= maxRedirects) return "disallow-all";
          url = checkTarget(new URL(res.location, url), url.href);
          continue;
        }
        if (res.status >= 200 && res.status < 300) {
          // Parsed against the origin asked about, even after a redirect.
          return robotsParser(
            new URL("/robots.txt", origin).href,
            new TextDecoder().decode(res.bytes),
          );
        }
        // RFC 9309: an unavailable robots.txt (4xx) allows everything; an
        // unreachable one (5xx, network) disallows everything.
        return res.status >= 400 && res.status < 500
          ? "allow-all"
          : "disallow-all";
      }
    } catch (error) {
      if (error instanceof FetchError && error.kind === "refused") throw error;
      return "disallow-all";
    }
  }

  async function checkRobots(url: URL) {
    if (url.pathname === "/robots.txt") return;
    const origin = url.origin;
    let entry = robotsCache.get(origin);
    if (!entry || entry.expiresAt <= Date.now()) {
      entry = {
        expiresAt: Date.now() + robotsTtlMs,
        verdict: fetchRobots(origin),
      };
      robotsCache.set(origin, entry);
    }
    let verdict: RobotsVerdict;
    try {
      verdict = await entry.verdict;
    } catch (error) {
      // A refused origin is not a robots.txt verdict; don't cache it.
      robotsCache.delete(origin);
      throw error;
    }
    const allowed =
      verdict === "allow-all"
        ? true
        : verdict === "disallow-all"
          ? false
          : verdict.isAllowed(url.href, ROBOTS_AGENT) !== false;
    if (!allowed) {
      throw new FetchError(
        "robots-disallowed",
        url.href,
        "robots.txt disallows it",
      );
    }
  }

  return {
    async fetchUrl(input, { signal } = {}) {
      let url: URL;
      try {
        url = new URL(input);
      } catch (error) {
        throw new FetchError("refused", input, "not a URL", { cause: error });
      }
      url = checkTarget(url, input);

      for (let hop = 0; ; hop++) {
        await checkRobots(url);
        const res = await requestOnce(url, maxBytes, signal);
        if (REDIRECT_STATUSES.has(res.status) && res.location) {
          if (hop >= maxRedirects) {
            throw new FetchError("http-error", input, "too many redirects", {
              status: res.status,
            });
          }
          url = checkTarget(new URL(res.location, url), input);
          continue;
        }
        if (res.status >= 200 && res.status < 300) {
          return {
            url: input,
            finalUrl: url.href,
            status: res.status,
            contentType: res.contentType,
            bytes: res.bytes,
          };
        }
        throw new FetchError("http-error", url.href, `HTTP ${res.status}`, {
          status: res.status,
        });
      }
    },
  };
}

function readBody(
  res: IncomingMessage,
  limit: number,
  url: string,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      res.destroy();
      reject(new FetchError("too-large", url, `body over ${limit} bytes`));
      return;
    }

    const stream = decoded(res);
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        res.destroy();
        stream.destroy();
        reject(new FetchError("too-large", url, `body over ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on("error", reject);
    res.on("error", reject);
  });
}

/** The body with its Content-Encoding undone, so the cap applies to real bytes. */
function decoded(res: IncomingMessage): Readable {
  switch (headerValue(res.headers["content-encoding"])?.toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return res.pipe(zlib.createGunzip());
    case "deflate":
      return res.pipe(zlib.createInflate());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const privateRanges = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  privateRanges.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  privateRanges.addSubnet(network, prefix, "ipv6");
}

/** Private, loopback, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4) return privateRanges.check(address, "ipv4");
  if (family === 6) return privateRanges.check(address, "ipv6");
  return false;
}

/**
 * Wraps DNS resolution so a name resolving to a private address is refused at
 * connect time, which also covers names that change between checks.
 */
function guardLookup(
  base: LookupFunction,
  allowPrivate: boolean,
): LookupFunction {
  return ((
    hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    base(hostname, { ...options, all: true }, ((
      error: NodeJS.ErrnoException | null,
      addresses: LookupAddress[],
    ) => {
      if (error) return callback(error);
      const list = Array.isArray(addresses) ? addresses : [];
      const blocked = allowPrivate
        ? undefined
        : list.find((entry) => isPrivateAddress(entry.address));
      if (blocked) {
        return callback(
          new FetchError(
            "refused",
            hostname,
            `${hostname} resolves to private address ${blocked.address}`,
          ),
        );
      }
      const first = list[0];
      if (!first) return callback(new Error(`no address for ${hostname}`));
      if (options.all) return callback(null, list);
      return callback(null, first.address, first.family);
    }) as never);
  }) as LookupFunction;
}
