import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { signInConfigured, signInOff } from "~/server/auth";

// A failed sign-in (a stale or repeated callback, an expired verifier)
// comes back to the home page, not to the package's JSON error.
const callback = handleCallbackRoute({ errorRedirectUrl: "/?signin=failed" });

/**
 * `GET /auth/callback` (`WORKOS_REDIRECT_URI`): AuthKit's hosted sign-in
 * returns here; the session cookie is set and the visitor goes on to the
 * `returnTo` they signed in from. 404 when sign-in is off.
 */
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: (ctx) => (signInConfigured() ? callback(ctx) : signInOff()),
    },
  },
});
