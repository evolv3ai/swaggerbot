import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { getApp, openGet } from "~/server/app-instance";
import { publishedResponse } from "~/server/downloads";

export const Route = createFileRoute("/api/specs/$specId/published")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        openGet(request, () =>
          publishedResponse(request, params.specId, () => getApp().db),
        ),
      ANY: methodNotAllowed("GET"),
    },
  },
});
