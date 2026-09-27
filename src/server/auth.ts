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
 * The global request middleware (src/start.ts): AuthKit's, when sign-in is
 * configured; otherwise it passes the request on untouched.
 */
export const auth = createMiddleware().server((args) => {
  const server = authkit.options.server;
  return signInConfigured() && server ? server(args) : args.next();
});

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

/**
 * A path on this site to come back to after signing in or out: `value` when
 * it is one (`/keys`, `/docs#keys`), else `/`. Never another origin.
 */
export function returnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || /^\/[/\\]/.test(value)) return "/";
  return value;
}

/** A redirect to `location`, for a link followed with GET. */
export function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}
