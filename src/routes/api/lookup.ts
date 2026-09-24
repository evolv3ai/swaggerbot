import { createFileRoute } from "@tanstack/react-router";
import { handleLookupRequest } from "~/lookup/http";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { gate, getApp } from "~/server/app-instance";

export const Route = createFileRoute("/api/lookup")({
  server: {
    handlers: {
      POST: ({ request }) => handleLookupRequest(request, getApp, gate),
      ANY: methodNotAllowed("POST"),
    },
  },
});
