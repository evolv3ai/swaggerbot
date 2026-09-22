import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FixtureServer,
  fixtureLookup,
  startFixtureServer,
} from "./__fixtures__/server";
import {
  createFetcher,
  FetchError,
  type FetcherOptions,
  isPrivateAddress,
  USER_AGENT,
} from "./fetcher";

let server: FixtureServer;

beforeEach(async () => {
  server = await startFixtureServer();
});

afterEach(async () => {
  await server.close();
});

const testFetcher = (opts: FetcherOptions = {}) =>
  createFetcher({
    allowPrivate: true,
    lookup: fixtureLookup,
    minIntervalMs: 0,
    ...opts,
  });

async function fetchError(promise: Promise<unknown>): Promise<FetchError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FetchError);
  return error as FetchError;
}

describe("fetchUrl", () => {
  it("fetches with an honest User-Agent when robots.txt is missing", async () => {
    let userAgent: string | undefined;
    server.route("vendor.test", "/doc", (req, res) => {
      userAgent = req.headers["user-agent"];
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });

    const url = `${server.origin("vendor.test")}/doc`;
    const result = await testFetcher().fetchUrl(url);

    expect(result).toMatchObject({
      url,
      finalUrl: url,
      status: 200,
      contentType: "application/json",
    });
    expect(new TextDecoder().decode(result.bytes)).toBe("{}");
    expect(userAgent).toBe(USER_AGENT);
  });

  it("honours a robots.txt disallow and fetches robots.txt once per origin", async () => {
    server.send(
      "vendor.test",
      "/robots.txt",
      "User-agent: swagger.bot\nDisallow: /private\n",
      "text/plain",
    );
    server.send("vendor.test", "/public", "ok", "text/plain");
    server.send("vendor.test", "/private/spec.json", "{}", "application/json");
    const fetcher = testFetcher();

    const error = await fetchError(
      fetcher.fetchUrl(`${server.origin("vendor.test")}/private/spec.json`),
    );
    await fetcher.fetchUrl(`${server.origin("vendor.test")}/public`);

    expect(error.kind).toBe("robots-disallowed");
    expect(server.requests.map((r) => r.path)).toEqual([
      "/robots.txt",
      "/public",
    ]);
  });

  it("disallows an origin whose robots.txt answers 5xx", async () => {
    server.route("vendor.test", "/robots.txt", (_req, res) => {
      res.writeHead(503).end();
    });
    server.send("vendor.test", "/doc", "ok", "text/plain");

    const error = await fetchError(
      testFetcher().fetchUrl(`${server.origin("vendor.test")}/doc`),
    );

    expect(error.kind).toBe("robots-disallowed");
  });

  it("spaces two requests to one host", async () => {
    server.send("vendor.test", "/a", "a", "text/plain");
    server.send("vendor.test", "/b", "b", "text/plain");
    const fetcher = testFetcher({ minIntervalMs: 250 });

    await Promise.all([
      fetcher.fetchUrl(`${server.origin("vendor.test")}/a`),
      fetcher.fetchUrl(`${server.origin("vendor.test")}/b`),
    ]);

    const times = server.requests
      .filter((r) => r.path !== "/robots.txt")
      .map((r) => r.at);
    expect(times).toHaveLength(2);
    expect(Math.abs((times[1] ?? 0) - (times[0] ?? 0))).toBeGreaterThanOrEqual(
      240,
    );
  });

  it("refuses a body over the cap, with or without Content-Length", async () => {
    const big = "x".repeat(4096);
    server.send("vendor.test", "/declared", big, "text/plain");
    server.route("vendor.test", "/chunked", (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write(big.slice(0, 2048));
      res.end(big.slice(2048));
    });
    const fetcher = testFetcher({ maxBytes: 1024 });

    const declared = await fetchError(
      fetcher.fetchUrl(`${server.origin("vendor.test")}/declared`),
    );
    const chunked = await fetchError(
      fetcher.fetchUrl(`${server.origin("vendor.test")}/chunked`),
    );

    expect(declared.kind).toBe("too-large");
    expect(chunked.kind).toBe("too-large");
  });

  it("applies the cap to the decoded body", async () => {
    server.route("vendor.test", "/bomb", (_req, res) => {
      res
        .writeHead(200, { "content-encoding": "gzip" })
        .end(gzipSync("x".repeat(100_000)));
    });

    const error = await fetchError(
      testFetcher({ maxBytes: 10_000 }).fetchUrl(
        `${server.origin("vendor.test")}/bomb`,
      ),
    );

    expect(error.kind).toBe("too-large");
  });

  it("times out on a server that never answers", async () => {
    server.route("vendor.test", "/slow", () => {
      // Never respond.
    });

    const error = await fetchError(
      testFetcher({ timeoutMs: 200 }).fetchUrl(
        `${server.origin("vendor.test")}/slow`,
      ),
    );

    expect(error.kind).toBe("timeout");
  });

  it("reports an HTTP error status", async () => {
    const error = await fetchError(
      testFetcher().fetchUrl(`${server.origin("vendor.test")}/missing`),
    );

    expect(error.kind).toBe("http-error");
    expect(error.status).toBe(404);
  });

  it("follows a redirect and reports the final URL", async () => {
    server.route("vendor.test", "/old", (_req, res) => {
      res.writeHead(301, { location: "/new" }).end();
    });
    server.send("vendor.test", "/new", "moved", "text/plain");

    const result = await testFetcher().fetchUrl(
      `${server.origin("vendor.test")}/old`,
    );

    expect(result.finalUrl).toBe(`${server.origin("vendor.test")}/new`);
  });

  it("refuses a redirect onto an origin whose robots.txt disallows it", async () => {
    server.route("vendor.test", "/spec", (_req, res) => {
      res
        .writeHead(302, { location: `${server.origin("cdn.test")}/spec.json` })
        .end();
    });
    server.send("cdn.test", "/robots.txt", "User-agent: *\nDisallow: /\n", "");
    server.send("cdn.test", "/spec.json", "{}", "application/json");

    const error = await fetchError(
      testFetcher().fetchUrl(`${server.origin("vendor.test")}/spec`),
    );

    expect(error.kind).toBe("robots-disallowed");
    expect(server.requests).not.toContainEqual(
      expect.objectContaining({ host: "cdn.test", path: "/spec.json" }),
    );
  });

  it("stops after five redirects", async () => {
    server.route("vendor.test", "/loop", (_req, res) => {
      res.writeHead(302, { location: "/loop" }).end();
    });

    const error = await fetchError(
      testFetcher().fetchUrl(`${server.origin("vendor.test")}/loop`),
    );

    expect(error.kind).toBe("http-error");
    expect(
      server.requests.filter((r) => r.path === "/loop").length,
    ).toBeLessThanOrEqual(6);
  });

  it("refuses URLs that are not http or https", async () => {
    const error = await fetchError(
      testFetcher().fetchUrl("file:///etc/passwd"),
    );
    expect(error.kind).toBe("refused");
  });
});

describe("fetchUrl with ignoreRobots (ADR 0003)", () => {
  const disallowAll = (host: string) =>
    server.send(host, "/robots.txt", "User-agent: *\nDisallow: /\n", "");

  it("still refuses a disallowed URL by default", async () => {
    disallowAll("api.test");
    server.send("api.test", "/openapi.json", "{}", "application/json");

    const error = await fetchError(
      testFetcher().fetchUrl(`${server.origin("api.test")}/openapi.json`),
    );

    expect(error.kind).toBe("robots-disallowed");
  });

  it("returns a disallowed URL and says robots.txt disallowed it", async () => {
    disallowAll("api.test");
    server.send("api.test", "/openapi.json", "{}", "application/json");

    const result = await testFetcher().fetchUrl(
      `${server.origin("api.test")}/openapi.json`,
      { ignoreRobots: true },
    );

    expect(new TextDecoder().decode(result.bytes)).toBe("{}");
    expect(result.robotsDisallowed).toBe(true);
  });

  it("reports robotsDisallowed false for an allowed URL", async () => {
    server.send(
      "api.test",
      "/robots.txt",
      "User-agent: *\nDisallow: /private\n",
      "",
    );
    server.send("api.test", "/openapi.json", "{}", "application/json");
    const fetcher = testFetcher();

    const flagged = await fetcher.fetchUrl(
      `${server.origin("api.test")}/openapi.json`,
      { ignoreRobots: true },
    );
    const plain = await fetcher.fetchUrl(
      `${server.origin("api.test")}/openapi.json`,
    );

    expect(flagged.robotsDisallowed).toBe(false);
    expect(plain.robotsDisallowed).toBe(false);
    expect(
      server.requests.filter((r) => r.path === "/robots.txt"),
    ).toHaveLength(1);
  });

  it("follows a redirect from an allowed host onto a disallowed one", async () => {
    server.route("docs.test", "/openapi", (_req, res) => {
      res
        .writeHead(302, {
          location: `${server.origin("api.test")}/openapi.json`,
        })
        .end();
    });
    disallowAll("api.test");
    server.send("api.test", "/openapi.json", "{}", "application/json");

    const result = await testFetcher().fetchUrl(
      `${server.origin("docs.test")}/openapi`,
      { ignoreRobots: true },
    );

    expect(result.finalUrl).toBe(`${server.origin("api.test")}/openapi.json`);
    expect(result.robotsDisallowed).toBe(true);
  });

  it("still spaces requests to one host", async () => {
    disallowAll("api.test");
    server.send("api.test", "/a", "a", "text/plain");
    server.send("api.test", "/b", "b", "text/plain");
    const fetcher = testFetcher({ minIntervalMs: 250 });

    await Promise.all([
      fetcher.fetchUrl(`${server.origin("api.test")}/a`, {
        ignoreRobots: true,
      }),
      fetcher.fetchUrl(`${server.origin("api.test")}/b`, {
        ignoreRobots: true,
      }),
    ]);

    const times = server.requests
      .filter((r) => r.path !== "/robots.txt")
      .map((r) => r.at);
    expect(times).toHaveLength(2);
    expect(Math.abs((times[1] ?? 0) - (times[0] ?? 0))).toBeGreaterThanOrEqual(
      240,
    );
  });

  it("still applies the size cap", async () => {
    disallowAll("api.test");
    server.send("api.test", "/openapi.json", "x".repeat(4096), "text/plain");

    const error = await fetchError(
      testFetcher({ maxBytes: 1024 }).fetchUrl(
        `${server.origin("api.test")}/openapi.json`,
        { ignoreRobots: true },
      ),
    );

    expect(error.kind).toBe("too-large");
  });
});

describe("private addresses", () => {
  it("are refused by default, as a literal or through DNS", async () => {
    server.send("vendor.test", "/doc", "ok", "text/plain");
    const fetcher = createFetcher({ minIntervalMs: 0 });
    const viaDns = createFetcher({ minIntervalMs: 0, lookup: fixtureLookup });

    const literal = await fetchError(
      fetcher.fetchUrl(`http://127.0.0.1:${server.port}/doc`),
    );
    const named = await fetchError(
      viaDns.fetchUrl(`${server.origin("vendor.test")}/doc`),
    );
    const localhost = await fetchError(
      fetcher.fetchUrl(`http://localhost:${server.port}/doc`),
    );

    expect(literal.kind).toBe("refused");
    expect(named.kind).toBe("refused");
    expect(localhost.kind).toBe("refused");
    expect(server.requests).toEqual([]);
  });

  it("are recognised across the reserved ranges", () => {
    for (const address of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.20.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["93.184.216.34", "2606:4700::1111", "8.8.8.8"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
