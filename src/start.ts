import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { auth } from "~/server/auth";
import { pageStatus } from "~/server/page-status";
import { securityHeaders } from "~/server/security-headers";

// With a start instance, TanStack Start no longer adds its default CSRF
// check for server functions by itself, so it is listed here as it was.
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Sign-in (src/server/auth.ts) runs inside the security headers, so a page
// whose session AuthKit refreshed still gets them.
export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, securityHeaders, auth, pageStatus],
}));
