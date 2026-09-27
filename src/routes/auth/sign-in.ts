import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import {
  currentUser,
  redirectTo,
  returnPath,
  signInConfigured,
  signInOff,
} from "~/server/auth";

/**
 * `GET /auth/sign-in?returnTo=/keys`: on to AuthKit's hosted sign-in, which
 * comes back through `/auth/callback` to `returnTo`. Someone already signed
 * in goes straight there. 404 when sign-in is off.
 */
export const Route = createFileRoute("/auth/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!signInConfigured()) return signInOff();
        const returnTo = returnPath(
          new URL(request.url).searchParams.get("returnTo"),
        );
        if (currentUser()) return redirectTo(returnTo);
        // Sets the flow's PKCE verifier cookie through AuthKit's middleware.
        const url = await getSignInUrl({ data: { returnPathname: returnTo } });
        return redirectTo(url);
      },
    },
  },
});
