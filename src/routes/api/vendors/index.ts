import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { getApp, openGet } from "~/server/app-instance";
import { vendorsResponse } from "~/server/vendors";

export const Route = createFileRoute("/api/vendors/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        openGet(request, () => vendorsResponse(request, () => getApp().db)),
      ANY: methodNotAllowed("GET"),
    },
  },
});
