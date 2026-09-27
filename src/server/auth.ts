import { createMiddleware } from "@tanstack/react-start";
import {
  authkitMiddleware,
  getAuthKitContextOrNull,
} from "@workos/authkit-tanstack-react-start";

/**
 * Sign-in with WorkOS AuthKit (ADR 0006, D4): the package's middleware reads
 * the sealed session cookie on each request, and `currentUser()` says who
 * that is. Without the WorkOS env the middleware never runs, `/auth/…`
 * answers 404 and the top bar offers no sign-in; the site is as it was.
 */

type Env = Record<string, string | undefined>;

const WORKOS_ENV = [
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_REDIRECT_URI",
] as const;

/** AuthKit refuses a shorter cookie password. */
const MIN_COOKIE_PASSWORD = 32;

let warnedShortPassword = false;

/**
 * Whether sign-in is on: every WorkOS variable set, and the cookie password
 * long enough for AuthKit. A short one leaves sign-in off (and says so once)
 * rather than failing every request.
 */
export function signInConfigured(env: Env = process.env): boolean {
  if (!WORKOS_ENV.every((name) => env[name])) return false;
  if ((env.WORKOS_COOKIE_PASSWORD ?? "").length < MIN_COOKIE_PASSWORD) {
    if (!warnedShortPassword) {
      warnedShortPassword = true;
      console.warn(
        `sign-in: off (WORKOS_COOKIE_PASSWORD is shorter than ${MIN_COOKIE_PASSWORD} characters)`,
      );
    }
    return false;
  }
  return true;
}

const authkit = authkitMiddleware();

/**
 * Paths AuthKit stays out of: the HTTP API and MCP authenticate by key, so
 * WorkOS is never in their path (ADR 0006: WorkOS only at sign-in), even
 * for a caller that also carries a session cookie.
 */
const KEYED_PATHS = /^\/(api\/|mcp(\/|$))/;

/** AuthKit's session cookie. */
const SESSION_COOKIE = /(?:^|;\s*)wos-session=/;

/**
 * The global request middleware (src/start.ts): AuthKit's, when sign-in is
 * configured and the path is a page or `/auth/…`; otherwise it passes the
 * request on untouched. A page rendered for someone with a session names
 * them, so it is marked private and never stored by a cache.
 */
export const auth = createMiddleware().server(async (args) => {
  const server = authkit.options.server;
  if (!signInConfigured() || !server || KEYED_PATHS.test(args.pathname))
    return args.next();
  const result = await server(args);
  if (SESSION_COOKIE.test(args.request.headers.get("cookie") ?? ""))
    markPrivate(result instanceof Response ? result : result.response);
  return result;
});

/** Marks an HTML page `private, no-store`. Changes `response` in place. */
export function markPrivate(response: Response): Response {
  if ((response.headers.get("content-type") ?? "").startsWith("text/html"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Who is signed in, as `/keys` needs it. swagger.bot keeps no users. */
export type SignedInUser = { id: string; email: string; name?: string };

/**
 * The signed-in person on this request, from the session AuthKit's
 * middleware read (and refreshed, if its access token had expired); null when
 * signed out, when the session could not be read or refreshed, or when
 * sign-in is off. Server-side only.
 */
export function currentUser(): SignedInUser | null {
  if (!signInConfigured()) return null;
  const user = getAuthKitContextOrNull()?.auth().user;
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name
    ? { id: user.id, email: user.email, name }
    : { id: user.id, email: user.email };
}

/** What `/auth/…` answers when sign-in is off: nothing is there. */
export function signInOff(): Response {
  return new Response("Not found.\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** A stand-in origin to resolve a path against; never served. */
const PROBE_ORIGIN = "http://return.invalid";

/**
 * A path on this site to come back to after signing in or out: `value`'s
 * path and query when it resolves to this site (`/keys`, `/docs?x=1`), else
 * `/`. Never another origin: it is resolved as a browser would, which drops
 * tabs and newlines, so `/\t/evil.example` is `//evil.example`, not a path.
 * The hash is dropped: AuthKit can't carry one through the callback.
 */
export function returnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PROBE_ORIGIN) return "/";
  return `${url.pathname}${url.search}`;
}

/** A redirect to `location`, for a link followed with GET. */
export function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}
