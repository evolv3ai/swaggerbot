import { createFileRoute } from "@tanstack/react-router";
import { getApp, openGet } from "~/server/app-instance";
import { outlineResponse } from "~/spec-forms/http";
import { publicBaseUrlOf } from "~/spec-forms/outcome";

/** `<apiId>/outline`: an API id contains a slash, so the route is a splat. */
function outlineApiId(splat: string): string | undefined {
  return /^(.+)\/outline$/.exec(splat)?.[1];
}

export const Route = createFileRoute("/api/apis/$")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        openGet(request, () => {
          const apiId = outlineApiId(params._splat ?? "");
          if (apiId !== undefined)
            return outlineResponse(
              request,
              apiId,
              getApp,
              publicBaseUrlOf(process.env),
            );
          return Response.json({ error: "No such route." }, { status: 404 });
        }),
    },
  },
});
