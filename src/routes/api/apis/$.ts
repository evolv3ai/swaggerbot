import { createFileRoute } from "@tanstack/react-router";
import { getApp, openGet } from "~/server/app-instance";
import {
  normalizedCache,
  operationResponse,
} from "~/spec-forms/operation-http";

/**
 * `GET /api/apis/{apiId}/…`. An API id holds a slash
 * (`stripe.com/stripe-api`), so the route takes the rest of the path and
 * splits the API id from the resource after it.
 */
export const Route = createFileRoute("/api/apis/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        openGet(request, () => {
          const splat = params._splat ?? "";
          const slash = splat.lastIndexOf("/");
          const apiId = splat.slice(0, slash);
          const url = new URL(request.url);
          switch (splat.slice(slash + 1)) {
            case "operation": {
              const { db, lookup } = getApp();
              return operationResponse(url, apiId, {
                db,
                lookup,
                cache: normalizedCache,
              });
            }
            default:
              return Response.json({ error: "Not found." }, { status: 404 });
          }
        }),
    },
  },
});
