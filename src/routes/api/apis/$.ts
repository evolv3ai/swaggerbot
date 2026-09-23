import { createFileRoute } from "@tanstack/react-router";
import { getApp, openGet } from "~/server/app-instance";
import { outlineResponse } from "~/spec-forms/http";
import {
  normalizedCache,
  operationResponse,
} from "~/spec-forms/operation-http";
import { publicBaseUrlOf } from "~/spec-forms/outcome";

/**
 * `GET /api/apis/{apiId}/…`. An API id holds a slash
 * (`stripe.com/stripe-api`), so the route takes the rest of the path and
 * splits the API id from the resource after it: `outline` or `operation`.
 */
export const Route = createFileRoute("/api/apis/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        openGet(request, () => {
          const splat = params._splat ?? "";
          const slash = splat.lastIndexOf("/");
          const apiId = splat.slice(0, slash);
          switch (slash > 0 ? splat.slice(slash + 1) : "") {
            case "outline":
              return outlineResponse(
                request,
                apiId,
                getApp,
                publicBaseUrlOf(process.env),
              );
            case "operation": {
              const { db, lookup } = getApp();
              return operationResponse(new URL(request.url), apiId, {
                db,
                lookup,
                cache: normalizedCache,
              });
            }
            default:
              return Response.json(
                { error: "No such route." },
                { status: 404 },
              );
          }
        }),
    },
  },
});
