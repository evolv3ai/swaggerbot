import { describe, expect, it } from "vitest";
import { Route as Health } from "~/routes/api/health";
import {
  addSecurityHeaders,
  contentSecurityPolicy,
  newNonce,
  securityHeaders,
} from "./security-headers";

/** Runs the middleware on `pathname` with `respond` as the rest of the app. */
async function run(pathname: string, respond: () => Promise<Response>) {
  const server = securityHeaders.options.server;
  if (!server) throw new Error("no server middleware");
  let nonce: unknown;
  const request = new Request(`http://localhost${pathname}`);
  const result = await server({
    request,
    pathname,
    context: {},
    handlerType: "router",
    next: (async (options?: { context?: { cspNonce?: string } }) => {
      nonce = options?.context?.cspNonce;
      return { request, pathname, context: {}, response: await respond() };
    }) as never,
  } as never);
  const response = result instanceof Response ? result : result.response;
  return { response, nonce };
}

const page = async () =>
  new Response("<!doctype html><title>x</title>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("securityHeaders", () => {
  it("sets the CSP, nosniff and the referrer policy on an HTML page", async () => {
    const { response, nonce } = await run("/", page);

    expect(typeof nonce).toBe("string");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      contentSecurityPolicy(nonce as string),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("leaves GET /api/health's headers alone", async () => {
    const handlers = Health.options.server?.handlers;
    const get = typeof handlers === "function" ? undefined : handlers?.GET;
    if (typeof get !== "function") throw new Error("no GET handler");

    const { response } = await run(
      "/api/health",
      async () =>
        (await get({
          request: new Request("http://localhost/api/health"),
        } as never)) as Response,
    );

    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });

  it("gives every request its own nonce", async () => {
    const first = await run("/", page);
    const second = await run("/", page);
    expect(first.nonce).not.toBe(second.nonce);
  });
});

describe("contentSecurityPolicy", () => {
  it("allows scripts only from this origin and with the nonce", () => {
    const policy = contentSecurityPolicy("abc");
    const scripts = policy.split("; ").find((d) => d.startsWith("script-src"));
    expect(scripts).toBe("script-src 'self' 'nonce-abc'");
    expect(policy).toMatch(/^default-src 'self'; /);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toMatch(/object-src 'none'$/);
  });
});

describe("addSecurityHeaders", () => {
  it.each(["/api/lookup", "/api/specs/x/published", "/mcp", "/embed/specs/x"])(
    "keeps %s's own headers, even for HTML",
    async (path) => {
      const response = addSecurityHeaders(await page(), path, newNonce());
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
    },
  );

  it("skips a response that isn't HTML", () => {
    const response = addSecurityHeaders(
      Response.json({ ok: true }),
      "/",
      newNonce(),
    );
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });
});

describe("newNonce", () => {
  it("is 128 bits of base64", () => {
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
