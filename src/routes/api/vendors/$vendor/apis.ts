import { createFileRoute } from "@tanstack/react-router";
import { getApp, openGet } from "~/server/app-instance";
import { vendorApisResponse } from "~/server/vendor-apis";

export const Route = createFileRoute("/api/vendors/$vendor/apis")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        openGet(request, () => vendorApisResponse(params.vendor, getApp)),
    },
  },
});
