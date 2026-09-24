import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { getApp, openGet } from "~/server/app-instance";
import { normalizedResponse } from "~/server/downloads";

export const Route = createFileRoute("/api/specs/$specId/normalized")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        openGet(request, () =>
          normalizedResponse(params.specId, () => getApp().db),
        ),
      ANY: methodNotAllowed("GET"),
    },
  },
});
