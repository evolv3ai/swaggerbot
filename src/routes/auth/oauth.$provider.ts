import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import {
  currentUser,
  redirectTo,
  returnPath,
  signInConfigured,
  signInOff,
} from "~/server/auth";

/** The providers `/auth/sign-in` offers, as WorkOS names them. */
export const OAUTH_PROVIDERS = {
  github: "GitHubOAuth",
  google: "GoogleOAuth",
} as const;

export type OAuthProvider = keyof typeof OAUTH_PROVIDERS;

/**
 * AuthKit's authorize URL sent straight to `provider` instead of its hosted
 * page. The package always asks for `provider=authkit`; the PKCE challenge
 * and state are unchanged, so `/auth/callback` finishes it as before.
 */
export function withProvider(url: string, provider: OAuthProvider): string {
  const authorize = new URL(url);
  authorize.searchParams.set("provider", OAUTH_PROVIDERS[provider]);
  authorize.searchParams.delete("screen_hint");
  return authorize.toString();
}

/**
 * `GET /auth/oauth/github?returnTo=/keys` (or `google`): on to that
 * provider's sign-in, back through `/auth/callback` to `returnTo`. Someone
 * already signed in goes straight there. 404 for any other provider, and
 * when sign-in is off.
 */
export const Route = createFileRoute("/auth/oauth/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (
          !signInConfigured() ||
          !Object.hasOwn(OAUTH_PROVIDERS, params.provider)
        )
          return signInOff();
        const returnTo = returnPath(
          new URL(request.url).searchParams.get("returnTo"),
        );
        if (currentUser()) return redirectTo(returnTo);
        // Sets the flow's PKCE verifier cookie through AuthKit's middleware.
        const url = await getSignInUrl({ data: { returnPathname: returnTo } });
        return redirectTo(withProvider(url, params.provider as OAuthProvider));
      },
    },
  },
});
