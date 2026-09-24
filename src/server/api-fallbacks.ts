/**
 * Answers for requests no API handler takes. Without them, TanStack Start
 * renders the app for a method a route has no handler for (a `GET` to
 * `/api/lookup` was a blank 200 page) and for an unknown `/api/…` path (an
 * HTML "Not Found"), so a Caller gets HTML where it expects JSON.
 */

/** A route's `ANY` handler: 405 with the methods it does take. */
export function methodNotAllowed(...allowed: string[]) {
  const allow = allowed.includes("GET") ? [...allowed, "HEAD"] : allowed;
  return ({ request }: { request: Request }) =>
    Response.json(
      {
        error: `${request.method} is not allowed here; use ${allowed.join(" or ")}.`,
      },
      { status: 405, headers: { Allow: allow.join(", ") } },
    );
}

/** 404 for a path under `/api/` that no route serves. */
export function noSuchApiRoute(): Response {
  return Response.json(
    {
      error: "No such route.",
      hint: "A Lookup is `POST /api/lookup` with a `name`; `GET /api/health` checks the service.",
    },
    { status: 404 },
  );
}
