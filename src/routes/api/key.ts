import { createFileRoute } from "@tanstack/react-router";
import { handleKeyRequest } from "~/lookup/http";
import { methodNotAllowed } from "~/server/api-fallbacks";
import { gate, getApp } from "~/server/app-instance";

export const Route = createFileRoute("/api/key")({
  server: {
    handlers: {
      GET: ({ request }) => handleKeyRequest(request, getApp, gate),
      ANY: methodNotAllowed("GET"),
    },
  },
});
