import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  type SignInActions,
  SignInView,
} from "~/components/sign-in/sign-in-view";
import {
  checkSignInCode,
  getSignInPage,
  sendSignInCode,
} from "~/server/sign-in-fns";

const actions: SignInActions = {
  send: (email) => sendSignInCode({ data: { email } }),
  check: (email, code) => checkSignInCode({ data: { email, code } }),
};

/**
 * `/auth/sign-in?returnTo=/keys`: our own sign-in page (GitHub, Google, or
 * an emailed code), back to `returnTo` after. Someone already signed in goes
 * straight there. 404 when sign-in is off.
 */
export const Route = createFileRoute("/auth/sign-in")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  loaderDeps: ({ search }) => ({ returnTo: search.returnTo }),
  loader: async ({ deps }) => {
    const page = await getSignInPage({ data: { returnTo: deps.returnTo } });
    if (page.state === "off") throw notFound();
    if (page.state === "signed-in") throw redirect({ href: page.returnTo });
    return page;
  },
  // Who is signed in decides the page: read it afresh on every visit.
  staleTime: 0,
  gcTime: 0,
  head: () => ({
    meta: [
      { title: "Sign in · SwaggerBot" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const { returnTo } = Route.useLoaderData();
  return <SignInView returnTo={returnTo} actions={actions} />;
}
