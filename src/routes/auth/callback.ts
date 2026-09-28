import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { signInConfigured, signInOff } from "~/server/auth";

// A failed sign-in (a stale or repeated callback, an expired verifier)
// comes back to the home page, not to the package's JSON error.
const callback = handleCallbackRoute({ errorRedirectUrl: "/?signin=failed" });

/**
 * `request` as the visitor sent it: on `WORKOS_REDIRECT_URI`'s origin. Behind
 * the proxy the app sees `http://`, and AuthKit builds its redirects (to
 * `returnTo`, or the error page) on the request's origin.
 */
export function onPublicOrigin(
  request: Request,
  redirectUri = process.env.WORKOS_REDIRECT_URI,
): Request {
  if (!redirectUri) return request;
  const url = new URL(request.url);
  const publicOrigin = new URL(redirectUri);
  url.protocol = publicOrigin.protocol;
  url.hostname = publicOrigin.hostname;
  // Set even when empty: an internal `:3000` must not survive.
  url.port = publicOrigin.port;
  return new Request(url, request);
}

/**
 * Logs why WorkOS came back without a code: it sends `error` and
 * `error_description` instead (a refused sign-in, a misconfigured
 * environment), which AuthKit reports only as "Missing authorization code".
 * Both are WorkOS's own words, never a secret; capped in length.
 */
export function logRefusal(request: Request, warn = console.warn): void {
  const params = new URL(request.url).searchParams;
  if (params.get("code")) return;
  const error = params.get("error") ?? "none";
  const description = params.get("error_description") ?? "";
  warn(
    `sign-in: WorkOS returned no code (error=${error.slice(0, 80)}${description ? `: ${description.slice(0, 300)}` : ""})`,
  );
}

/**
 * `GET /auth/callback` (`WORKOS_REDIRECT_URI`): AuthKit's hosted sign-in
 * returns here; the session cookie is set and the visitor goes on to the
 * `returnTo` they signed in from. 404 when sign-in is off.
 */
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: (ctx) => {
        if (!signInConfigured()) return signInOff();
        logRefusal(ctx.request);
        return callback({ ...ctx, request: onPublicOrigin(ctx.request) });
      },
    },
  },
});
