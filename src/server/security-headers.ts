import { createMiddleware } from "@tanstack/react-start";

/**
 * Security headers for the Web UI's pages: a Content Security Policy that
 * allows only this origin, plus `nosniff` and a referrer policy. TanStack
 * Start's hydration writes inline scripts, so each page gets a fresh nonce
 * (`script-src 'nonce-…'`) that the router puts on those scripts
 * (src/router.tsx), rather than `'unsafe-inline'`.
 *
 * Only HTML responses get them. `/api/…`, `/mcp` and the downloads keep their
 * own headers, and `/embed/…` (the Spec viewer's frame) sets its own policy.
 */

/** The Content Security Policy for a page whose inline scripts carry `nonce`. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** 128 random bits, base64: a new one for every request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

const OWN_HEADERS = /^\/(api\/|mcp$|mcp\/|embed\/)/;

/**
 * Adds the security headers to `response` when it is a page: HTML, and not
 * from a path that keeps its own headers. Changes `response` in place.
 */
export function addSecurityHeaders(
  response: Response,
  pathname: string,
  nonce: string,
): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("text/html") || OWN_HEADERS.test(pathname)) {
    return response;
  }
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

/**
 * The global request middleware (src/start.ts): makes the request's nonce,
 * hands it to the router as `context.cspNonce`, and adds the headers to the
 * page it renders.
 */
export const securityHeaders = createMiddleware().server(
  async ({ next, pathname }) => {
    const cspNonce = newNonce();
    const result = await next({ context: { cspNonce } });
    addSecurityHeaders(result.response, pathname, cspNonce);
    return result;
  },
);
