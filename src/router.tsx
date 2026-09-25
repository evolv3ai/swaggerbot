import { createRouter } from "@tanstack/react-router";
import {
  createIsomorphicFn,
  getGlobalStartContext,
} from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

/**
 * The page's CSP nonce (src/server/security-headers.ts), which the router
 * puts on the inline scripts it writes. On the server it comes from the
 * request middleware; in the browser, from the `csp-nonce` meta tag the
 * router wrote, so hydration renders the same attributes.
 */
const cspNonce = createIsomorphicFn()
  .server(() => getGlobalStartContext()?.cspNonce)
  .client(
    () =>
      document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')
        ?.content,
  );

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    ssr: { nonce: cspNonce() },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
