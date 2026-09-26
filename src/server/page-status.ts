import { createMiddleware } from "@tanstack/react-start";

/**
 * `response` answered with `status`, when it is a page (HTML) that the
 * router rendered as 200 and a route's server function set another status
 * for (`setResponseStatus`). Anything else is returned as it is. The body
 * and headers are kept: a streamed page goes on streaming.
 */
export function withPageStatus(response: Response, status: number): Response {
  const type = response.headers.get("content-type") ?? "";
  if (
    response.status !== 200 ||
    status === 200 ||
    !type.startsWith("text/html")
  )
    return response;
  return new Response(response.body, { status, headers: response.headers });
}

/**
 * The global request middleware (src/start.ts) that serves a page with the
 * status its route's server function set. TanStack Start renders a page
 * with the router's status only (200, 404 or 500), so a view that answers
 * otherwise (`/lookup` rate-limited: 429; no name, or `/vendors` with a
 * bad cursor: 400) sets it on the request, and this puts it on the page.
 */
export const pageStatus = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const { getResponseStatus } = await import("@tanstack/react-start/server");
  return {
    ...result,
    response: withPageStatus(result.response, getResponseStatus()),
  };
});
