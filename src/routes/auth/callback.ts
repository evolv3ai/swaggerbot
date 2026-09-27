import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { signInConfigured, signInOff } from "~/server/auth";

const callback = handleCallbackRoute();

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
