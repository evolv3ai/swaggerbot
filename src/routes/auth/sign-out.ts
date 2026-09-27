import { createFileRoute } from "@tanstack/react-router";
import {
  getAuthKitContextOrNull,
  getAuthkit,
} from "@workos/authkit-tanstack-react-start";
import { redirectTo, signInConfigured, signInOff } from "~/server/auth";

/**
 * `GET /auth/sign-out`: clears the session cookie and ends the session at
 * WorkOS, whose logout URL sends the visitor back to the sign-out redirect
 * set in the WorkOS dashboard. Signed out already, it goes home. The cookie
 * is cleared through AuthKit's middleware. 404 when sign-in is off.
 */
export const Route = createFileRoute("/auth/sign-out")({
  server: {
    handlers: {
      GET: async () => {
        if (!signInConfigured()) return signInOff();
        const authkit = await getAuthkit();
        const session = getAuthKitContextOrNull()?.auth();
        if (!session?.user) {
          await authkit.clearSession(new Response());
          return redirectTo("/");
        }
        const { logoutUrl } = await authkit.signOut(session.sessionId);
        return redirectTo(logoutUrl);
      },
    },
  },
});
