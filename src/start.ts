import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { securityHeaders } from "~/server/security-headers";

// With a start instance, TanStack Start no longer adds its default CSRF
// check for server functions by itself, so it is listed here as it was.
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, securityHeaders],
}));
